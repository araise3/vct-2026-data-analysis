import { useMemo } from 'react'

/**
 * Peer-relative radar chart -- one spoke per stat, each on its own scale
 * (that axis's qualified-peer domain, see radarProfile.js), radius is the
 * subject's percentile position within that band. Shape is only ever
 * meaningful as "where does this player sit relative to the field," never
 * as an absolute magnitude comparison between two different spokes.
 *
 * `axes`: the `axes` array from buildRadarProfile() -- each entry carries
 * `norm` (0-1 position to plot), `ticks` (9 real-value gridline labels,
 * outer-to-inner), and `formatted`/`rank`/`n` for the label + tooltip.
 *
 * Rendered as inline SVG with a viewBox and no fixed size, matching
 * TrendChart's convention (scales to whatever container it's dropped
 * into, no charting library).
 */
export default function RadarChart({ axes }) {
  const W = 480
  const H = 480
  const cx = W / 2
  const cy = H / 2
  const R = 150
  const RINGS = [0.25, 0.5, 0.75, 1]

  const geom = useMemo(() => {
    const n = axes.length
    if (n < 3) return null
    const angleOf = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n
    const pointAt = (i, r) => {
      const a = angleOf(i)
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    }
    const polygon = (radii) =>
      axes.map((_, i) => pointAt(i, radii[i])).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

    const dataPolygon = polygon(axes.map((a) => a.norm * R))
    const dataVertices = axes.map((a, i) => ({ ...pointAt(i, a.norm * R), axis: a }))

    const gridRings = RINGS.map((f) => polygon(axes.map(() => R * f)))
    const spokes = axes.map((_, i) => pointAt(i, R))

    // Tick labels along each spoke at 25/50/75% -- rotated to follow the
    // spoke's own angle (matching the reference chart), but flipped 180
    // when that would render the text upside down on the left half.
    const ticks = axes.flatMap((a, i) =>
      [0.25, 0.5, 0.75].map((f) => {
        const p = pointAt(i, R * f)
        const angleDeg = (angleOf(i) * 180) / Math.PI
        const displayAngle = angleDeg > 90 ? angleDeg - 180 : angleDeg < -90 ? angleDeg + 180 : angleDeg
        const tickIdx = Math.round(f * 8)
        return {
          key: `${a.key}-${f}`,
          x: p.x, y: p.y,
          rotate: displayAngle,
          text: a.format(a.ticks[tickIdx]),
        }
      })
    )

    // Axis name + bold value, placed just past the outer ring. Anchor
    // side follows which half of the circle the spoke points into so
    // labels read outward rather than overlapping the plot.
    const labels = axes.map((a, i) => {
      const angle = angleOf(i)
      const p = pointAt(i, R + 34)
      const cos = Math.cos(angle)
      const anchor = cos > 0.15 ? 'start' : cos < -0.15 ? 'end' : 'middle'
      return { ...a, x: p.x, y: p.y, anchor }
    })

    return { dataPolygon, dataVertices, gridRings, spokes, ticks, labels }
  }, [axes, cx, cy, R])

  if (!geom) {
    return <p className="text-muted text-xs">Not enough peer data in this scope to plot a profile.</p>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {geom.gridRings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="currentColor" strokeWidth="1" className="text-hairline" />
      ))}

      {geom.spokes.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="1" className="text-hairline" />
      ))}

      {geom.ticks.map((t) => (
        <text
          key={t.key}
          x={t.x} y={t.y}
          transform={`rotate(${t.rotate.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)})`}
          textAnchor="middle"
          className="fill-current text-muted"
          style={{ fontSize: 7 }}
        >
          {t.text}
        </text>
      ))}

      <polygon
        points={geom.dataPolygon}
        fill="#FF4655" fillOpacity="0.28"
        stroke="#FF4655" strokeWidth="2" strokeLinejoin="round"
      />

      {geom.dataVertices.map((v) => (
        <circle key={v.axis.key} cx={v.x} cy={v.y} r="3" fill="#FF4655" stroke="#131619" strokeWidth="1.2">
          <title>
            {`${v.axis.label}: ${v.axis.formatted}${v.axis.rank ? ` (#${v.axis.rank} of ${v.axis.n})` : ''}`}
          </title>
        </circle>
      ))}

      {geom.labels.map((l) => (
        <g key={l.key}>
          <text
            x={l.x} y={l.y - 6}
            textAnchor={l.anchor}
            className="fill-current text-muted"
            style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.02em' }}
          >
            {l.label}
          </text>
          <text
            x={l.x} y={l.y + 9}
            textAnchor={l.anchor}
            className="fill-current text-ink"
            style={{ fontSize: 14, fontWeight: 700 }}
          >
            {l.formatted}
          </text>
        </g>
      ))}
    </svg>
  )
}
