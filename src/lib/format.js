export function pct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const d = Number.isInteger(digits) ? digits : 1
  // Explicit round-half-up (matches VLR's own display convention -- e.g.
  // 52.5% displays as "53%", not "52%"). JS's toFixed() uses the
  // underlying float representation and can round inconsistently on
  // exact .5 boundaries, so this is done manually rather than relying on it.
  const factor = 10 ** d
  const rounded = Math.floor(v * 100 * factor + 0.5) / factor
  return `${rounded.toFixed(d)}%`
}

export function num(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const d = Number.isInteger(digits) ? digits : 0
  return v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
}

export function rating(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toFixed(2)
}

// Clock-time duration in seconds -> "44:31" or "1:01:51" once past an hour,
// matching VLR's own .map-duration display convention.
export function duration(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const s = Math.round(v)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

// Compact large numbers: 1234 -> "1.2K"
export function compact(v) {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
}

// Maps a value's rank within [min, max] to a red -> gold -> green color,
// using rft.gg's exact destructive/legendary/success token values.
export function scaleColor(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value) || min === max) {
    return 'transparent'
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  // destructive (247,102,94) -> legendary (255,212,125) -> success (74,201,126)
  const stops = [
    [247, 102, 94],
    [255, 212, 125],
    [74, 201, 126],
  ]
  const seg = t < 0.5 ? 0 : 1
  const localT = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5
  const [r1, g1, b1] = stops[seg]
  const [r2, g2, b2] = stops[seg + 1]
  const r = Math.round(r1 + (r2 - r1) * localT)
  const g = Math.round(g1 + (g2 - g1) * localT)
  const b = Math.round(b1 + (b2 - b1) * localT)
  return `rgba(${r}, ${g}, ${b}, 0.28)`
}
