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
// 1"), which reads wrong for the acronyms in them, and each competition's
// raw naming convention buries the year in a different spot (VCT puts it
// right after "Vct"; EWC's qualifiers bury it before the region). Lives
// here rather than in FilterPanel because the match history, Tournaments
// page, and PlayerProfile's event picker all label the same raw event
// names outside the filter UI. Pattern-based (not a per-event lookup) so
// a brand-new event next season formats correctly with no code change --
// only Champions 2025's host city is a one-off override, since that's a
// real-world fact ("Paris") this data has no field for, not a naming
// convention that generalizes.
//
// Note region/stage words are matched anywhere in the string, not just at
// a fixed position -- "Emea" appears mid-name on VCT ("Vct 2026 Emea
// Kickoff") but trails on EWC's older naming ("...Emea Qualifier") -- and
// word boundaries keep the match from touching a real word that merely
// starts with those letters.
export function eventLabel(name) {
  const raw = name || ''

  // 2025's Pacific qualifier carries the full "X Asian Champions League"
  // co-sanctioning credit in its raw name (vlr.gg's own title for it) --
  // shortened here to match every other qualifier's plain "<Region>
  // Qualifier <year>" shape, a one-off override rather than a naming
  // convention (2026's Pacific Qualifier has no such credit in its name).
  if (raw === 'Esports World Cup 2025 Pacific X Asian Champions League Qualifier') {
    return 'EWC Pacific Qualifier 2025'
  }

  // Esports World Cup: abbreviated to EWC, year moved to the end --
  // "Esports World Cup 2026 Americas Qualifier" -> "EWC Americas
  // Qualifier 2026", "Esports World Cup 2026" -> "EWC 2026".
  const ewc = raw.match(/^Esports World Cup (\d{4})\s*(.*)$/)
  if (ewc) {
    const [, year, rest] = ewc
    const restLabel = rest.replace(/\bEmea\b/g, 'EMEA').trim()
    return restLabel ? `EWC ${restLabel} ${year}` : `EWC ${year}`
  }

  // Champions 2025 was held in Paris -- the only Champions this data
  // needs a host city for; 2026's isn't hardcoded anywhere else on the
  // site, so it isn't invented here either.
  if (raw === 'Valorant Champions 2025') return 'Champions Paris 2025'

  // Masters/Champions: drop the "Valorant" prefix -- city/year (Masters)
  // or year alone (Champions) already trail in the raw name, so nothing
  // else needs to move.
  const withoutValorant = raw.replace(/^Valorant\s+/, '')
  if (withoutValorant !== raw) return withoutValorant

  // Domestic VCT events: drop the "Vct" prefix and move the year from the
  // front to the end -- "Vct 2026 Americas Kickoff" -> "Americas Kickoff
  // 2026".
  const vct = raw.match(/^Vct (\d{4}) (.+)$/)
  if (vct) {
    const [, year, rest] = vct
    return `${rest.replace(/\bEmea\b/g, 'EMEA')} ${year}`
  }

  // 2023/2024 backfill events: VLR's own raw names for these two seasons
  // are titled "Champions Tour <year> <rest>" rather than "Vct <year>
  // <rest>" (2025/2026's shape) -- confirmed against the real scraped
  // names, not assumed from the later seasons' pattern. Same year-to-the-
  // end treatment as the "Vct" case above, e.g. "Champions Tour 2024
  // Masters Madrid" -> "Masters Madrid 2024", "Champions Tour 2023 Emea
  // League" -> "EMEA League 2023".
  const ct = raw.match(/^Champions Tour (\d{4}) (.+)$/)
  if (ct) {
    const [, year, rest] = ct
    return `${rest.replace(/\bEmea\b/g, 'EMEA')} ${year}`
  }

  return raw.replace(/^Vct\b/, 'VCT').replace(/\bEmea\b/g, 'EMEA')
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

// Deep-links straight to one map's own scoreboard tab, via VLR's own opaque
// per-map id (`gameId` -- its `?game=<id>` query param). Confirmed live this
// is the ONLY thing that works for this: a position-based `?map=1/2/3` param
// also exists in VLR's own markup but does NOT actually select that map on a
// fresh page load, only this id does -- `&tab=overview` is required too, or
// VLR defaults to a blank tab state.
//
// Falls back to the plain match link when `gameId` is null -- true for any
// map scraped before the scraper started keeping this id (see
// vlr_vct_scraper.py's own migration comment) -- so an old map still links
// somewhere useful instead of a broken deep link.
export function vlrMapUrl(matchId, gameId) {
  if (!gameId) return vlrMatchUrl(matchId)
  return `https://www.vlr.gg/${matchId}?game=${gameId}&tab=overview`
}

// tracker.gg's own profile URL shape, /valorant/profile/riot/{riotId}, where
// riotId is the player's real in-game "Name#Tag" -- NOT their VLR handle or
// real name, and not derivable from either (checked live against both this
// site's own data sources: neither VLR's player page nor Liquipedia's player
// infobox publishes it). `riotId` comes from `trackerLinks.json`, a small
// hand-curated map (same pattern as `liquipedia_overrides.json`) since
// there's no scrapable source of truth for this mapping.
export function trackerProfileUrl(riotId) {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotId)}`
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

// ---------------------------------------------------------------------------
// Dates
//
// Two DIFFERENT kinds of value live here and must not be conflated:
//
//   * ISO date strings ("2026-08-06") are CALENDAR dates with no timezone.
//     They are always parsed by splitting the string, never via `new Date(s)`
//     -- the Date constructor reads a bare YYYY-MM-DD as UTC midnight, which
//     renders as the PREVIOUS day for every viewer west of UTC. Every event
//     date and match date in public/data is this kind.
//
//   * Unix timestamps (upcoming_matches.json's `timestamp`) are absolute
//     INSTANTS. There `new Date(ts * 1000)` plus local getters is exactly
//     right, and is the whole reason the scraper ships a timestamp rather
//     than a pre-formatted date -- a date baked at scrape time would be the
//     wrong day for anyone in a different timezone.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-08-06" -> "Aug 6". Null-safe (returns null, not "—", so callers can
 * decide their own placeholder -- RosterTable's activeRange relies on this). */
export function shortDate(iso) {
  if (!iso) return null
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

/** "2026-08-06" -> "Aug 6, 2026". Same shape as shortDate but carrying the
 * year, for contexts spanning multiple seasons (a coach's stint history). */
export function longDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** "2000-07-22" -> "Jul 22, 2000 (26)" -- longDate plus the age computed
 * against today's real date (not the season's), since a birth date is a
 * real-world fact rather than something scoped to the current competitive
 * year the rest of this site's dates are. */
export function birthDateLabel(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const birth = new Date(y, m - 1, d)
  const now = new Date()
  let age = now.getFullYear() - y
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hadBirthdayThisYear) age -= 1
  return `${longDate(iso)} (${age})`
}

/** "2026-07-16" + "2026-09-06" -> "Jul 16 – Sep 6"; collapses to one date
 * when both sides are the same day, and tolerates either side missing. */
export function dateRangeLabel(start, end) {
  const a = shortDate(start)
  const b = shortDate(end)
  if (!a && !b) return ''
  if (!a) return b
  if (!b) return a
  return a === b ? a : `${a} – ${b}`
}

// Whole days between two ISO dates, via a UTC anchor so a DST boundary in the
// viewer's zone can't make a day count come out 1 short (a local-midnight
// subtraction is 23 or 25 hours across a transition).
function daysBetween(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split('-').map(Number)
  const [y2, m2, d2] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/** Today as "YYYY-MM-DD" in the viewer's own timezone. */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Event countdown badge, mirroring rft.gg's own: `now` while an event is
 * running, `in 46d` before it starts, `ended` after.
 *
 * Returns `{ text, tone }` rather than a bare string so the caller picks the
 * colour -- there is no single right accent for all three states.
 * An event with no known dates returns null (render nothing), never a guess.
 */
export function countdown(startDate, endDate, now = new Date()) {
  if (!startDate && !endDate) return null
  const today = todayKey(now)
  const start = startDate || endDate
  const end = endDate || startDate
  if (today < start) {
    const d = daysBetween(today, start)
    // Past ~2 months a day count stops being readable at a glance; rft.gg
    // keeps days throughout, so this does too rather than inventing a
    // months unit it never shows.
    return { text: `in ${d}d`, tone: 'muted' }
  }
  if (today > end) return { text: 'ended', tone: 'muted' }
  return { text: 'now', tone: 'live' }
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
// so a spread anywhere near scaleColor's whole-range assumption left every
// cell nearly grey -- 8 points is calibrated to that actual spread so a
// real outlier (a lopsided map) hits full color rather than needing an
// implausible 50%+65% win rate to do so. Saturation still runs past
// scaleColor's own peak (35% vs. 20%) since this table only has two rows
// to carry the signal, but 55% (tried first) rendered outliers neon-bright
// rather than just clearly colored -- 35% is the toned-down middle ground.
const DIVERGE_SPREAD = 0.08
const DIVERGE_MAX_SAT = 35
export function scaleDivergingColor(value, mid = 0.5) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'transparent'
  const t = Math.max(-1, Math.min(1, (value - mid) / DIVERGE_SPREAD))
  const hue = t >= 0 ? 120 : 0
  return `hsl(${hue}, ${Math.abs(t) * DIVERGE_MAX_SAT}%, ${LIGHT}%)`
}
