import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, aggregateTeamBuckets, aggregatePlayerBuckets, groupByEntity } from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

export default function TeamProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data: teamData, loading: teamsLoading } = useData('team_buckets')
  const { data: playerData, loading: playersLoading } = useData('player_buckets')

  // Scope to this team first, so facet options only show events this
  // team actually played in.
  const records = useMemo(() => {
    if (!teamData) return []
    return expandBuckets(teamData, 't').filter((r) => r.id === decodedName)
  }, [teamData, decodedName])

  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const stats = useMemo(() => aggregateTeamBuckets(filtered), [filtered])

  // Roster reflects the same filter scope: apply the team's active facet
  // selections to the player buckets, keeping only this team's players.
  const roster = useMemo(() => {
    if (!playerData) return []
    const rosterNames = new Set(
      Object.entries(playerData.meta)
        .filter(([, m]) => m.team === decodedName)
        .map(([p]) => p)
    )
    const scopedKeys = new Set(filtered.map((r) => `${r.e}|${r.w}`))
    const recs = expandBuckets(playerData, 'p').filter(
      (r) => rosterNames.has(r.id) && scopedKeys.has(`${r.e}|${r.w}`)
    )
    const out = []
    for (const [player, buckets] of groupByEntity(recs)) {
      const s = aggregatePlayerBuckets(buckets)
      if (!s || !s.mapsPlayed) continue
      const m = playerData.meta[player]
      out.push({ player, ...s, countryCode: m.countryCode, countryName: m.countryName })
    }
    return out.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
  }, [playerData, decodedName, filtered])

  if (teamsLoading || playersLoading) return <div className="text-muted text-sm">Loading…</div>

  const meta = teamData?.meta?.[decodedName]
  if (!meta) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/teams" className="text-sm text-accent-bright hover:underline">← Back to Teams</Link>
        <p className="text-muted text-sm">No team found matching "{decodedName}".</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/teams" className="text-sm text-muted hover:text-ink w-fit">← Back to Teams</Link>

      <div className="flex items-stretch gap-4">
        <div className="w-16 rounded-xl bg-surface2 border border-hairline flex items-center justify-center shrink-0">
          <TeamLogo team={decodedName} size={40} showName={false} showBg={false} />
        </div>
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-2xl font-semibold text-ink">{decodedName}</h1>
          <p className="text-muted text-sm">{meta.region}</p>
        </div>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
      />

      {!stats || !stats.mapsPlayed ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No maps in this scope.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Matches"
              value={`${stats.matchesWon}–${stats.matchesPlayed - stats.matchesWon}`}
              sub={pct(stats.matchWinPct)}
            />
            <KpiCard
              label="Maps"
              value={`${stats.mapsWon}–${stats.mapsPlayed - stats.mapsWon}`}
              sub={pct(stats.mapWinPct)}
            />
            <KpiCard label="Rounds Played" value={num(stats.roundsPlayed)} />
            <KpiCard label="Avg Player Rating" value={rating(stats.avgRating)} />
            <KpiCard
              label="Pistol Win%"
              value={stats.pistolWon ? pct(stats.pistolWinPct) : '—'}
              sub={stats.pistolWon ? `${stats.pistolWon}/${stats.pistolPlayed}` : 'No economy data (China)'}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Roster</h3>
            <p className="text-muted text-xs">
              Players on this team, ranked by rating — reflects the filters above.
            </p>
            <div className="bg-surface border border-hairline rounded-2xl divide-y divide-hairline">
              {roster.map((p) => (
                <Link
                  key={p.player}
                  to={`/players/${encodeURIComponent(p.player)}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-surface2/50 transition-colors"
                >
                  <span className="text-sm text-ink font-medium flex items-center gap-2">
                    <Flag countryCode={p.countryCode} countryName={p.countryName} size={22} />
                    {p.player}
                  </span>
                  <div className="flex items-center gap-6 text-xs text-muted">
                    <span>{p.mapsPlayed} maps</span>
                    <span className="text-good font-body font-medium">{rating(p.avgRating)}</span>
                  </div>
                </Link>
              ))}
              {roster.length === 0 && (
                <p className="text-muted text-xs px-5 py-4">No players in this scope.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
