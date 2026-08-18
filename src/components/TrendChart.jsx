import { useMemo } from 'react'

/**
 * Compact line chart of a value over time.
 *
 * points: [{ date: 'YYYY-MM-DD', value: number, n: number, label?: string }]
 *
 * `label`, when present, replaces the date in tooltips and axis ends --
 * used by callers plotting a non-time series (e.g. round number) that
 * still wants proportional x-spacing, which they get by mapping their
 * index onto consecutive synthetic dates.
 *
 * Rendered as inline SVG with a viewBox and no fixed width, so it scales
 * to whatever container it's dropped into. Gaps between dates are drawn
 * proportionally to real elapsed time rather than evenly spaced, so a
 * three-month off-season doesn't look like one game-day.
 *
 * Four optional props, all added for the /patches agent-trend view and all
 * no-ops when omitted (every existing call passes none of these):
 *   - `domain: [minDate, maxDate]` overrides the derived tMin/tMax -- lets
 *     a caller plot several agents' series on the same x-axis (the full
 *     patch-window range) rather than each series scaling to its own
 *     first/last dated point.
 *   - `bands: [{from, to, label?}]` shaded x-range rects (event date
 *     ranges), clamped into the plot area and skipped if fully outside it.
 *   - `markers: [{date, label, title?}]` vertical dashed lines (patch
 *     releases that changed the plotted agent), same clamping.
 *   - `highlight: (point) => boolean` renders matching points larger with
 *     a contrasting ring -- used to call out a `new`-type patch's point.
 * Render order: bands -> gridlines -> markers -> baseline -> path -> circles,
 * so shaded bands sit behind everything and point circles stay on top.
 */
export default function TrendChart({
  points, format = (v) => v.toFixed(2), baseline = null, height = 160,
  domain = null, bands = null, markers = null, highlight = null,
}) {
  const W = 600
  const H = height
  const pad = { l: 38, r: 10, t: 12, b: 22 }

  const geom = useMemo(() => {
    if (!points || points.length < 2) return null
    const times = points.map((p) => new Date(p.date).getTime())
    const vals = points.map((p) => p.value)
    let tMin = Math.min(...times)
    let tMax = Math.max(...times)
    if (domain) {
      tMin = new Date(domain[0]).getTime()
      tMax = new Date(domain[1]).getTime()
    }
    let vMin = Math.min(...vals)
    let vMax = Math.max(...vals)
    if (baseline !== null) {
      vMin = Math.min(vMin, baseline)
      vMax = Math.max(vMax, baseline)
    }
    // Pad the value axis so the line never sits exactly on the frame, and
    // guard the degenerate all-equal case (vMax === vMin) which would
    // otherwise divide by zero.
    const span = vMax - vMin || Math.abs(vMax) || 1
    vMin -= span * 0.12
    vMax += span * 0.12
    const tSpan = tMax - tMin || 1

    const x = (t) => pad.l + ((t - tMin) / tSpan) * (W - pad.l - pad.r)
    const y = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * (H - pad.t - pad.b)

    return {
      x, y, vMin, vMax, tMin, tMax,
      coords: points.map((p, i) => ({ ...p, cx: x(times[i]), cy: y(p.value) })),
    }
  }, [points, baseline, H, domain])

  if (!geom) {
    return <p className="text-muted text-xs">Not enough dated data to plot a trend.</p>
  }

  const path = geom.coords.map((c, i) => `${i ? 'L' : 'M'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ')
  const fmtDate = (d) => d.slice(5)

  // Clamp a [from, to] date range into the plot's x-extent; drop it
  // entirely if it falls fully outside [tMin, tMax] (e.g. an event that
  // ended before the chart's own domain begins).
  const clampedRange = (fromDate, toDate) => {
    const t1 = new Date(fromDate).getTime()
    const t2 = new Date(toDate).getTime()
    if (t2 < geom.tMin || t1 > geom.tMax) return null
    const x1 = Math.max(pad.l, geom.x(Math.max(t1, geom.tMin)))
    const x2 = Math.min(W - pad.r, geom.x(Math.min(t2, geom.tMax)))
    return [x1, x2]
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {bands && bands.map((b, i) => {
        const range = clampedRange(b.from, b.to)
        if (!range) return null
        const [x1, x2] = range
        return (
          <rect
            key={i} x={x1} y={pad.t} width={Math.max(0, x2 - x1)} height={H - pad.t - pad.b}
            className="fill-surface2" opacity="0.5"
          >
            {b.label && <title>{b.label}</title>}
          </rect>
        )
      })}

      {[geom.vMax, (geom.vMax + geom.vMin) / 2, geom.vMin].map((v, i) => (
        <g key={i}>
          <line
            x1={pad.l} x2={W - pad.r} y1={geom.y(v)} y2={geom.y(v)}
            stroke="currentColor" strokeWidth="1" className="text-hairline"
          />
          <text
            x={pad.l - 6} y={geom.y(v) + 3} textAnchor="end"
            className="fill-current text-muted" style={{ fontSize: 9 }}
          >
            {format(v)}
          </text>
        </g>
      ))}

      {markers && markers.map((m, i) => {
        const t = new Date(m.date).getTime()
        if (t < geom.tMin || t > geom.tMax) return null
        const mx = geom.x(t)
        return (
          <g key={i}>
            <line
              x1={mx} x2={mx} y1={pad.t} y2={H - pad.b}
              stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"
              className="text-accent" opacity="0.6"
            />
            {m.label && (
              <text
                x={mx} y={pad.t - 2} textAnchor="middle"
                className="fill-current text-accent" style={{ fontSize: 8 }}
              >
                {m.label}
              </text>
            )}
            {m.title && <title>{m.title}</title>}
          </g>
        )
      })}

      {baseline !== null && (
        <line
          x1={pad.l} x2={W - pad.r} y1={geom.y(baseline)} y2={geom.y(baseline)}
          stroke="currentColor" strokeWidth="1" strokeDasharray="3 3"
          className="text-muted" opacity="0.6"
        />
      )}

      <path d={path} fill="none" stroke="#2F80ED" strokeWidth="1.8"
            strokeLinejoin="round" strokeLinecap="round" />

      {geom.coords.map((c) => {
        const isHighlighted = highlight ? highlight(c) : false
        return (
          <circle
            key={c.date}
            cx={c.cx} cy={c.cy}
            r={isHighlighted ? 4.5 : 2.6}
            fill="#2F80ED"
            className={isHighlighted ? 'stroke-surface' : undefined}
            strokeWidth={isHighlighted ? 1.5 : 0}
          >
            <title>{`${c.label || c.date}: ${format(c.value)}${c.n ? ` (${c.n})` : ''}`}</title>
          </circle>
        )
      })}

      <text x={pad.l} y={H - 6} className="fill-current text-muted" style={{ fontSize: 9 }}>
        {geom.coords[0].label || fmtDate(geom.coords[0].date)}
      </text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-current text-muted" style={{ fontSize: 9 }}>
        {geom.coords[geom.coords.length - 1].label || fmtDate(geom.coords[geom.coords.length - 1].date)}
      </text>
    </svg>
  )
}
