import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandMatchRows, expandBuckets, aggregateOverview } from '../lib/entityBuckets'
import { buildEventList, currentCircuits } from '../lib/eventMeta'
import { recentResults } from '../lib/schedule'
import { buildRatings } from '../lib/teamRatings'
import { buildPlayerMapPerformance } from '../lib/playerMapPerformance'
import { ResultsRail } from '../components/MatchRail'
import CircuitList from '../components/CircuitList'
import PlayerOfWeekCard from '../components/PlayerOfWeekCard'
import { FACETS } from '../components/FilterPanel'
import Card from '../components/ui/Card'
import { num } from '../lib/format'
import { RegionTable, REGION_ORDER } from './Ratings'

/**
 * A compact restatement of the season-totals KPI strip that used to anchor
 * a whole separate "Season stats" section (filter panel, top-player/team
 * lists, leader cards) further down this page. That section got pared back
 * to just these six numbers -- the rest (including the "Player leaders"
 * cards) moved to Records.jsx, which already has its own faceted filter
 * and player-leaderboard cards (see PLAYER_LEADERS there) that these fit
 * better alongside. Sized down from KpiCard (used elsewhere at full size
 * for a single headline stat) since six of them need to sit inline with
 * the page's own title/toggle row rather than take a whole grid row.
 */
function KpiTile({ label, value }) {
  return (
    <Card className="px-3 py-2 flex flex-col gap-0.5 min-w-0">
      <span className="text-muted text-[9px] font-medium tracking-wide uppercase truncate">{label}</span>
      <span className="font-display text-lg font-semibold text-ink truncate">{value}</span>
    </Card>
  )
}

/**
 * Tournaments -- the site's landing page (`/`, also still reachable at
 * `/tournaments` for existing links/bookmarks -- TournamentDetail's "Back to
 * Tournaments" link and CircuitList/MatchRail both point at
 * `/tournaments/{name}`, which stays untouched).
 *
 * The centre column's events list (a browsable Scheduled/Finished month-by-
 * month card) was replaced by the same four regional Glicko-2 standings
 * tables /ratings shows (Americas/EMEA/Pacific/China) in a 2x2 grid --
 * `RegionTable`/`REGION_ORDER` are imported straight from Ratings.jsx (both
 * exported specifically for this reuse) rather than a second hand-rolled
 * version. A rating-trajectory-LINE-CHART version of this preview was tried
 * first and rejected per direct request in favour of literally this table.
 * This is also what used to be the left rail's TopRatedTeamsCard list (one
 * combined top-5 across every region), which is now gone entirely rather
 * than showing an overlapping-but-different set of teams twice.
 * `EventRow`/`splitByStatus`/`groupByMonth`/`monthLabel`/`TopRatedTeamsCard`
 * were this column's or the rail's own rendering for what they replaced and
 * had no other consumer, so they were deleted rather than left dead once
 * nothing called them any more. `events`/`currentCircuits` are still needed
 * for the left rail's CircuitList, which this change doesn't touch.
 *
 * Player of the Week now sits as a compact card in the left rail (its
 * default narrow layout -- see PlayerOfWeekCard's own comment on why its
 * once-separate `wide` banner variant was removed rather than kept unused),
 * with a mini recent-form strip (a few small Rating 2.0 badges/bars, per
 * direct request modelled on rft.gg's own "Player of the Month" widget)
 * embedded directly in that same card instead of living as its own separate
 * section. `mapPerformanceRows` -- built by `buildPlayerMapPerformance` from
 * `records` + `match_players.json` + `team_map_detail.json` (the last one
 * idle-loaded, matching PlayerProfile's own load timing for it) -- is what
 * feeds that strip; it's the exact same per-map row shape PlayerProfile.jsx
 * hands its own full-size PerformanceStrip, just passed to the card instead.
 *
 * A six-tile season KPI strip (see KpiTile above) sits inline in the header
 * row above the chart, fed by its own data fetch/loading state so it doesn't
 * hold up the rest of the column. That strip is what's left of a much bigger
 * "Season stats" section (KPIs, top players/teams, leader cards, faceted
 * filters) that used to live here (formerly its own Overview.jsx page at
 * `/`) -- everything but the KPIs themselves moved to Records.jsx.
 */
export default function Tournaments() {
  const { data: matchData, loading } = useData('match_results')
  const { data: eventMetaData } = useData('event_meta')
  const { data: upcomingData } = useData('upcoming_matches')
  const { data: playerWeekData } = useData('player_week')
  // scraper/vlr_player_photos_scraper.py's manifest -- same source
  // PlayerProfile's header photo reads from -- passed straight through to
  // PlayerOfWeekCard rather than resolving the one path needed here, so the
  // card owns its own hasPhoto/onError fallback logic exactly like
  // PlayerProfile's does.
  const { data: photosData } = useData('player_photos')
  const { data: pData, loading: pLoading } = useData('player_buckets')
  const { data: tData, loading: tLoading } = useData('team_buckets')
  const { data: matchPlayerData } = useData('match_players')
  // Same idle-load-then-join pattern PlayerProfile.jsx uses for its own
  // Performances strip -- team_map_detail.json is comparable in size to
  // match_players.json, so it waits for browser idle rather than competing
  // with this page's own first paint.
  const idle = useIdle()
  const { data: teamMapDetailData } = useData(idle ? 'team_map_detail' : null)

  const records = useMemo(() => expandMatchRows(matchData), [matchData])

  const events = useMemo(
    () => buildEventList(matchData, records, eventMetaData, upcomingData),
    [matchData, records, eventMetaData, upcomingData]
  )

  const recent = useMemo(() => recentResults(records, 8), [records])
  const circuits = useMemo(() => currentCircuits(events), [events])

  // Reuses matchData (already fetched above) rather than a second request --
  // Ratings.jsx's own comment notes the whole multi-year Glicko-2 build costs
  // ~23ms, so recomputing it here for four region tables is cheap. Only the
  // newest year's table is needed. Unlike Ratings.jsx's own ALWAYS_SETTLED
  // list, this doesn't re-apply per-team/year exceptions -- a front-page
  // preview isn't worth duplicating that table for.
  const ratingRuns = useMemo(() => (matchData ? buildRatings(matchData) : new Map()), [matchData])
  const ratingYear = [...ratingRuns.keys()][0]

  // Same grouping Ratings.jsx's own `byRegion` builds, reused here via the
  // exported RegionTable component itself (see that file's own comment on
  // why it's a hand-rolled table rather than four DataTables) -- a
  // rating-trajectory-chart version of this preview was tried and rejected
  // in favour of literally the same standings table the /ratings page
  // shows, just four of them in a smaller column.
  const byRegionTable = useMemo(() => {
    const run = ratingRuns.get(ratingYear)
    const out = new Map()
    if (!run) return out
    for (const t of run.table) {
      if (!out.has(t.region)) out.set(t.region, [])
      out.get(t.region).push(t)
    }
    return out
  }, [ratingRuns, ratingYear])

  // One row per MAP the Player of the Week actually played, across every
  // match in `records` -- buildPlayerMapPerformance itself is what narrows
  // that full list down to just this one player's own matches (see its own
  // comment). Fed to PlayerOfWeekCard's own mini strip (its `mapRows` prop),
  // which slices off just the last few maps itself -- passed in full here
  // rather than pre-sliced so it stays the same shape PlayerProfile.jsx's
  // full-size PerformanceStrip expects, in case a future change wants both.
  // Empty (and the card renders its stat grid with no strip below it) until
  // teamMapDetailData lands (idle-loaded above) or before player_week.json
  // has picked a winner.
  const mapPerformanceRows = useMemo(
    () => buildPlayerMapPerformance(records, matchPlayerData, teamMapDetailData, playerWeekData?.player),
    [records, matchPlayerData, teamMapDetailData, playerWeekData]
  )

  // Deduped so the two Liquipedia files don't repeat the same licence line if
  // their wording ever converges.
  const attribution = useMemo(() => [...new Set(
    [eventMetaData?._meta?.attribution, upcomingData?._meta?.attribution].filter(Boolean)
  )], [eventMetaData, upcomingData])

  // -- Season KPI strip (formerly a whole "Season stats" section here --
  // filter panel, top-player/team lists, leader cards -- now just these six
  // numbers; the rest moved to Records.jsx) --

  const teamRecords = useMemo(() => (tData ? expandBuckets(tData, 't') : []), [tData])
  const playerRecords = useMemo(() => (pData ? expandBuckets(pData, 'p') : []), [pData])

  // Unscoped -- an empty `initial` means every dimension defaults to "no
  // filter" (see useFacetedFilter's own comment), so these KPIs now cover
  // the site's whole history rather than just the current VCT season. This
  // is also what the removed "N events · N matches" subtitle used to state
  // (this section's old header, before it became the rating chart below) --
  // these tiles are its replacement.
  const { selections, filtered: filteredTeams, dateRange, includeHiddenEvents } =
    useFacetedFilter(teamRecords, FACETS, {})

  const filteredPlayers = useMemo(
    () =>
      playerRecords.filter((r) => matchesFilters(r, FACETS, selections, dateRange, includeHiddenEvents)),
    [playerRecords, selections, dateRange, includeHiddenEvents]
  )

  const kpis = useMemo(
    () => aggregateOverview(filteredTeams, filteredPlayers),
    [filteredTeams, filteredPlayers]
  )

  const statsLoading = pLoading || tLoading || !pData || !tData

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-8">
      {/* No page-local width override needed any more: `<main>`'s own
          `max-w-content` (tailwind.config.js) now matches rft.gg's real
          responsive wrapper directly -- 1104px usable below the `2xl`
          breakpoint, 1202px usable at/above it (see that token's own comment
          for how those numbers were measured) -- so this grid just fills
          `<main>`'s available width at every tier without needing to know
          either number itself. This page is what those two numbers were
          originally measured FOR, before the fix moved to the shared token;
          history in the project-history skill if the site width ever drifts
          from rft.gg's again and this page needs re-checking against it.

          rft.gg's own events-page grid, verbatim: one column on mobile, the
          circuit rail from lg, the match rail from xl. Both rails are direct
          grid children (not nested in the centre column) so bringing them back
          on mobile later is a CSS `order` swap rather than a second instance --
          rendering either aside twice would fork the day-strip and compare-box
          state. */}
      {/* Left rail widened from the original 220px to 280px (PlayerOfWeekCard's
          mini strip needs the room for its taller bar columns -- see its own
          MINI_BAR_MAX_PX comment) and the right rail narrowed to 180px to give
          it back, per direct request. Both are otherwise unrelated to the
          1104/1202px `max-w-content` figures the comment above this section
          still describes -- that's the section's own OUTER width, unaffected
          by how these two numbers split it internally. */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_180px]">
        <aside className="hidden lg:flex lg:flex-col lg:gap-4">
          <CircuitList circuits={circuits} />
          <PlayerOfWeekCard data={playerWeekData} photosData={photosData} mapRows={mapPerformanceRows} />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="font-display text-2xl font-semibold text-ink">Overview</h1>
            <Link to="/ratings" className="text-xs text-muted transition-colors hover:text-ink">
              Full ratings →
            </Link>
          </div>

          {!statsLoading && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <KpiTile label="Events" value={num(kpis.totalEvents)} />
              <KpiTile label="Matches" value={num(kpis.totalMatches)} />
              <KpiTile label="Maps" value={num(kpis.totalMaps)} />
              <KpiTile label="Rounds" value={num(kpis.totalRounds)} />
              <KpiTile label="Players" value={num(kpis.totalPlayers)} />
              <KpiTile label="Teams" value={num(kpis.totalTeams)} />
            </div>
          )}

          {byRegionTable.size > 0 && (
            // Same "2x2, 1 column below a breakpoint" shape Ratings.jsx uses
            // for these same four tables (there at `md`, here at `sm` --
            // this column is narrower than that page's full-width one, so
            // it needs to drop to a single column sooner).
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {REGION_ORDER.map((region) => (
                <RegionTable
                  key={region}
                  region={region}
                  rows={byRegionTable.get(region) || []}
                  showProvisional={false}
                  showDeviation={false}
                />
              ))}
            </div>
          )}

          {/* CC-BY-SA 3.0 requires attribution wherever Liquipedia content is
              displayed -- every scraper here asserts this in its docstring, but
              until now nothing in src/ actually rendered it. The dates, prize
              pools, locations and fixture list on this page are all Liquipedia's,
              so this is where the obligation lands. Reads the strings from the
              data itself rather than hardcoding them, so a licence change in the
              pipeline surfaces here automatically. */}
          {attribution.length > 0 && (
            <p className="px-1 text-[11px] leading-relaxed text-muted/60">
              {attribution.join(' ')}
            </p>
          )}
        </div>

        <aside className="hidden xl:flex xl:flex-col xl:gap-4">
          <ResultsRail matches={recent} />
        </aside>
      </section>
    </div>
  )
}
