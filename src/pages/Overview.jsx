import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateTeamBuckets, teamInScope,
  aggregateOverview, groupByEntity,
} from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import RankedList from '../components/RankedList'
import LeaderCard, { topBy, dynamicQualify } from '../components/LeaderCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

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

export default function Overview() {
  const { data: pData, loading: pLoading } = useData('player_buckets')
  const { data: tData, loading: tLoading } = useData('team_buckets')

  const teamRecords = useMemo(() => (tData ? expandBuckets(tData, 't') : []), [tData])
  const playerRecords = useMemo(() => (pData ? expandBuckets(pData, 'p') : []), [pData])

  // Facets are driven off the team buckets (which cover every event), and
  // the same selections are applied to the player buckets -- so both
  // halves of the page always describe the same scope.
  const { selections, setFacet, clearAll, filtered: filteredTeams, options, activeCount,
          dateRange, setDateRange, dateBounds } =
    useFacetedFilter(teamRecords, FACETS, { competition: ['VCT'], year: [2026] })

  const filteredPlayers = useMemo(
    () =>
      playerRecords.filter((r) => matchesFilters(r, FACETS, selections, dateRange)),
    [playerRecords, selections, dateRange]
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

  if (pLoading || tLoading || !pData || !tData) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Season Overview</h1>
        <p className="text-muted text-sm mt-1">
          Every stat below reflects the filters — nothing here is precomputed.
        </p>
      </div>

      <FilterPanel
        selections={selections} setFacet={setFacet} clearAll={clearAll}
        options={options} activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <KpiCard label="Events" value={num(kpis.totalEvents)} />
        <KpiCard label="Matches" value={num(kpis.totalMatches)} />
        <KpiCard label="Maps" value={num(kpis.totalMaps)} />
        <KpiCard label="Rounds" value={num(kpis.totalRounds)} />
        <KpiCard label="Players" value={num(kpis.totalPlayers)} />
        <KpiCard label="Teams" value={num(kpis.totalTeams)} />
      </div>

      {kpis.totalMaps === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
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
    </div>
  )
}
