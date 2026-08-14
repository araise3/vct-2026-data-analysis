import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandMatchRows, expandBuckets, aggregateOverview } from '../lib/entityBuckets'
import { buildEventList, splitByStatus, groupByMonth, currentCircuits } from '../lib/eventMeta'
import { recentResults } from '../lib/schedule'
import EventRow from '../components/EventRow'
import FilterChips from '../components/FilterChips'
import { ResultsRail } from '../components/MatchRail'
import CircuitList from '../components/CircuitList'
import PlayerOfMonthCard from '../components/PlayerOfMonthCard'
import { FACETS } from '../components/FilterPanel'
import Card from '../components/ui/Card'
import { monthLabel, num } from '../lib/format'

const TABS = ['Scheduled', 'Finished']

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
 * Tournaments" link and CircuitList/EventRow/MatchRail all point at
 * `/tournaments/{name}`, which stays untouched).
 *
 * The events/circuit-list section below is the original page, unchanged --
 * it's the main thing this route shows and loads first. A six-tile season
 * KPI strip (see KpiTile above) sits inline in its header row, fed by its
 * own data fetch/loading state so it doesn't hold up the events section
 * itself. That strip is what's left of a much bigger "Season stats" section
 * (KPIs, top players/teams, leader cards, faceted filters) that used to live
 * here (formerly its own Overview.jsx page at `/`) -- everything but the
 * KPIs themselves moved to Records.jsx.
 */
export default function Tournaments() {
  const { data: matchData, loading } = useData('match_results')
  const { data: eventMetaData } = useData('event_meta')
  const { data: upcomingData } = useData('upcoming_matches')
  const { data: playerMonthData } = useData('player_month')
  const { data: pData, loading: pLoading } = useData('player_buckets')
  const { data: tData, loading: tLoading } = useData('team_buckets')

  const records = useMemo(() => expandMatchRows(matchData), [matchData])

  const events = useMemo(
    () => buildEventList(matchData, records, eventMetaData, upcomingData),
    [matchData, records, eventMetaData, upcomingData]
  )

  const { scheduled, finished } = useMemo(() => splitByStatus(events), [events])

  // Scheduled leads, since a live season is what someone opening this page is
  // most likely after -- but never land on a blank tab, so an off-season with
  // nothing scheduled falls back to Finished.
  const [tab, setTab] = useState(null)
  const activeTab = tab ?? (scheduled.length > 0 ? 'Scheduled' : 'Finished')
  const isScheduled = activeTab === 'Scheduled'
  const shown = isScheduled ? scheduled : finished
  // Group on whichever date the tab is sorted by, or the same month reappears
  // further down the list (see groupByMonth's own note).
  const months = useMemo(
    () => groupByMonth(shown, isScheduled ? (e) => e.startDate : (e) => e.endDate),
    [shown, isScheduled]
  )

  const recent = useMemo(() => recentResults(records, 8), [records])
  const circuits = useMemo(() => currentCircuits(events), [events])

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

  // Fixed to the current VCT season -- no user-facing filter control for
  // this any more, so the scope is just whatever a visitor would expect
  // "this season" to mean by default.
  const { selections, filtered: filteredTeams, dateRange, includeHiddenEvents } =
    useFacetedFilter(teamRecords, FACETS, { competition: ['VCT'], year: [2026] })

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
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px]">
        <aside className="hidden lg:flex lg:flex-col lg:gap-4">
          <CircuitList circuits={circuits} />
          <PlayerOfMonthCard data={playerMonthData} />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink">Events</h1>
              <p className="mt-1 text-sm text-muted">
                {events.length} events · {num(records.length)} matches
              </p>
            </div>
            <FilterChips options={TABS} value={activeTab} onChange={setTab} />
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

          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            {shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                No {activeTab.toLowerCase()} events.
              </p>
            ) : (
              months.map((g) => (
                <div key={g.key}>
                  <div className="border-b border-hairline bg-surface2/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {g.anchorDate ? monthLabel(g.anchorDate) : 'Dates TBD'}
                  </div>
                  <div className="flex flex-col gap-2 p-2">
                    {g.events.map((e) => (
                      <EventRow key={e.name} event={e} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

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
