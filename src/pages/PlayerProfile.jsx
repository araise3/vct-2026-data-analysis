import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, aggregatePlayerBuckets } from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

export default function PlayerProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data, loading } = useData('player_buckets')
  const [ratedOnly, setRatedOnly] = useState(false)

  // Scope to this player first, so the facet options only ever show
  // events/weeks this player actually appeared in.
  const records = useMemo(() => {
    if (!data) return []
    return expandBuckets(data, 'p').filter((r) => r.id === decodedName)
  }, [data, decodedName])

  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const stats = useMemo(
    () => aggregatePlayerBuckets(filtered, { ratedOnly }),
    [filtered, ratedOnly]
  )

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  const meta = data?.meta?.[decodedName]
  if (!meta) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/players" className="text-sm text-accent-bright hover:underline">← Back to Players</Link>
        <p className="text-muted text-sm">No player found matching "{decodedName}".</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/players" className="text-sm text-muted hover:text-ink w-fit">← Back to Players</Link>

      <div className="flex items-stretch gap-4">
        <div className="w-16 rounded-xl bg-surface2 border border-hairline flex items-center justify-center shrink-0">
          <Flag countryCode={meta.countryCode} countryName={meta.countryName} size={34} />
        </div>
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-2xl font-semibold text-ink">{decodedName}</h1>
          <Link
            to={`/teams/${encodeURIComponent(meta.team)}`}
            className="text-muted text-sm hover:text-accent-bright w-fit"
          >
            <TeamLogo team={meta.team} size={18} />
          </Link>
        </div>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
      >
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={ratedOnly}
            onChange={(e) => setRatedOnly(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          Only maps with a Rating 2.0
        </label>
      </FilterPanel>

      {!stats ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No maps in this scope.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Maps Played" value={num(stats.mapsPlayed)} />
            <KpiCard label="Rounds Played" value={num(stats.roundsPlayed)} />
            <KpiCard label="Avg Rating" value={rating(stats.avgRating)} />
            <KpiCard label="Avg ACS" value={num(stats.avgAcs, 0)} />
            <KpiCard label="K/D" value={stats.kd ? stats.kd.toFixed(2) : '—'} />
            <KpiCard label="Avg KAST" value={pct(stats.avgKast)} />
            <KpiCard label="Avg ADR" value={num(stats.avgAdr, 0)} />
            <KpiCard label="Avg HS%" value={pct(stats.avgHsPct)} />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-4">Totals</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Kills" value={num(stats.totalKills)} />
              <Stat label="Deaths" value={num(stats.totalDeaths)} />
              <Stat label="Assists" value={num(stats.totalAssists)} />
              <Stat label="First Kills" value={num(stats.totalFirstKills)} />
              <Stat label="First Deaths" value={num(stats.totalFirstDeaths)} />
              <Stat label="2K" value={num(stats.total2k)} />
              <Stat label="3K" value={num(stats.total3k)} />
              <Stat label="4K" value={num(stats.total4k)} />
              <Stat label="Ace" value={num(stats.totalAce)} />
              <Stat label="Clutches Won" value={num(stats.totalClutches)} />
            </div>
          </div>

          {meta.isChina && (
            <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
              China-region matches don't publish multi-kill, clutch, or economy data on VLR, so those
              totals read 0 here unless this player also competed internationally — filter to
              Region: International above to see their complete numbers.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
      <span className="font-body text-lg text-ink font-medium">{value}</span>
    </div>
  )
}
