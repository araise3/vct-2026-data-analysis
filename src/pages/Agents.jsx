import { useMemo } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import HorizontalBarChart from '../components/HorizontalBarChart'
import DataTable from '../components/DataTable'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import AgentIcon from '../components/AgentIcon'
import { pct, num } from '../lib/format'


// Sums raw counts first and computes percentages last -- this is what makes
// arbitrary filter combinations correct, rather than averaging
// pre-computed percentages (which would weight a 10-round week the same as
// a 200-round one).
function aggregate(buckets) {
  const agentCounts = {}
  const mapStats = {}
  const mapAgentCounts = {}
  const mapTotalRows = {}
  let totalRows = 0

  for (const b of buckets) {
    totalRows += b.playerRows
    for (const [agent, count] of Object.entries(b.agentCounts)) {
      agentCounts[agent] = (agentCounts[agent] || 0) + count
    }
    for (const [mapName, s] of Object.entries(b.mapStats)) {
      if (!mapStats[mapName]) mapStats[mapName] = { rounds: 0, atkWinRounds: 0, defWinRounds: 0 }
      mapStats[mapName].rounds += s.rounds
      mapStats[mapName].atkWinRounds += s.atkWinRounds
      mapStats[mapName].defWinRounds += s.defWinRounds
    }
    for (const [mapName, counts] of Object.entries(b.mapAgentCounts || {})) {
      if (!mapAgentCounts[mapName]) mapAgentCounts[mapName] = {}
      for (const [agent, count] of Object.entries(counts)) {
        mapAgentCounts[mapName][agent] = (mapAgentCounts[mapName][agent] || 0) + count
        mapTotalRows[mapName] = (mapTotalRows[mapName] || 0) + count
      }
    }
  }

  const teamSlots = totalRows / 5
  const pickRates = Object.entries(agentCounts)
    .map(([agent, count]) => ({ agent, pickRate: teamSlots ? count / teamSlots : 0 }))
    .sort((a, b) => b.pickRate - a.pickRate)

  const mapWinRates = Object.entries(mapStats)
    .map(([mapName, s]) => ({
      mapName,
      roundsPlayed: s.rounds,
      atkWinPct: s.rounds ? s.atkWinRounds / s.rounds : 0,
      defWinPct: s.rounds ? s.defWinRounds / s.rounds : 0,
    }))
    .sort((a, b) => b.roundsPlayed - a.roundsPlayed)

  return { pickRates, mapWinRates, mapAgentCounts, mapTotalRows, totalRows }
}



export default function Agents() {
  const { data, loading } = useData('agents')
  const buckets = data?.buckets ?? []
  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(buckets, FACETS, { competition: ['VCT'] })

  const scoped = useMemo(() => aggregate(filtered), [filtered])

  const matrixRows = useMemo(() => {
    const { pickRates, mapAgentCounts, mapTotalRows } = scoped
    if (!data) return []
    return pickRates.map(({ agent }) => {
      const row = { agent }
      for (const mapName of data.mapNames) {
        const slots = (mapTotalRows[mapName] || 0) / 5
        const count = mapAgentCounts[mapName]?.[agent]
        row[mapName] = slots && count ? count / slots : null
      }
      return row
    })
  }, [scoped, data])

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const matrixColumns = [
    { key: 'agent', label: 'Agent', align: 'left', width: 172, format: (v) => <AgentIcon agent={v} size={20} /> },
    ...data.mapNames.map((m) => ({
      key: m, label: m, align: 'right', colorScale: true,
      format: (v) => (v === null || v === undefined ? '—' : pct(v, 0)),
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Agents</h1>
        <p className="text-muted text-sm mt-1">
          Pick rates and map performance, computed directly from per-map player data.
          Every filter below is multi-select and independent — combine them freely.
        </p>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        summary={`${num(scoped.totalRows / 5)} team-maps in scope`}
      />

      {scoped.totalRows === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No matches found for this filter combination.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-4">Top 15 agents by pick rate</h3>
            <HorizontalBarChart
              data={scoped.pickRates.slice(0, 15)}
              labelKey="agent" valueKey="pickRate" formatValue={(v) => pct(v)}
              renderLabel={(d) => <AgentIcon agent={d.agent} size={18} />}
            />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-3">
              Map win rates (attack vs. defense)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {scoped.mapWinRates.map((m) => (
                <div key={m.mapName} className="bg-surface2/50 border border-hairline rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-ink">{m.mapName}</span>
                    <span className="text-xs text-muted">{m.roundsPlayed.toLocaleString()} rounds</span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-surface2">
                    <div className="bg-accent" style={{ width: `${m.atkWinPct * 100}%` }} />
                    <div className="bg-good" style={{ width: `${m.defWinPct * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted mt-1.5">
                    <span>ATK {pct(m.atkWinPct)}</span>
                    <span>DEF {pct(m.defWinPct)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Pick rate by map</h3>
            <p className="text-muted text-xs">
              Reflects the filters above — sorted by overall pick rate in scope.
            </p>
            <DataTable columns={matrixColumns} rows={matrixRows} defaultSortKey={data.mapNames[0]} />
          </div>
        </>
      )}
    </div>
  )
}
