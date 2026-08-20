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
 * Color for series i of `total`. The curated six-color palette above for
 * anything that fits it -- every default or manually-built comparison,
 * capped at MAX_SERIES -- and evenly-spaced hues around the color wheel
 * for anything past it, which today only means an event-scoped chart:
 * Champions is 12 teams, Lock-In was 30, both well past six hand-picked
 * colors. Nobody can tell 30 lines apart by color regardless, but spacing
 * them evenly beats cycling the same six every five teams, which would put
 * two identically-colored lines right next to each other in the legend.
 */
export function seriesColor(i, total) {
  if (total <= SERIES_COLORS.length) return SERIES_COLORS[i % SERIES_COLORS.length]
  return `hsl(${Math.round((i * 360) / total)}, 65%, 62%)`
}

// Background shading for the international events inside the visible
// window, keyed on the `stage` field teamRatings.js's
// internationalEventWindows() reads straight off the event record. Colors
// picked to read as their own real-world identity rather than the site's
// usual good/bad semantics -- '#B78BEA' is already SERIES_COLORS' comparison
// purple, reused here rather than adding a second purple to the palette.
//
// Exported so Ratings.jsx can key the same color into the accent swatch it
// shows next to the title once a chart is scoped INTO one of these events --
// see `accentColor` below for why the band itself stops being drawn then.
export const STAGE_STYLE = {
  Masters: { color: '#B78BEA', label: 'Masters' },
  Champions: { color: RC.warning, label: 'Champions' },
  'LOCK//IN': { color: RC.positive, label: 'Lock-In' },
}

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
  series, height = 300, baseline = 1500, title, subtitle, controls, eventBands = [], onBandClick,
  accentColor, xDomain,
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

    // xDomain forces the visible range to an event's own dates rather than
    // the data's actual earliest/latest point -- the event-scoped chart
    // still carries one point from *before* the event (its pre-event
    // anchor rating; see Ratings.jsx's windowToEvent) so the line has
    // something to move from, but that point's real date is up to a day
    // before the event started and shouldn't be what draws the axis start.
    // `.clamp(true)` below is what lets the axis say "Feb 28" while that
    // anchor point still contributes its rating value, pinned visually to
    // the left edge instead of poking out before it.
    let tMin
    let tMax
    if (xDomain) {
      tMin = new Date(`${xDomain.start}T00:00:00Z`).getTime()
      tMax = new Date(`${xDomain.end}T23:59:59Z`).getTime()
    } else {
      const times = all.map((p) => new Date(p.date).getTime())
      tMin = Math.min(...times)
      tMax = Math.max(...times)
    }
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

    // clamp(true) is a no-op outside event scope (tMin/tMax already bound
    // the data exactly there) and is what pins the pre-event anchor point
    // to the left edge when xDomain is forced -- see the comment above.
    const x = scaleTime().domain([tMin, tMax]).range([PAD.l, W - PAD.r]).clamp(true)
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

      // Cut at eliminatedAt (set by Ratings.jsx for an event-scoped chart on
      // whichever team lost its last match there) -- the line and area both
      // stop there rather than continuing flat through the idle rating a
      // team holds once it's out. splitIdx lands on the elimination point
      // itself, included so the line still visibly reaches that result
      // instead of stopping one point short of it.
      const splitIdx = s.eliminatedAt ? coords.findIndex((c) => c.date >= s.eliminatedAt) : -1
      const liveCoords = splitIdx === -1 ? coords : coords.slice(0, splitIdx + 1)

      return {
        ...s,
        uid: `s${i}`,
        color: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
        coords: liveCoords,
        linePath: curve(liveCoords),
        areaPath: fillArea(liveCoords),
      }
    })

    // International-event bands, clipped to the visible time domain and
    // dropped entirely if they don't overlap it at all -- a Champions band
    // from a year the chart isn't showing (or from before the earliest
    // charted team debuted) shouldn't draw a sliver at the plot's edge.
    // Widths under a couple of pixels (a Bo1-only bracket day) are floored
    // so the band is still visible rather than vanishing to a hairline.
    const bands = eventBands
      .filter((b) => STAGE_STYLE[b.stage])
      .map((b) => {
        const s = new Date(`${b.start}T00:00:00Z`).getTime()
        const e = new Date(`${b.end}T23:59:59Z`).getTime()
        if (e < tMin || s > tMax) return null
        const x1 = x(Math.max(s, tMin))
        const x2 = Math.max(x(Math.min(e, tMax)), x1 + 3)
        return { ...b, x1, x2, style: STAGE_STYLE[b.stage] }
      })
      .filter(Boolean)

    const dates = all.map((p) => p.date).sort()
    return {
      x,
      y,
      shaped,
      bands,
      // At most four gridlines, on round values, chosen by d3's own tick
      // algorithm -- they read as a scale rather than as arbitrary fractions
      // of whatever range the data happens to span.
      ticks: y.ticks(4),
      // Axis-end labels follow the same forced domain as everything else
      // when it's set -- otherwise the corner would read "Feb 27" (the
      // anchor point's real date) while the axis itself starts at Feb 28.
      firstDate: xDomain ? xDomain.start : dates[0],
      lastDate: xDomain ? xDomain.end : dates[dates.length - 1],
      annotations: detailed && shaped[0] ? findAnnotations(shaped[0].coords) : [],
    }
  }, [visible, detailed, baseline, H, W, eventBands, xDomain])

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
        // `synthetic` is the one deliberate exception -- the event-scoped
        // chart's pre-event anchor point (see Ratings.jsx's windowToEvent)
        // carries games: 0 same as any idle week, but it's a reading of
        // where a team stood rather than an absence of one, so it should
        // still be a place the cursor can land even though it draws no dot.
        if (!c.games && !c.synthetic) continue
        const d = Math.abs(c.cx - ux)
        if (d < bestDist) { bestDist = d; bestDate = c.date }
      }
    }
    if (!bestDate) return
    const rows = geom.shaped
      .map((s) => ({ series: s, point: s.coords.find((c) => c.date === bestDate) }))
      .filter((r) => r.point)
    if (!rows.length) return
    setHover({
      date: bestDate,
      rows,
      cx: rows[0].point.cx,
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

  // The side table's un-hovered default: each series' own most recent
  // point, rather than one shared date the way a hover match does. An
  // eliminated team's most recent point IS its elimination -- there's
  // nothing after it to share a date with the teams still going, so this
  // reads naturally as "where everyone last stood" without needing every
  // row to agree on when that was.
  const latestRows = useMemo(() => {
    if (!geom) return []
    return geom.shaped
      .map((s) => ({ series: s, point: s.coords[s.coords.length - 1] }))
      .filter((r) => r.point)
  }, [geom])

  const displayRows = hover ? hover.rows : latestRows
  const displayDate = hover ? hover.date : geom?.lastDate

  // The side table sits alongside the WHOLE left column now -- the team
  // toggles, the band legend, and the chart, not just the chart's own plot
  // area -- so it stretches to match that column's natural height (CSS
  // `align-items: stretch`, the row's default) rather than anything measured
  // here. minHeight is the one thing still computed: enough for up to 16
  // rows so an 8-16 team Masters/Champions field reads at a glance instead
  // of through a scrollbar, for whichever of "stretch to the column" or
  // "fit 16 rows" turns out taller. A field past 16 (Lock-In's 30, capped to
  // 16 anyway by Ratings.jsx) still scrolls past that point.
  //
  // Sized off `visible.length` -- the full set of series this chart was
  // given, muted ones included -- rather than `displayRows.length`. That one
  // carries the hover/no-hover distinction (a hovered date can have fewer
  // rows than the full field, if a team hadn't debuted yet), and sizing off
  // it would make the box grow and shrink as the cursor moves. The box's
  // size is a property of what chart this is, not of whatever moment it's
  // currently showing.
  //
  // ROW_H/CHROME_H are measured off the row markup below (text-xs row +
  // gap-1.5, the date header, and the container's own padding/gaps), not
  // exact to the pixel, but this is a box height, not layout math anything
  // else depends on.
  const ROW_H = 24
  const CHROME_H = 40
  const contentRows = Math.min(visible.length, 16)
  const tableMinHeight = CHROME_H + contentRows * ROW_H

  return (
    <div className="flex flex-col gap-3">
      {(title || controls) && (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5 min-w-0">
            {title && (
              <h3 className="font-display text-sm font-semibold flex items-center gap-2" style={{ color: RC.text }}>
                {accentColor && <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: accentColor }} />}
                {title}
              </h3>
            )}
            {subtitle && <p className="text-[11px]" style={{ color: RC.textDim }}>{subtitle}</p>}
          </div>
          {controls && <div className="flex items-center gap-2 shrink-0">{controls}</div>}
        </div>
      )}

      {/* Team toggles, band legend, and the chart itself share one column
          now, sized against the side table next to it. `items-start` rather
          than stretch -- the table sizes to its OWN content (floored at
          tableMinHeight, see its comment) instead of being forced to match
          this column's height exactly, which on a wrapped 12-16-chip legend
          could be taller than 16 rows actually need and left a dead gap
          under the last one. Short tags rather than full names (TeamLogo's
          showTag) keep that legend wrapping to two or three lines instead
          of six or seven -- every team in teamLogos.json carries one. */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
      <div className="flex-1 min-w-0 flex flex-col gap-3">
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
                {/* Dimmed as one unit rather than struck through -- there's
                    no text span of our own left to put a line through once
                    the label is TeamLogo's icon+tag, and the muted color/
                    opacity here plus the dot's above already read clearly
                    as "off". */}
                <span style={{ opacity: off ? 0.5 : 1 }}>
                  <TeamLogo team={s.label} size={14} showName={false} showTag />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {geom?.bands.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 -mb-1">
          {Object.entries(STAGE_STYLE)
            .filter(([stage]) => geom.bands.some((b) => b.stage === stage))
            .map(([stage, style]) => (
              <span key={stage} className="flex items-center gap-1.5 text-[10px]" style={{ color: RC.textDim }}>
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: style.color, opacity: 0.7 }} />
                {style.label}
              </span>
            ))}
          {onBandClick && (
            <span className="text-[10px]" style={{ color: RC.textDim, opacity: 0.7 }}>
              — click a band for its field
            </span>
          )}
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

            {/* International-event bands, drawn first so gridlines, the
                baseline, and every series render on top of the tint rather
                than under it. */}
            {geom.bands.map((b) => (
              <g
                key={b.id}
                clipPath={`url(#${gradId}-clip)`}
                onClick={onBandClick ? () => onBandClick(b) : undefined}
                style={onBandClick ? { cursor: 'pointer' } : undefined}
              >
                {/* A wider, invisible hit target under the visible tint --
                    the real band is often just a few days wide (a single
                    Bo1 bracket day floors to 3px), too thin to click
                    reliably otherwise. */}
                {onBandClick && (
                  <rect
                    x={Math.max(b.x1 - 4, PAD.l)} y={PAD.t}
                    width={Math.min(b.x2 + 4, W - PAD.r) - Math.max(b.x1 - 4, PAD.l)}
                    height={H - PAD.t - PAD.b}
                    fill="transparent"
                  />
                )}
                <rect
                  x={b.x1} y={PAD.t} width={b.x2 - b.x1} height={H - PAD.t - PAD.b}
                  fill={b.style.color} opacity="0.14"
                />
                {onBandClick && <title>{`${b.name} — click to scope the chart to its field`}</title>}
                {b.x2 - b.x1 > 34 && (
                  <text
                    x={(b.x1 + b.x2) / 2} y={PAD.t + 11} textAnchor="middle"
                    style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.02em', fill: b.style.color, opacity: 0.9 }}
                  >
                    {b.style.label.toUpperCase()}
                  </text>
                )}
              </g>
            ))}

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
                turn into a field of circles. Nothing to filter for
                elimination here -- geom already cut a team's coords at its
                last match, so there's no later "idle" games:0 stretch for
                this to skip in the first place. */}
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

      </div>
      </div>

      {/* A fixed side table rather than a tooltip that follows the cursor --
          it stays put, updates with whatever's hovered, and falls back to
          latestRows (each series' own most recent point) so it's never
          blank. The vertical crosshair line inside the SVG above is still
          what actually marks the hovered date; this just reads it. Sizes to
          its own content, floored at tableMinHeight (up to 16 rows worth) --
          see the row's own `items-start` comment on why that's a floor
          rather than a stretch-to-match-the-column height. */}
      {geom && (
        <div
          className="w-full lg:w-52 shrink-0 flex flex-col gap-1.5 px-3 py-2 rounded-xl overflow-y-auto"
          style={{
            background: 'rgba(23,27,36,0.5)',
            border: `1px solid ${RC.border}`,
            minHeight: tableMinHeight,
          }}
        >
          <div className="text-[10px] uppercase tracking-wide sticky top-0" style={{ color: RC.textDim }}>
            {shortDate(displayDate)}
          </div>
          <div className="flex flex-col gap-1.5">
            {displayRows
              .slice()
              .sort((a, b) => b.point.rating - a.point.rating)
              .map(({ series: s, point }) => (
                <div key={s.key} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="font-semibold tabular-nums" style={{ color: RC.text }}>
                      {num(point.rating)}
                    </span>
                    {/* Hover-only: a team's LATEST point always carries its
                        own last change (that's just what the number is),
                        so showing it in the unhovered default state reads
                        as a badge appearing out of nowhere -- "since when?"
                        has no answer until a specific point is what's being
                        looked at. */}
                    {hover && point.change != null && point.games > 0 && (
                      <span
                        className="tabular-nums text-[11px] font-medium"
                        style={{ color: point.change >= 0 ? RC.positive : RC.accent }}
                      >
                        {point.change >= 0 ? '+' : ''}{num(point.change)}
                      </span>
                    )}
                    {series.length > 1 && (
                      // Icon + short tag rather than the full name: the row
                      // already spends width on the rating and (while
                      // hovering) a change badge, and a 20+ character name
                      // like "Nongshim RedForce" or "DetonatioN FocusMe"
                      // would either force a wrap or get clipped anyway.
                      // Every team in teamLogos.json carries a tag.
                      <span className="text-[11px] shrink-0" style={{ color: RC.textDim }}>
                        <TeamLogo team={s.label} size={14} showName={false} showTag />
                      </span>
                    )}
                  </div>
                  {displayRows.length === 1 && point.results?.length > 0 && (
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
          {displayRows.length === 1 && !displayRows[0].point.games && !displayRows[0].point.synthetic && (
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
