import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandMatchRows, expandBuckets, aggregatePlayerBuckets, aggregateTeamBuckets,
  teamInScope, aggregateOverview, groupByEntity,
} from '../lib/entityBuckets'
import { buildEventList, splitByStatus, groupByMonth, currentCircuits } from '../lib/eventMeta'
import { recentResults } from '../lib/schedule'
import EventRow from '../components/EventRow'
import FilterChips from '../components/FilterChips'
import { ResultsRail } from '../components/MatchRail'
import CircuitList from '../components/CircuitList'
import PlayerOfMonthCard from '../components/PlayerOfMonthCard'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import RankedList from '../components/RankedList'
import LeaderCard, { topBy, dynamicQualify } from '../components/LeaderCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { monthLabel, num, rating, pct } from '../lib/format'

const MIN_MAPS = 10

/**
 * Moved here from the Players page, which the person wanted to be just
 * the table. None of these have a side breakdown in the source data
 * (see entityBuckets' aggregatePlayerBuckets), so there's no Attack/
 * Defend toggle to worry about here either.
 */
const PLAYER_LEADERS = [
  {
    key: 'ratingSd', title: 'Most consistent',
    invert: true,
    // Gates on ratedMaps, NOT mapsPlayed: China maps often have no
    // Rating 2.0, so a player can have 33 maps but only 14 that feed the
    // SD. Using mapsPlayed here let a 14-rated-map player onto the card
    // with an artificially tiny spread.
    sampleKey: 'ratedMaps', sampleMin: 15,
    meta: (r) => `${num(r.ratedMaps)} rated`,
    value: (r) => r.ratingSd.toFixed(3),
    note: 'Standard deviation of Rating 2.0 across individual maps — lower is steadier. Min. 15 rated maps (scaled down for a smaller filter scope).',
  },
  {
    key: 'avgEcon', title: 'Highest econ rating',
    sampleKey: 'utilMaps', sampleMin: 15,
    meta: (r) => `${num(r.utilMaps)} maps`,
    value: (r) => num(r.avgEcon),
    note: 'Min. 15 maps with economy data (scaled down for a smaller filter scope).',
  },
  {
    key: 'totalClutches', title: 'Most clutches',
    qualify: (r) => r.totalClutches > 0,
    meta: (r) => `${num(r.roundsPlayed)} rds`,
    value: (r) => num(r.totalClutches),
  },
  {
    key: 'totalPlants', title: 'Most spike plants',
    qualify: (r) => r.utilMaps > 0,
    meta: (r) => `${num(r.utilMaps)} maps`,
    value: (r) => num(r.totalPlants),
  },
  {
    key: 'totalDefuses', title: 'Most defuses',
    qualify: (r) => r.utilMaps > 0,
    meta: (r) => `${num(r.utilMaps)} maps`,
    value: (r) => num(r.totalDefuses),
  },
]

const TABS = ['Scheduled', 'Finished']

/**
 * Tournaments -- the site's landing page (`/`, also still reachable at
 * `/tournaments` for existing links/bookmarks -- TournamentDetail's "Back to
 * Tournaments" link and CircuitList/EventRow/MatchRail all point at
 * `/tournaments/{name}`, which stays untouched).
 *
 * The events/circuit-list section below is the original page, unchanged --
 * it's the main thing this route shows and loads first. The season-stats
 * section (KPIs, top players/teams, leader cards, faceted filters) that used
 * to live at `/` as its own Overview.jsx page is appended below it, as a
 * secondary section with its own data fetch/loading state so it doesn't hold
 * up the events section above it.
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

  // -- Season-stats section (formerly Overview.jsx) --

  const teamRecords = useMemo(() => (tData ? expandBuckets(tData, 't') : []), [tData])
  const playerRecords = useMemo(() => (pData ? expandBuckets(pData, 'p') : []), [pData])

  // Facets are driven off the team buckets (which cover every event), and
  // the same selections are applied to the player buckets -- so both
  // halves of this section always describe the same scope.
  const { selections, setFacet, clearAll, filtered: filteredTeams, options, activeCount,
          dateRange, setDateRange, dateBounds,
          includeHiddenEvents, setIncludeHiddenEvents } =
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

  const topPlayers = useMemo(() => {
    if (!pData) return []
    const out = []
    for (const [player, buckets] of groupByEntity(filteredPlayers)) {
      const s = aggregatePlayerBuckets(buckets)
      if (!s || s.mapsPlayed < MIN_MAPS || s.avgRating == null) continue
      const meta = pData.meta[player] || {}
      out.push({ player, team: teamInScope(buckets, meta.team), countryCode: meta.countryCode,
                 countryName: meta.countryName, rating: s.avgRating, mapsPlayed: s.mapsPlayed })
    }
    return out.sort((a, b) => b.rating - a.rating).slice(0, 10)
  }, [filteredPlayers, pData])

  const topTeams = useMemo(() => {
    if (!tData) return []
    const out = []
    for (const [team, buckets] of groupByEntity(filteredTeams)) {
      const s = aggregateTeamBuckets(buckets)
      if (!s || s.mapsPlayed < MIN_MAPS || s.mapWinPct == null) continue
      out.push({ team, region: tData.meta[team]?.region, ...s })
    }
    return out.sort((a, b) => b.mapWinPct - a.mapWinPct).slice(0, 10)
  }, [filteredTeams, tData])

  // Full per-player rows (not capped at 10, unlike topPlayers above) for
  // the leader cards -- each card picks its own top 5 off a different
  // stat, so this needs every qualifying player in scope, not just the
  // rating leaders.
  const leaderRows = useMemo(() => {
    if (!pData) return []
    const out = []
    for (const [player, buckets] of groupByEntity(filteredPlayers)) {
      const meta = pData.meta[player]
      if (!meta) continue
      const s = aggregatePlayerBuckets(buckets)
      if (!s || !s.mapsPlayed) continue
      out.push({ player, team: teamInScope(buckets, meta.team), countryCode: meta.countryCode,
                 countryName: meta.countryName, ...s })
    }
    return out
  }, [filteredPlayers, pData])

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

      {/* Season stats -- formerly the standalone Overview.jsx page at `/`.
          Kept as its own section with its own heading/filters/loading state
          rather than woven into the section above, since it's a different
          shape of content (season-wide player/team stats vs. the event
          calendar) driven by a different dataset and filter model
          (faceted region/event/phase/week facets here, vs. a plain
          Scheduled/Finished toggle above). */}
      <section className="flex flex-col gap-6">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Season stats</h2>
          <p className="text-muted text-sm mt-1">
            Every stat below reflects the filters — nothing here is precomputed.
          </p>
        </div>

        <FilterPanel
          selections={selections} setFacet={setFacet} clearAll={clearAll}
          options={options} activeCount={activeCount}
          dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
          includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        />

        {statsLoading ? (
          <div className="text-muted text-sm">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <KpiCard label="Events" value={num(kpis.totalEvents)} />
              <KpiCard label="Matches" value={num(kpis.totalMatches)} />
              <KpiCard label="Maps" value={num(kpis.totalMaps)} />
              <KpiCard label="Rounds" value={num(kpis.totalRounds)} />
              <KpiCard label="Players" value={num(kpis.totalPlayers)} />
              <KpiCard label="Teams" value={num(kpis.totalTeams)} />
            </div>

            {kpis.totalMaps === 0 ? (
              <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
                <p className="text-muted text-sm">Nothing matches this filter combination.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RankedList
                  title={`Top players by rating (min. ${MIN_MAPS} maps in scope)`}
                  rows={topPlayers}
                  renderRow={(p) => (
                    <>
                      <Link to={`/teams/${encodeURIComponent(p.team)}`} className="shrink-0 self-center h-9 flex items-center justify-center">
                        <TeamLogo team={p.team} size={36} showName={false} />
                      </Link>
                      <div className="flex-1 min-w-0 self-center">
                        <Link to={`/players/${encodeURIComponent(p.player)}`} className="flex items-center gap-1.5 text-sm text-ink font-medium truncate leading-tight hover:text-accent-bright transition-colors">
                          <Flag countryCode={p.countryCode} countryName={p.countryName} size={14} />
                          <span className="truncate">{p.player}</span>
                        </Link>
                        <Link to={`/teams/${encodeURIComponent(p.team)}`} className="block text-xs text-muted truncate leading-tight hover:text-accent-bright transition-colors">
                          {p.team}
                        </Link>
                      </div>
                      <span className="font-body text-sm text-good font-medium">{rating(p.rating)}</span>
                    </>
                  )}
                />
                <RankedList
                  title={`Top teams by map win rate (min. ${MIN_MAPS} maps in scope)`}
                  rows={topTeams}
                  renderRow={(t) => (
                    <>
                      <Link to={`/teams/${encodeURIComponent(t.team)}`} className="shrink-0 self-center h-9 flex items-center justify-center">
                        <TeamLogo team={t.team} size={36} showName={false} />
                      </Link>
                      <div className="flex-1 min-w-0 self-center">
                        <Link to={`/teams/${encodeURIComponent(t.team)}`} className="block text-sm text-ink font-medium truncate leading-tight hover:text-accent-bright transition-colors">
                          {t.team}
                        </Link>
                        <div className="text-xs text-muted truncate leading-tight">
                          {t.region} · {t.mapsWon}/{t.mapsPlayed} maps
                        </div>
                      </div>
                      <span className="font-body text-sm text-good font-medium">{pct(t.mapWinPct)}</span>
                    </>
                  )}
                />
              </div>
            )}

            {leaderRows.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                  <h2 className="font-display text-sm font-semibold text-ink">Player leaders</h2>
                  <p className="text-muted text-xs">Follows the filters above.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {PLAYER_LEADERS.map((c) => (
                    <LeaderCard
                      key={c.key}
                      title={c.title}
                      note={c.note}
                      rows={topBy(leaderRows, c.key, {
                        qualify: c.sampleKey
                          ? dynamicQualify(leaderRows, c.sampleKey, { fixed: c.sampleMin })
                          : c.qualify,
                        invert: c.invert,
                      })}
                      renderEntity={(r) => (
                        <>
                          <Flag countryCode={r.countryCode} countryName={r.countryName} size={14} />
                          <Link
                            to={`/players/${encodeURIComponent(r.player)}`}
                            className="font-medium text-ink truncate hover:text-accent-bright transition-colors"
                          >
                            {r.player}
                          </Link>
                          <TeamLogo team={r.team} size={20} />
                        </>
                      )}
                      meta={c.meta}
                      value={c.value}
                      showRank
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
