import { useMemo } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
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
  let totalMapRounds = 0
  let totalAtkWinRounds = 0
  let totalDefWinRounds = 0

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
      totalMapRounds += s.rounds
      totalAtkWinRounds += s.atkWinRounds
      totalDefWinRounds += s.defWinRounds
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

  return {
    pickRates, mapWinRates, mapAgentCounts, mapTotalRows, totalRows,
    overallAtkWinPct: totalMapRounds ? totalAtkWinRounds / totalMapRounds : null,
    overallDefWinPct: totalMapRounds ? totalDefWinRounds / totalMapRounds : null,
  }
}



export default function Agents() {
  const { data, loading } = useData('agents')
  const buckets = data?.buckets ?? []
  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds } =
    useFacetedFilter(buckets, FACETS, { competition: ['VCT'] })

  const scoped = useMemo(() => aggregate(filtered), [filtered])

  // Two small rows (ATK WIN, DEF WIN) shaped exactly like an agent row --
  // an "Overall" value plus one value per map -- so they can render through
  // the same matrixColumns/DataTable as the agent pick-rate table just
  // below, as its own tiny table rather than mixed into that one.
  const winRateRows = useMemo(() => {
    const { mapWinRates, overallAtkWinPct, overallDefWinPct } = scoped
    if (!data) return []

    const atkRow = { rowType: 'atkWin', label: 'ATK WIN', overall: overallAtkWinPct }
    const defRow = { rowType: 'defWin', label: 'DEF WIN', overall: overallDefWinPct }
    for (const m of mapWinRates) {
      atkRow[m.mapName] = m.atkWinPct
      defRow[m.mapName] = m.defWinPct
    }

    return [atkRow, defRow]
  }, [scoped, data])

  // Agent-major: one row per agent, pick rate per map.
  const matrixRows = useMemo(() => {
    const { pickRates, mapAgentCounts, mapTotalRows } = scoped
    if (!data) return []

    return pickRates.map(({ agent, pickRate }) => {
      const row = { rowType: 'agent', label: agent, overall: pickRate }
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
    {
      key: 'label', label: '', align: 'left', noPadding: true,
      format: (v, row) => (
        row.rowType === 'agent'
          ? (
            <span className="flex items-center justify-center">
              <AgentIcon agent={v} size={36} />
            </span>
          )
          : <span className="font-semibold text-ink text-xs tracking-wide block px-5 py-2.5">{v}</span>
      ),
    },
    { key: 'overall', label: 'Overall', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    ...data.mapNames.map((m) => ({
      key: m, label: m, align: 'right', colorScale: true,
      format: (v) => (v === null || v === undefined ? '—' : pct(v, 1)),
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
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
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
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Map win rates (attack vs. defense)</h3>
            <p className="text-muted text-xs">
              Round-weighted, not a naive average across buckets. Reflects the filters above.
            </p>
            <DataTable columns={matrixColumns} rows={winRateRows} />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Pick rate by map</h3>
            <p className="text-muted text-xs">
              Reflects the filters above — sorted by overall pick rate in scope.
            </p>
            <DataTable columns={matrixColumns} rows={matrixRows} defaultSortKey="overall" />
          </div>
        </>
      )}
    </div>
  )
}
