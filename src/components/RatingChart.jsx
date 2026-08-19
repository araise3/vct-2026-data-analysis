import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { scaleLinear, scaleTime } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'
import { num, shortDate } from '../lib/format'
import { RC } from '../lib/ratingTheme'
import TeamLogo from './TeamLogo'

/**
 * Interactive rating-trajectory chart for the Glicko-2 ratings.
 *
 * Purpose-built rather than reusing TrendChart, which draws one value per
 * date with a native `<title>` tooltip and no room for markers, annotations
 * or a real tooltip.
 *
 * Every point where a match was actually played gets a small dot, and the
 * hover crosshair only ever stops on one of those -- a team's rating still
 * has a value in an idle week (RD keeps decaying through it), but there's
 * no result to show for one, so it isn't a place the cursor should be able
 * to land. `handleMove` filters on `c.games > 0` for exactly this reason.
 * A per-team time-range control (30D/90D/season) was tried here and cut: at
 * most one team's data is ever short enough for "30 days" to mean anything
 * relative to "season", so it was a control that did nothing on every
 * comparison view and something confusing on single-team ones. If a
 * zoom/pan need comes back, it should act on the shared x-domain, not on
 * each series independently.
 *
 * The 95% interval is NOT drawn as a shaded band any more, though it was
 * once. The reason is geometric rather than aesthetic: the value axis is
 * scaled to the ratings (see below), and +/-2RD is around 340 points wide
 * against a typical 700-point visible range, so the band covered half the
 * plot and clipped flat against the ceiling -- a pink slab, not a gradient.
 * Uncertainty is still carried, in the places it reads properly: the
 * tooltip's +/- figure on every hovered point, the 95% range stat, and the
 * RD column in the tables.
 *
 * Geometry comes from d3 (`d3-scale` for the axes, `d3-shape` for the curve
 * and area), but React owns every element -- no `d3-selection`, no
 * imperative DOM mutation inside a component React also renders. That's the
 * only combination of the two that doesn't end with both libraries fighting
 * over the same nodes. The two modules are ~15KB together; the full d3
 * bundle is not installed and isn't needed.
 *
 * The curve is `curveMonotoneX`, not Catmull-Rom or a basis spline. Those
 * overshoot between points, which on a rating chart draws a team at a
 * rating it never held -- and would put the crest of that overshoot above
 * the annotated season peak, so the chart would contradict its own label.
 * Monotone interpolation is smooth but cannot exceed the data's own local
 * extremes.
 *
 * series: [{ key, label, color?, points: [{ date, rating, rd, low, high,
 *            games, settled, change?, results? }] }]
 *   One entry draws the full treatment (gradient area, glow, markers,
 *   annotations). Several draw plain lines -- the comparison in that mode
 *   is between the lines, and five stacked gradients is mud.
 */

// Accent red leads (it's the rating colour), then neutral hues for the
// comparison lines. Deliberately not six shades of red: the accent is
// reserved for rating data rather than spread across the interface, and six
// reds would be indistinguishable overlaid in any case.
export const SERIES_COLORS = [RC.accent, '#7C8FD1', RC.positive, RC.warning, '#14b8a6', '#B78BEA']
export const MAX_SERIES = SERIES_COLORS.length

/**
 * Two viewBox widths, picked from the container's measured width rather
 * than one fixed value.
 *
 * An SVG with a fixed viewBox scales its text along with everything else,
 * so a 720-unit chart squeezed into a 310px phone column renders its axis
 * labels at about 4px -- present, unreadable. Narrowing the coordinate
 * system instead of shrinking the drawing keeps the labels at roughly their
 * intended size and, as a bonus, gives the plot back its height (720x300
 * into 343px is 143px tall; 380x300 is 271px).
 */
const W_WIDE = 720
const W_NARROW = 380
const NARROW_BELOW = 520
const PAD = { l: 46, r: 16, t: 26, b: 26 }

/**
 * Up to three moments worth calling out, in priority order. Each is a real
 * feature of the series rather than a fixed set of labels: a team that never
 * dropped below 1500 gets no "fell below" annotation, and one that never
 * recovered gets no recovery.
 */
function findAnnotations(coords) {
  const out = []
  const settled = coords.filter((c) => c.settled !== false)
  const pool = settled.length ? settled : coords

  let peak = null
  for (const c of pool) if (!peak || c.rating > peak.rating) peak = c
  if (peak) out.push({ at: peak, label: `Peak ${num(peak.rating)}` })

  const firstBelow = coords.find((c, i) => i > 0 && c.rating < 1500 && coords[i - 1].rating >= 1500)
  if (firstBelow) out.push({ at: firstBelow, label: 'Fell below 1500' })

  // "Late recovery": the biggest climb off a trough inside the closing
  // stretch of the season. Gated at 40 points so a flat finish doesn't get
  // labelled a comeback.
  const tail = coords.slice(Math.floor(coords.length * 0.6))
  if (tail.length >= 3) {
    let trough = tail[0]
    let best = null
    for (const c of tail) {
      if (c.rating < trough.rating) trough = c
      else if (c.rating - trough.rating >= 40 && (!best || c.rating - trough.rating > best.gain)) {
        best = { at: c, gain: c.rating - trough.rating }
      }
    }
    if (best) out.push({ at: best.at, label: `Recovered +${num(best.gain)}` })
  }

  // Drop any annotation that would collide with one already placed -- three
  // labels stacked over the same fortnight is worse than two well spaced.
  const placed = []
  for (const a of out) {
    if (placed.some((p) => Math.abs(p.at.cx - a.at.cx) < 90)) continue
    placed.push(a)
    if (placed.length === 3) break
  }
  return placed
}

export default function RatingChart({
  series, height = 300, baseline = 1500, title, subtitle, controls,
}) {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const pathRefs = useRef({})
  const [hover, setHover] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())
  const [W, setW] = useState(W_WIDE)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => {
      setW(entry.contentRect.width < NARROW_BELOW ? W_NARROW : W_WIDE)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(
    () => series.filter((s) => !hidden.has(s.key) && s.points.length > 0),
    [series, hidden]
  )

  // Detail mode: the gradient area, glow, markers and annotations only make
  // sense for one line. Overlaid, they'd be five gradients stacked into mud
  // and fifteen annotations fighting for the same 90px of x-axis.
  const detailed = visible.length === 1

  const H = height

  const geom = useMemo(() => {
    const all = visible.flatMap((s) => s.points)
    if (all.length === 0) return null

    const times = all.map((p) => new Date(p.date).getTime())
    let tMin = Math.min(...times)
    let tMax = Math.max(...times)
    if (tMin === tMax) { tMin -= 6048e5; tMax += 6048e5 }

    // The value axis is scaled to the RATINGS, never to the confidence band,
    // and the band is clipped to the plot instead. Scaling to the band looks
    // correct on paper and is unreadable: a team's opening weeks carry an RD
    // near 250, so +/-2RD is a 1000-point spread that flattens the rest of
    // the season into a ribbon. Clipping costs the tail of the interval
    // exactly where it's least informative.
    let vMin = Math.min(...all.map((p) => p.rating))
    let vMax = Math.max(...all.map((p) => p.rating))
    if (baseline != null) {
      vMin = Math.min(vMin, baseline)
      vMax = Math.max(vMax, baseline)
    }
    const padV = (vMax - vMin) * 0.12 || 50

    const x = scaleTime().domain([tMin, tMax]).range([PAD.l, W - PAD.r])
    const y = scaleLinear().domain([vMin - padV, vMax + padV]).range([H - PAD.b, PAD.t])

    const curve = line().x((c) => c.cx).y((c) => c.cy).curve(curveMonotoneX)
    const fillArea = area().x((c) => c.cx).y0(H - PAD.b).y1((c) => c.cy).curve(curveMonotoneX)

    const shaped = visible.map((s, i) => {
      const coords = s.points.map((p) => ({
        ...p,
        cx: x(new Date(p.date)),
        cy: y(p.rating),
        cLow: y(p.low),
        cHigh: y(p.high),
      }))

      return {
        ...s,
        uid: `s${i}`,
        color: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
        coords,
        linePath: curve(coords),
        areaPath: fillArea(coords),
      }
    })

    const dates = all.map((p) => p.date).sort()
    return {
      x,
      y,
      shaped,
      // At most four gridlines, on round values, chosen by d3's own tick
      // algorithm -- they read as a scale rather than as arbitrary fractions
      // of whatever range the data happens to span.
      ticks: y.ticks(4),
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      annotations: detailed && shaped[0] ? findAnnotations(shaped[0].coords) : [],
    }
  }, [visible, detailed, baseline, H, W])

  // Draw-in: measure each path once it exists, then release the dash offset
  // on the next frame so the transition has something to move from. Re-runs
  // whenever the shape changes (new team, new year), which is what makes
  // switching feel like a redraw rather than a swap.
  const shapeKey = visible.map((s) => `${s.key}:${s.points.length}`).join('|')
  useLayoutEffect(() => {
    const nodes = Object.values(pathRefs.current).filter(Boolean)
    nodes.forEach((node) => {
      const len = node.getTotalLength()
      node.style.transition = 'none'
      node.style.strokeDasharray = `${len}`
      node.style.strokeDashoffset = `${len}`
    })
    const id = requestAnimationFrame(() => {
      nodes.forEach((node) => {
        node.style.transition = 'stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)'
        node.style.strokeDashoffset = '0'
      })
    })
    return () => cancelAnimationFrame(id)
  }, [shapeKey, H, W])

  useEffect(() => {
    setHidden((prev) => {
      const keys = new Set(series.map((s) => s.key))
      const next = new Set([...prev].filter((k) => keys.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [series])

  /**
   * Client coords -> SVG user space via the screen CTM, rather than scaling
   * by the container's width. The SVG scales uniformly inside its box
   * (default preserveAspectRatio), so at aspect ratios that don't match the
   * viewBox there's letterboxing a naive ratio would silently offset the
   * crosshair by.
   */
  function pointerX(e) {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    return pt.matrixTransform(ctm.inverse()).x
  }

  function handleMove(e) {
    if (!geom) return
    const ux = pointerX(e)
    if (ux == null) return
    // Snap to the nearest *match-played date* across every visible series --
    // idle weeks (games === 0) carry a rating point too, since RD still
    // decays through them, but there's no result to show for one, so the
    // cursor should never stop on it. Read each series at that date once
    // found, so a multi-team hover compares like with like instead of
    // showing whichever team happens to have a point nearest the cursor.
    let bestDate = null
    let bestDist = Infinity
    for (const s of geom.shaped) {
      for (const c of s.coords) {
        if (!c.games) continue
        const d = Math.abs(c.cx - ux)
        if (d < bestDist) { bestDist = d; bestDate = c.date }
      }
    }
    if (!bestDate) return
    const rows = geom.shaped
      .map((s) => ({ series: s, point: s.coords.find((c) => c.date === bestDate) }))
      .filter((r) => r.point)
    if (!rows.length) return
    const wrapRect = wrapRef.current.getBoundingClientRect()
    setHover({
      date: bestDate,
      rows,
      cx: rows[0].point.cx,
      px: e.clientX - wrapRect.left,
    })
  }

  function toggle(key) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      // Never let the last visible series be switched off -- an empty plot
      // with no way back short of clicking blind isn't a state worth being
      // able to reach.
      else if (visible.length > 1) next.add(key)
      return next
    })
  }

  const gradId = useMemo(() => `rc-${Math.random().toString(36).slice(2, 8)}`, [])
  const axisText = { fontSize: 9, fill: RC.textDim, opacity: 0.75 }

  return (
    <div className="flex flex-col gap-3">
      {(title || controls) && (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5 min-w-0">
            {title && (
              <h3 className="font-display text-sm font-semibold" style={{ color: RC.text }}>{title}</h3>
            )}
            {subtitle && <p className="text-[11px]" style={{ color: RC.textDim }}>{subtitle}</p>}
          </div>
          {controls && <div className="flex items-center gap-2 shrink-0">{controls}</div>}
        </div>
      )}

      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {series.map((s, i) => {
            const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length]
            const off = hidden.has(s.key)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className="flex items-center gap-1.5 text-[11px] font-medium pl-1.5 pr-2 py-1 rounded-lg border transition-colors"
                style={{
                  background: off ? 'transparent' : RC.elevated,
                  borderColor: off ? RC.border : 'transparent',
                  color: off ? RC.textDim : RC.text,
                }}
                title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: color, opacity: off ? 0.3 : 1 }}
                />
                <TeamLogo team={s.label} size={14} showName={false} />
                <span className={off ? 'line-through decoration-1' : undefined}>{s.label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div ref={wrapRef} className="relative">
        {geom ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full select-none"
            style={{ height: 'auto' }}
            onPointerMove={handleMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`Rating over time for ${series.map((s) => s.label).join(', ')}`}
          >
            <defs>
              {geom.shaped.map((s) => (
                <linearGradient key={s.uid} id={`${gradId}-area-${s.uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.30" />
                  <stop offset="50%" stopColor={s.color} stopOpacity="0.10" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
              {/* Restrained glow: blurred copy under the line at half alpha,
                  not the full-strength merge that made the old line bloom. */}
              <filter id={`${gradId}-glow`} x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feComponentTransfer in="b" result="soft">
                  <feFuncA type="linear" slope="0.5" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode in="soft" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <clipPath id={`${gradId}-clip`}>
                <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
              </clipPath>
            </defs>

            {/* Horizontal gridlines only -- no vertical rules. */}
            {geom.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.l} x2={W - PAD.r} y1={geom.y(v)} y2={geom.y(v)}
                  stroke={RC.grid} strokeWidth="1"
                />
                <text x={PAD.l - 8} y={geom.y(v) + 3} textAnchor="end" style={axisText}>
                  {num(v)}
                </text>
              </g>
            ))}

            {/* The 1500 reference line, unchanged: same dash, same opacity,
                same right-aligned label at the same size, same tokens. */}
            {baseline != null && (
              <g>
                <line
                  x1={PAD.l} x2={W - PAD.r} y1={geom.y(baseline)} y2={geom.y(baseline)}
                  stroke="currentColor" strokeWidth="1" strokeDasharray="4 4"
                  className="text-muted" opacity="0.55"
                />
                <text
                  x={W - PAD.r} y={geom.y(baseline) - 5} textAnchor="end"
                  className="fill-current text-muted" style={{ fontSize: 9 }}
                >
                  unrated 1500
                </text>
              </g>
            )}

            {detailed && geom.shaped.map((s) => (
              <path
                key={s.uid} d={s.areaPath}
                fill={`url(#${gradId}-area-${s.uid})`}
                clipPath={`url(#${gradId}-clip)`}
              />
            ))}

            {hover && (
              <line
                x1={hover.cx} x2={hover.cx} y1={PAD.t} y2={H - PAD.b}
                stroke={RC.textDim} strokeWidth="1" opacity="0.35"
              />
            )}

            {geom.shaped.map((s) => (
              <path
                key={s.uid}
                ref={(el) => { pathRefs.current[s.key] = el }}
                d={s.linePath}
                fill="none"
                stroke={s.color}
                strokeWidth={detailed ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                filter={detailed ? `url(#${gradId}-glow)` : undefined}
              />
            ))}

            {/* A dot for every week a match was actually played -- idle
                weeks (rating held, RD only decaying) get no dot, since
                there's no result there and the hover crosshair never stops
                on one either (see handleMove). Small and undetailed lines
                get a slightly smaller dot so several overlaid series don't
                turn into a field of circles. */}
            {geom.shaped.map((s) => (
              s.coords.filter((c) => c.games > 0).map((c) => (
                <circle
                  key={`${s.uid}-${c.date}`}
                  cx={c.cx} cy={c.cy} r={detailed ? 3 : 2.2}
                  fill={RC.panel} stroke={s.color} strokeWidth={detailed ? 2 : 1.5}
                />
              ))
            ))}

            {geom.annotations.map((a) => {
              // Label boxes are sized from an em-width estimate rather than
              // measured: getComputedTextLength needs a laid-out node, which
              // would mean rendering twice. At 8px in a 720-unit box the
              // estimate lands within a couple of units, and the box is
              // translucent, so a small overshoot doesn't read.
              const w = a.label.length * 4.4 + 12
              const above = a.at.cy > PAD.t + 60
              const boxY = above ? a.at.cy - 34 : a.at.cy + 18
              const bx = Math.min(Math.max(a.at.cx - w / 2, PAD.l), W - PAD.r - w)
              return (
                <g key={a.label}>
                  <line
                    x1={a.at.cx} x2={a.at.cx}
                    y1={above ? a.at.cy - 8 : a.at.cy + 8}
                    y2={above ? boxY + 15 : boxY}
                    stroke={RC.textDim} strokeWidth="1" opacity="0.35"
                  />
                  <rect
                    x={bx} y={boxY} width={w} height={15} rx="4"
                    fill="rgba(13,16,22,0.72)" stroke={RC.border} strokeWidth="0.5"
                  />
                  <text
                    x={bx + w / 2} y={boxY + 10.5} textAnchor="middle"
                    style={{ fontSize: 8, fill: RC.text }}
                  >
                    {a.label}
                  </text>
                </g>
              )
            })}

            {hover && hover.rows.map(({ series: s, point }) => (
              <g key={s.key}>
                <circle cx={point.cx} cy={point.cy} r="9" fill={s.color} opacity="0.18" />
                <circle
                  cx={point.cx} cy={point.cy} r="4.5"
                  fill={RC.panel} stroke={s.color} strokeWidth="3"
                />
              </g>
            ))}

            {/* Axis ends come from the shared time domain, not from the first
                series -- with several teams overlaid they debut on different
                weeks, and labelling the axis with one team's first game
                mislabels every other line on it. */}
            <text x={PAD.l} y={H - 6} style={axisText}>{shortDate(geom.firstDate)}</text>
            <text x={W - PAD.r} y={H - 6} textAnchor="end" style={axisText}>
              {shortDate(geom.lastDate)}
            </text>
          </svg>
        ) : (
          <div className="h-40 flex items-center justify-center text-xs" style={{ color: RC.textDim }}>
            Nothing to plot.
          </div>
        )}

        {/* Tooltip as positioned HTML rather than SVG <text>: it needs to
            wrap, carry a backdrop blur and a real background, and stay
            legible at whatever width the SVG has been scaled to -- SVG text
            would scale with the viewBox and go blurry-small on a phone. */}
        {hover && (
          <div
            className="absolute top-1 pointer-events-none z-10 min-w-[11rem] max-w-[15rem] px-3 py-2"
            style={{
              left: Math.min(
                Math.max(hover.px + 16, 0),
                Math.max((wrapRef.current?.clientWidth || 0) - 230, 0)
              ),
              background: 'rgba(23,27,36,0.82)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: `1px solid ${RC.border}`,
              borderRadius: 12,
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            }}
          >
            <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: RC.textDim }}>
              {shortDate(hover.date)}
            </div>
            <div className="flex flex-col gap-1.5">
              {hover.rows
                .slice()
                .sort((a, b) => b.point.rating - a.point.rating)
                .map(({ series: s, point }) => (
                  <div key={s.key} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="font-semibold tabular-nums" style={{ color: RC.text }}>
                        {num(point.rating)}
                      </span>
                      {point.change != null && point.games > 0 && (
                        <span
                          className="tabular-nums text-[11px] font-medium"
                          style={{ color: point.change >= 0 ? RC.positive : RC.accent }}
                        >
                          {point.change >= 0 ? '+' : ''}{num(point.change)}
                        </span>
                      )}
                      {series.length > 1 && (
                        <span className="truncate text-[11px]" style={{ color: RC.textDim }}>
                          {s.label}
                        </span>
                      )}
                    </div>
                    {hover.rows.length === 1 && point.results?.length > 0 && (
                      <div className="flex flex-col gap-1 pl-4 mt-0.5">
                        {point.results.slice(0, 3).map((r, i) => (
                          <div key={i} className="text-[11px] leading-tight">
                            <span style={{ color: RC.textDim }}>vs </span>
                            <span style={{ color: RC.text }}>{r.opponent}</span>{' '}
                            <span
                              className="tabular-nums font-medium"
                              style={{ color: r.won ? RC.positive : RC.accent }}
                            >
                              {r.score}
                            </span>
                            {r.event && (
                              <div className="truncate" style={{ color: RC.textDim, opacity: 0.75 }}>
                                {r.event}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
            {hover.rows.length === 1 && !hover.rows[0].point.games && (
              <div className="text-[10px] mt-1" style={{ color: RC.textDim }}>
                No games — deviation widening
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
