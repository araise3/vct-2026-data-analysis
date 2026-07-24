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

// Maps a value's position within [min, max] to VLR's own stats-table
// heatmap color. Reverse-engineered from a real vlr.gg/stats page source
// (not guessed): every colored cell there is `hsl(var(--stat-h), 20%, 45%)`,
// where --stat-h is a hue in degrees, linearly interpolated across a
// value range and clamped to [0, 270] (red -> orange -> yellow -> green
// -> cyan -> blue -> violet, not the more common red-green-only
// traffic-light scheme).
//
// The [min, max] range is the current view's own min/max, not a fixed
// global constant -- confirmed across two separate real screenshots: a
// player with Rating 1.33 hit the maximum hue (270°) on one page, while a
// player with a *higher* Rating (1.42) on a different, broader page only
// reached 259.6°. That's only possible if each page computes its own
// range from whichever rows currently qualify, which is what min/max here
// already does (DataTable passes the currently-displayed rows' own
// min/max for each colorScale column).
//
// The color law itself (hsl hue + fixed 20%/45% saturation/lightness) is
// separately confirmed by sampling actual rendered pixels against their
// known intended hue on both screenshots: a cell with hue 260 rendered as
// rgb(107,92,138) -> H=259.6° S=20.0% L=45.1%, and a cell with hue 270
// rendered as rgb(115,92,138) -> H=270.0° S=20.0% L=45.1%. That's VLR's
// real, fairly muted value; bumped to 50%/42% here for a punchier look
// on request -- same hue math, just more saturated and a touch darker so
// text on top stays readable.
const SAT = 50
const LIGHT = 42
export function scaleColor(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value) || min === max) {
    return 'transparent'
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return `hsl(${t * 270}, ${SAT}%, ${LIGHT}%)`
}
