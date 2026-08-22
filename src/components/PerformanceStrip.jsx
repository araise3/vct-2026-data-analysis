import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import Select from './ui/Select'
import teamLogos from '../lib/teamLogos.json'
import { shortDate, vlrMapUrl } from '../lib/format'

/**
 * Per-MAP performance bars -- a direct 1:1 clone of rft.gg's own
 * "Performances" panel (reference: a saved copy of a real rft.gg player
 * page, inspected for its literal DOM/CSS rather than approximated from a
 * screenshot). One bar per MAP, not per series/match -- a Bo3 is 2-3 bars,
 * not one -- since a single series-average rating hides real map-to-map
 * swings the same way a season average hides real event-to-event ones. See
 * playerMapPerformance.js for how a per-map row is built (needs a
 * three-file join; match_players.json's own rating field is a series
 * average, not per-map).
 *
 * This is deliberately NOT the same thing as the rating-over-time line
 * chart further down the profile. That chart plots one point per match
 * DAY (rounds-weighted within the day) to show a trend; this shows one
 * bar per MAP, in order, with the opponent attached -- the question it
 * answers is "who did they do that against, on which map", which a
 * date-axis trend line can't show.
 *
 * Structure, lifted from the reference's real markup (class names/pixel
 * values below are transcribed from it, not guessed):
 *   - a metric dropdown sits top-right of the header (rft.gg's own "RFT
 *     1.0" selector, re-purposed here to switch which of this site's own
 *     per-map stats -- see STATS below -- drives the chart, rather than a
 *     metric-version picker this site has no equivalent of)
 *   - date headers group consecutive same-day maps, one label per run
 *   - each map is a `w-8` column: a `h-64` bar area (bar itself `w-6`,
 *     height a % of the selected stat's own domain) with a badge
 *     OVERLAPPING the bar's own top edge (absolutely positioned,
 *     translated up by half its own height -- this is what makes it look
 *     like it's "clipped onto" the bar rather than sitting inside it),
 *     then the opponent's logo + a small W/L mark + team tag underneath
 *   - a `h-64` vertical divider sits between consecutive date groups
 *   - the whole strip opens already scrolled to the most recent maps via
 *     the `direction: rtl` (outer) / `direction: ltr` (inner) flip -- a
 *     plain CSS trick for "start scrolled to the end of an LTR list",
 *     no JS scrollIntoView needed
 *
 * Two deliberate departures from a byte-for-byte clone:
 *   - The reference's bar-fill gradient uses a continuously-interpolated
 *     colour (not exactly any one of its own 6 badge colours -- confirmed
 *     by diffing real extracted RGB triples against the badge tier
 *     colours, e.g. a "tier 2" bar's gradient RGB doesn't match tier 2's
 *     own flat badge colour). Replicating that exact interpolation curve
 *     would need reverse-engineering a colour-scale function this site
 *     has no other use for; the bar gradient here reuses each map's own
 *     flat tier colour instead, which reads the same at a glance.
 *   - Badge text is whichever of this site's OWN per-map stats is
 *     selected, plain (no unit suffix, per direct request) -- rft.gg's
 *     own badge is always its single 0-100 metric; this site has several
 *     real per-map stats already sitting in team_map_detail.json's join
 *     (see playerMapPerformance.js), so the dropdown lets the chart be
 *     "the same panel" for each of them in turn rather than picking one.
 */

// Bar canvas height, transcribed from the reference's real class: h-64
// (256px). Column/bar widths (w-8/w-6) are expressed directly as literal
// Tailwind classes in the JSX below, not constants, since nothing computes
// off them.
const CHART_PX = 256
// A sliver floor so a near-domain-floor map still shows a visible colour
// hint -- the badge doesn't need to fit INSIDE the bar (it overlaps the
// bar's top edge regardless of height, matching the reference), so this
// only has to be tall enough to read as a bar, not tall enough to contain
// a label. BUT it does have to be tall enough that the badge -- centred on
// the bar's own top edge via `-translate-y-1/2`, so it extends UPWARD by
// half its own 30px height (15px) past that edge -- never extends past the
// bar's bottom edge too, straight into the W/L indicator on the team logo
// sitting in the `mt-2` gap right below this h-64 box. The original 6px
// floor was well under that 15px, so any near-domain-floor map (a real bug
// caught live: two 0.3x Rating maps right next to each other, both short
// enough to shove their red badges down into the team logos' "L" text)
// visibly collided every time. 18px clears the badge with a couple px of
// breathing room to spare.
const MIN_BAR_PX = 18

// The badge is centred on the bar's own top edge (see the `-translate-y-1/2`
// below) and so overlaps upward by roughly half its own rendered height
// (30px badge + 3px border each side = 36px, half = 18px). A maxed-out bar
// (100% of CHART_PX) would push the badge that far above the h-64 box's own
// top edge -- straight into the date header sitting a mere 8px (`mb-2`)
// above it. Capping the tallest a bar can ever get keeps the badge's
// overlap inside the box itself instead of into the header text.
const BADGE_CLEARANCE_PX = 20
const BAR_MAX_PCT = ((CHART_PX - BADGE_CLEARANCE_PX) / CHART_PX) * 100

// A long career can run to hundreds of maps. Capped rather than rendering
// all of them -- the RTL scroll trick (see the component below) already
// opens on the most recent ones, so this cap mostly just bounds worst-case
// DOM size for a long-tenured veteran rather than hiding anything a visitor
// would naturally scroll to.
const MAX_MAPS = 80

// rft.gg's own 6-step badge palette (--score-1..--score-6 in its real
// stylesheet: blue -> teal -> green -> gold -> orange -> red), keyed 1
// (best) through 6 (worst) here to match. Complete literal class strings
// (not built via interpolation) since Tailwind's JIT scanner needs the
// full class text present verbatim in source to generate it.
// Exported so PlayerOfWeekCard's own compact recent-maps strip (a mini
// version of this same bar+badge treatment, embedded in the rail card
// rather than a full standalone panel) can colour its bars identically
// without duplicating the tier tables or cutoffs.
export const TIER_STYLES = {
  1: { bg: 'bg-score-1', text: 'text-white', hex: '0, 51, 255' },
  2: { bg: 'bg-score-2', text: 'text-black', hex: '20, 184, 166' },
  3: { bg: 'bg-score-3', text: 'text-black', hex: '29, 210, 94' },
  4: { bg: 'bg-score-4', text: 'text-black', hex: '234, 179, 8' },
  5: { bg: 'bg-score-5', text: 'text-black', hex: '255, 104, 0' },
  6: { bg: 'bg-score-6', text: 'text-white', hex: '255, 0, 51' },
}
const NO_TIER = { bg: 'bg-surface2', text: 'text-muted', hex: null }

// Rating gets the site's OWN established tier cutoffs (format.js's
// ratingTier -- Excellent/Great/Good/Average/Below average/Poor, already
// shown on this page's own "Avg Rating 2.0" card) instead of an even split
// of its domain, since those boundaries are this site's real vocabulary
// for "how good is this rating", not arbitrary.
export function ratingTierIndex(v) {
  if (v >= 1.25) return 1
  if (v >= 1.12) return 2
  if (v >= 1.02) return 3
  if (v >= 0.95) return 4
  if (v >= 0.88) return 5
  return 6
}

// Every other stat has no established sitewide tiering, so its domain is
// just split into 6 equal bands -- bucket 5 (top of the domain) -> tier 1
// (best/blue), bucket 0 (bottom) -> tier 6 (worst/red).
function domainTierIndex(v, [min, max]) {
  const t = Math.min(1, Math.max(0, (v - min) / (max - min)))
  const bucket = Math.min(5, Math.floor(t * 6))
  return 6 - bucket
}

function kdValue(r) {
  if (r.kills == null || r.deaths == null) return null
  return r.deaths === 0 ? r.kills : r.kills / r.deaths
}

/** Every per-map stat the chart can be switched to -- each one a plain
 * accessor over playerMapPerformance.js's own row shape, a display
 * formatter (no unit suffix, per direct request -- the dropdown label
 * already says what it is), a fixed domain the bar heights are drawn
 * against (so heights stay comparable map to map, same reasoning the old
 * single-stat MIN_RATING/MAX_RATING clamp already used), and a tier
 * function deciding which of the 6 badge colours a value earns. */
const STATS = [
  { key: 'rating', label: 'Rating 2.0', get: (r) => r.rating, format: (v) => v.toFixed(2), domain: [0.4, 1.8], tier: ratingTierIndex },
  { key: 'acs', label: 'ACS', get: (r) => r.acs, format: (v) => Math.round(v).toString(), domain: [100, 350], tier: (v) => domainTierIndex(v, [100, 350]) },
  { key: 'adr', label: 'ADR', get: (r) => r.adr, format: (v) => Math.round(v).toString(), domain: [50, 200], tier: (v) => domainTierIndex(v, [50, 200]) },
  { key: 'kd', label: 'K/D', get: kdValue, format: (v) => v.toFixed(2), domain: [0.3, 2.5], tier: (v) => domainTierIndex(v, [0.3, 2.5]) },
  { key: 'kast', label: 'KAST', get: (r) => r.kast, format: (v) => `${Math.round(v * 100)}%`, domain: [0.4, 1.0], tier: (v) => domainTierIndex(v, [0.4, 1.0]) },
  { key: 'hsPct', label: 'HS%', get: (r) => r.hsPct, format: (v) => `${Math.round(v * 100)}%`, domain: [0, 0.6], tier: (v) => domainTierIndex(v, [0, 0.6]) },
]

function heightPct(v, [min, max]) {
  if (v == null) return 0
  const clamped = Math.min(max, Math.max(min, v))
  return ((clamped - min) / (max - min)) * BAR_MAX_PCT
}

/** Groups consecutive rows sharing the same calendar `date` into one
 * header block. */
function groupByDate(rows) {
  const groups = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.date === r.date) last.rows.push(r)
    else groups.push({ date: r.date, rows: [r] })
  }
  return groups
}

function tagFor(team) {
  return teamLogos[team]?.tag || team
}

export default function PerformanceStrip({ rows }) {
  const [statKey, setStatKey] = useState('rating')
  const stat = STATS.find((s) => s.key === statKey)

  const bars = useMemo(
    () => (rows.length > MAX_MAPS ? rows.slice(-MAX_MAPS) : rows),
    [rows]
  )
  const dateGroups = useMemo(() => groupByDate(bars), [bars])

  return (
    <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink">Performances</h3>
        <Select
          value={statKey}
          onChange={setStatKey}
          options={STATS.map((s) => ({ value: s.key, label: s.label }))}
        />
      </div>

      {!bars.length ? (
        <div className="flex items-center justify-center p-5">
          <p className="text-muted text-sm">No maps in this scope.</p>
        </div>
      ) : (
        // The RTL/LTR flip: setting the SCROLL CONTAINER to rtl makes its
        // scroll-start edge the visual right, so a horizontally-overflowing
        // LTR-ordered child opens already scrolled to its own right end
        // (the most recent maps, since `bars` is oldest -> newest) with no
        // scrollIntoView call needed. The inner content div flips back to
        // ltr so its own children (dates oldest-to-newest, left-to-right)
        // read normally.
        <div className="overflow-x-auto pb-4" style={{ direction: 'rtl' }}>
          <div className="flex min-w-max gap-1 px-4 pt-2" style={{ direction: 'ltr' }}>
            {dateGroups.map((g, gi) => (
              <div className="flex" key={`${g.date}-${gi}`}>
                <div className="flex flex-col">
                  <div className="mb-2 px-1 text-center text-[10px] font-medium text-muted whitespace-nowrap">
                    {(shortDate(g.date) || '').toUpperCase()}
                  </div>
                  <div className="flex gap-x-0.5">
                    {g.rows.map((b) => {
                      const value = stat.get(b)
                      const tierStyle = value != null ? TIER_STYLES[stat.tier(value)] : NO_TIER
                      return (
                        <div key={b.id} className="flex w-10 shrink-0 flex-col items-center">
                          <a
                            href={vlrMapUrl(b.matchId, b.gameId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${b.date} — Map ${b.mapIndex + 1} (${b.map}) vs ${b.opponent} ${b.score} — ${stat.label} ${value != null ? stat.format(value) : '—'} — open on vlr.gg`}
                            className="group relative flex h-64 w-full items-end justify-center"
                          >
                            <div
                              className="relative w-6 rounded-t-lg transition-all group-hover:opacity-90"
                              style={{
                                height: `${Math.max(heightPct(value, stat.domain), value != null ? (MIN_BAR_PX / CHART_PX) * 100 : 0)}%`,
                                background: tierStyle.hex
                                  ? `linear-gradient(rgba(${tierStyle.hex}, 0.3), rgba(${tierStyle.hex}, 0))`
                                  : undefined,
                              }}
                            >
                              {value != null && (
                                <div
                                  // min-w-[30px] alone (rft.gg's own transcribed value, sized for
                                  // ITS single 0-100 integer metric) isn't wide enough for this
                                  // site's own repurposed badge text -- a 2-decimal value like
                                  // "0.62" or a percentage like "91%" already renders ~36-40px wide,
                                  // wider than the then-w-8 (32px) column that used to hold it,
                                  // which let adjacent maps' badges overlap. The column itself grew
                                  // to w-10 (40px) + a small inter-column gap below to match.
                                  className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 flex h-[30px] min-w-[34px] items-center justify-center rounded-lg px-[3px] text-[12px] font-bold whitespace-nowrap transition-transform group-hover:scale-105 border-[3px] border-surface ${tierStyle.bg} ${tierStyle.text}`}
                                >
                                  {stat.format(value)}
                                </div>
                              )}
                            </div>
                          </a>
                          <Link
                            to={`/teams/${encodeURIComponent(b.opponent)}`}
                            className="hover:opacity-70 mt-2 flex h-11 flex-col items-center justify-end gap-1"
                          >
                            <div className="relative">
                              <TeamLogo team={b.opponent} size={20} showName={false} />
                              {b.won != null && (
                                <span
                                  className={`absolute -top-1 -right-1.5 text-[7px] font-bold leading-none ${b.won ? 'text-good' : 'text-bad'}`}
                                >
                                  {b.won ? 'W' : 'L'}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-semibold text-muted truncate max-w-10">
                              {tagFor(b.opponent)}
                            </span>
                          </Link>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {gi < dateGroups.length - 1 && (
                  <div className="mx-1.5 mt-6 h-64 w-px bg-hairline/50 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
