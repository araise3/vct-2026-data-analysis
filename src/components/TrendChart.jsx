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
 */
export default function TrendChart({ points, format = (v) => v.toFixed(2), baseline = null, height = 160 }) {
  const W = 600
  const H = height
  const pad = { l: 38, r: 10, t: 12, b: 22 }

  const geom = useMemo(() => {
    if (!points || points.length < 2) return null
    const times = points.map((p) => new Date(p.date).getTime())
    const vals = points.map((p) => p.value)
    const tMin = Math.min(...times)
    const tMax = Math.max(...times)
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
  }, [points, baseline, H])

  if (!geom) {
    return <p className="text-muted text-xs">Not enough dated data to plot a trend.</p>
  }

  const path = geom.coords.map((c, i) => `${i ? 'L' : 'M'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ')
  const fmtDate = (d) => d.slice(5)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
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

      {baseline !== null && (
        <line
          x1={pad.l} x2={W - pad.r} y1={geom.y(baseline)} y2={geom.y(baseline)}
          stroke="currentColor" strokeWidth="1" strokeDasharray="3 3"
          className="text-muted" opacity="0.6"
        />
      )}

      <path d={path} fill="none" stroke="#FF4655" strokeWidth="1.8"
            strokeLinejoin="round" strokeLinecap="round" />

      {geom.coords.map((c) => (
        <circle key={c.date} cx={c.cx} cy={c.cy} r="2.6" fill="#FF4655">
          <title>{`${c.label || c.date}: ${format(c.value)}${c.n ? ` (${c.n})` : ''}`}</title>
        </circle>
      ))}

      <text x={pad.l} y={H - 6} className="fill-current text-muted" style={{ fontSize: 9 }}>
        {geom.coords[0].label || fmtDate(geom.coords[0].date)}
      </text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-current text-muted" style={{ fontSize: 9 }}>
        {geom.coords[geom.coords.length - 1].label || fmtDate(geom.coords[geom.coords.length - 1].date)}
      </text>
    </svg>
  )
}
