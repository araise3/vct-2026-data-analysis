import { useMemo } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, aggregateEconomyBuckets } from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import StackedBar from '../components/StackedBar'
import { pct, num } from '../lib/format'

export default function Economy() {
  const { data, loading } = useData('team_buckets')
  const records = useMemo(() => (data ? expandBuckets(data, 't') : []), [data])
  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const econ = useMemo(() => aggregateEconomyBuckets(filtered), [filtered])

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  // StackedBar keys tiers by name and reads .rounds off each.
  const tierMap = Object.fromEntries(econ.tiers.map((t) => [t.key, { rounds: t.rounds }]))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Economy</h1>
        <p className="text-muted text-sm mt-1">
          Buy-type distribution and win rates. China has no economy data on VLR, so China-only
          selections will come back empty.
        </p>
      </div>

      <FilterPanel
        selections={selections} setFacet={setFacet} clearAll={clearAll}
        options={options} activeCount={activeCount}
        summary={`${num(econ.totalRounds)} rounds in scope`}
      />

      {econ.totalRounds === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">
            No economy data for this filter combination.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-4">
              Round distribution by buy type
            </h3>
            <StackedBar tiers={tierMap} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {econ.tiers.map((t) => (
              <KpiCard
                key={t.key}
                label={`${t.label} win rate`}
                value={t.winPct == null ? '—' : pct(t.winPct)}
                sub={`${num(t.won)} / ${num(t.rounds)} rounds`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
