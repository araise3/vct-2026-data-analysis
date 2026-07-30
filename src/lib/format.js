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
  // Locale hardcoded to 'en-US', not left as `undefined` (which defers to
  // the viewer's own browser/OS locale) -- a German-locale browser
  // renders toLocaleString(undefined, ...) with a comma decimal
  // separator ("171,1"), which doesn't match VLR's own always-English
  // number formatting and reads as a different number entirely at a
  // glance. This should be dot-decimal for every viewer, not just
  // English-locale ones.
  return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
}

export function rating(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toFixed(2)
}

/**
 * Qualitative label for a Rating 2.0 average -- the equivalent of the
 * word rft.gg prints under its headline rating ("EXCELLENT").
 *
 * Cutoffs are absolute, not relative to the current filter scope: 1.00 is
 * the fixed point Rating 2.0 is defined around (an exactly average
 * performance), so "Good" should mean the same thing on every profile
 * rather than shifting with whatever events happen to be selected.
 * Returns a `tone` matching the site's semantic colours.
 */
export function ratingTier(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return null
  if (v >= 1.25) return { label: 'Excellent', tone: 'text-good bg-good/10' }
  if (v >= 1.12) return { label: 'Great', tone: 'text-good bg-good/10' }
  if (v >= 1.02) return { label: 'Good', tone: 'text-mid bg-mid/10' }
  if (v >= 0.95) return { label: 'Average', tone: 'text-muted bg-surface2' }
  if (v >= 0.88) return { label: 'Below average', tone: 'text-bad bg-bad/10' }
  return { label: 'Poor', tone: 'text-bad bg-bad/10' }
}

// Event names come out of the scrape title-cased ("Vct 2026 Emea Stage
// 1"), which reads wrong for the acronyms in them. Lives here rather than
// in FilterPanel because the match history and Tournaments page label the
// same events outside the filter UI.
//
// Note the region acronym is fixed anywhere in the string, not just at the
// start like "Vct" -- it appears mid-name ("Vct 2026 Emea Kickoff"), and
// the word boundaries keep it from touching a real word that merely starts
// with those letters.
export function eventLabel(name) {
  return (name || '')
    .replace(/^Vct\b/, 'VCT')
    .replace(/\bEmea\b/g, 'EMEA')
}

// Short codes for the Teams table's Region column -- freeing up column
// width to give to Rounds. EMEA is already this short, so it passes through
// unchanged; anything not in the map (shouldn't happen with this dataset's
// four regions) does too, rather than showing blank.
const REGION_ABBR = { Americas: 'AMER', China: 'CN', Pacific: 'APAC' }
export function regionAbbr(region) {
  return REGION_ABBR[region] ?? region
}

// A match's `w` is "Phase: Round" ("Playoffs: Grand Final") -- the phase is
// usually already shown as its own grouping, so this pulls out just the
// round half. Values with no colon (a bare "Week 2") pass through whole.
export function roundLabel(w) {
  if (!w) return ''
  const i = w.indexOf(': ')
  return i === -1 ? w : w.slice(i + 2)
}

export function phaseLabel(w) {
  if (!w) return ''
  const i = w.indexOf(': ')
  return i === -1 ? w : w.slice(0, i)
}

// Every match id in this dataset IS the vlr.gg match id -- it's the primary
// key the scraper pulled the match under, and the scraper's own stored
// `match_url` is exactly this id plus a descriptive slug
// ("/594740/natus-vincere-vs-karmine-corp-vct-2026-emea-kickoff-ur1").
// vlr.gg resolves the bare-id form and redirects to the full slug, so the
// link needs no scraped URL carried through the export -- confirmed against
// live vlr.gg, /712809 resolves to the right series.
//
// This replaced the site's own per-match pages: rebuilding VLR's match view
// meant shipping 525 per-match JSON files (9.5MB, 45% of all site data) to
// show something VLR already shows better and keeps live.
export function vlrMatchUrl(id) {
  return `https://www.vlr.gg/${id}`
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
// rendered as rgb(115,92,138) -> H=270.0° S=20.0% L=45.1%. Using VLR's
// real values as-is.
const SAT = 20
const LIGHT = 45
export function scaleColor(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value) || min === max) {
    return 'transparent'
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return `hsl(${t * 270}, ${SAT}%, ${LIGHT}%)`
}

// Green/red diverging scale for a win rate around a fixed 50% midpoint --
// unlike scaleColor above (which stretches across whatever min/max the
// current view happens to contain), a win rate has a real, fixed neutral
// point regardless of scope, so the domain here is absolute rather than
// relative to the displayed rows. Real ATK/DEF win rates in this dataset
// only deviate ~0-9 points from 50 (a near-even coin flip almost always),
// so a spread anywhere near scaleColor's whole-range assumption left
// every cell nearly grey -- 8 points is calibrated to that actual spread
// so a real outlier (a lopsided map) hits full color rather than needing
// an implausible 50%+65% win rate to do so. Saturation also runs well
// past scaleColor's own peak (55% vs. 20%) -- this table has only two
// rows, so leaning on stronger color to carry the signal (rather than
// position in a big table) reads better here than matching that scale
// exactly would.
const DIVERGE_SPREAD = 0.08
const DIVERGE_MAX_SAT = 55
export function scaleDivergingColor(value, mid = 0.5) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'transparent'
  const t = Math.max(-1, Math.min(1, (value - mid) / DIVERGE_SPREAD))
  const hue = t >= 0 ? 120 : 0
  return `hsl(${hue}, ${Math.abs(t) * DIVERGE_MAX_SAT}%, ${LIGHT}%)`
}
