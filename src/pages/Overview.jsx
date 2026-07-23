import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateTeamBuckets,
  aggregateOverview, groupByEntity,
} from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import RankedList from '../components/RankedList'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

const MIN_MAPS = 10

export default function Overview() {
  const { data: pData, loading: pLoading } = useData('player_buckets')
  const { data: tData, loading: tLoading } = useData('team_buckets')

  const teamRecords = useMemo(() => (tData ? expandBuckets(tData, 't') : []), [tData])
  const playerRecords = useMemo(() => (pData ? expandBuckets(pData, 'p') : []), [pData])

  // Facets are driven off the team buckets (which cover every event), and
  // the same selections are applied to the player buckets -- so both
  // halves of the page always describe the same scope.
  const { selections, setFacet, clearAll, filtered: filteredTeams, options, activeCount } =
    useFacetedFilter(teamRecords, FACETS, { competition: ['VCT'] })

  const filteredPlayers = useMemo(
    () =>
      playerRecords.filter((r) =>
        FACETS.every((f) => {
          const sel = selections[f]
          return !sel || sel.length === 0 || sel.includes(r[f])
        })
      ),
    [playerRecords, selections]
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
      out.push({ player, team: meta.team, countryCode: meta.countryCode,
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
                <Link to={`/teams/${encodeURIComponent(p.team)}`} className="shrink-0 self-center h-8 flex items-center justify-center">
                  <TeamLogo team={p.team} size={32} showName={false} />
                </Link>
                <div className="flex-1 min-w-0 self-center">
                  <Link to={`/players/${encodeURIComponent(p.player)}`} className="flex items-center gap-1.5 text-sm text-ink font-medium truncate leading-tight hover:text-accent-bright transition-colors">
                    <Flag countryCode={p.countryCode} countryName={p.countryName} size={18} />
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
                <Link to={`/teams/${encodeURIComponent(t.team)}`} className="shrink-0 self-center h-8 flex items-center justify-center">
                  <TeamLogo team={t.team} size={32} showName={false} />
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
    </div>
  )
}
