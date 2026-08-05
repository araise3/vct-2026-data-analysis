import { useMemo, useState } from 'react'
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

  // atkWinPct/defWinPct deliberately do NOT divide by s.rounds (the map's
  // total round count, including overtime). atkWinRounds/defWinRounds come
  // from the maps table's per-side header score, which is REGULATION-only
  // by construction, not by a data gap: VLR's own header publishes a THIRD,
  // separate number for OT round wins (a plain <span class="mod-ot">) with
  // no attack/defense split of its own, verified directly against a real OT
  // match page -- so OT isn't missing, it's just never side-attributed in
  // this source, the same deliberate tradeoff export_from_db.py's team-level
  // atk/def split already documents and has verified (atk+def == map score
  // exactly on every regulation map, 0 mismatches). Separately, a small set
  // of maps (mostly China) have no header breakdown published AT ALL --
  // that IS a genuine gap, and export_from_db.py fills those with 0 rather
  // than leaving them out of s.rounds. Dividing by s.rounds mixes both
  // cases into the denominator regardless of cause, which is why ATK WIN% +
  // DEF WIN% fell short of 100%. atkWinRounds + defWinRounds is precisely
  // the round count this source actually attributes to a side (whatever the
  // reason it doesn't cover the rest), so using that as the shared
  // denominator makes the two percentages complementary by construction --
  // the same "divide by what has the data, not by everything" pattern
  // multiKillsPerMap uses for its own China gap.
  const mapWinRates = Object.entries(mapStats)
    .map(([mapName, s]) => {
      const sideRounds = s.atkWinRounds + s.defWinRounds
      return {
        mapName,
        roundsPlayed: s.rounds,
        atkWinPct: sideRounds ? s.atkWinRounds / sideRounds : 0,
        defWinPct: sideRounds ? s.defWinRounds / sideRounds : 0,
      }
    })
    .sort((a, b) => b.roundsPlayed - a.roundsPlayed)

  const totalSideRounds = totalAtkWinRounds + totalDefWinRounds
  return {
    pickRates, mapWinRates, mapAgentCounts, mapTotalRows, totalRows,
    overallAtkWinPct: totalSideRounds ? totalAtkWinRounds / totalSideRounds : null,
    overallDefWinPct: totalSideRounds ? totalDefWinRounds / totalSideRounds : null,
  }
}



export default function Agents() {
  const { data, loading } = useData('agents')
  const buckets = data?.buckets ?? []
  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds } =
    useFacetedFilter(buckets, FACETS, { competition: ['VCT'], year: [2026] })

  // Reorders only the win-rate table's own map columns (see winRateColumns
  // below) -- the pick-rate table keeps its own fixed column order
  // (pickRateColumns) regardless. Triggered by clicking the ATK WIN / DEF
  // WIN row label itself rather than a separate control -- sorting the two
  // win-rate ROWS the normal DataTable way is barely useful with only two
  // rows, but sorting the map COLUMNS by one of those rows' values (best
  // attack map first, etc.) is the thing that's actually useful here.
  const [mapSort, setMapSort] = useState({ key: null, dir: 'desc' })

  function toggleMapSort(key) {
    setMapSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  }

  const scoped = useMemo(() => aggregate(filtered), [filtered])

  // Both matrix tables used to always render every map in data.mapNames
  // (the site's full-season map pool), so a filter scope narrow enough to
  // exclude a map (one event, one week, etc.) still showed that map's
  // column full of "—" placeholders instead of just not showing it.
  // Restricting to maps actually present in the scoped aggregation --
  // separately per table, since win-rate data (mapStats) and pick-rate data
  // (mapAgentCounts) aren't guaranteed to carry exactly the same map set --
  // makes each table reflect only what's actually in scope.
  const winRateMapNames = useMemo(() => {
    if (!data) return []
    const inScope = new Set(scoped.mapWinRates.map((r) => r.mapName))
    return data.mapNames.filter((m) => inScope.has(m))
  }, [data, scoped])
  const pickRateMapNames = useMemo(
    () => (data ? data.mapNames.filter((m) => scoped.mapTotalRows[m]) : []),
    [data, scoped]
  )

  const orderedMapNames = useMemo(() => {
    if (!data) return []
    if (!mapSort.key) return winRateMapNames
    const statKey = mapSort.key === 'atkWin' ? 'atkWinPct' : 'defWinPct'
    const rates = Object.fromEntries(scoped.mapWinRates.map((m) => [m.mapName, m[statKey]]))
    const sorted = [...winRateMapNames].sort((a, b) => (rates[b] ?? -1) - (rates[a] ?? -1))
    return mapSort.dir === 'asc' ? sorted.reverse() : sorted
  }, [data, scoped, mapSort, winRateMapNames])

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

  // Narrow enough that all 12 maps plus the label/Overall columns fit
  // inside the site's 1160px content column without a horizontal
  // scrollbar -- there's plenty of room at this width for a percentage
  // ("100.0%") at the table's own (vlr.gg-matched) 12px font.
  const mapColumnWidth = 78

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const labelColumn = {
    key: 'label', label: '', align: 'left', noPadding: true,
    format: (v, row) => {
      if (row.rowType === 'agent') {
        return (
          <span className="flex items-center justify-center">
            <AgentIcon agent={v} size={26} />
          </span>
        )
      }
      // ATK WIN / DEF WIN rows: the label itself is the sort trigger for
      // the win-rate table's own map COLUMNS (see mapSort above) -- it does
      // NOT affect the pick-rate table below, which always keeps maps in
      // their default order (see pickRateColumns).
      const active = mapSort.key === row.rowType
      return (
        <button
          onClick={() => toggleMapSort(row.rowType)}
          className={`w-full flex items-center gap-1 px-3 py-1.5 text-left text-[10px] font-semibold cursor-pointer select-none transition-colors ${
            active ? 'text-accent' : 'text-ink hover:text-accent-bright'
          }`}
        >
          {v}
          <span className={`inline-block w-2.5 text-[10px] leading-none text-accent ${active ? '' : 'invisible'}`}>
            {mapSort.dir === 'asc' ? '▲' : '▼'}
          </span>
        </button>
      )
    },
  }

  // Win rates get the green/red diverging scale (a real, fixed 50% neutral
  // point -- "favored" vs. "unfavored" should mean the same shade on every
  // view), not the pick-rate table's violet-red heatmap below (pick rate
  // has no such neutral point to diverge around).
  const winRateColumns = [
    labelColumn,
    { key: 'overall', label: 'Overall', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    ...orderedMapNames.map((m) => ({
      key: m, label: m, align: 'right', colorScale: true, diverging: true, width: mapColumnWidth,
      format: (v) => (v === null || v === undefined ? '—' : pct(v, 1)),
    })),
  ]

  // Always in data.mapNames' own order -- NOT orderedMapNames, which only
  // the win-rate table's ATK WIN/DEF WIN buttons above control. The two
  // tables used to share one column order (clicking a button up there
  // silently reordered this table too); this is what decouples them.
  const pickRateColumns = [
    labelColumn,
    { key: 'overall', label: 'Overall', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    ...pickRateMapNames.map((m) => ({
      key: m, label: m, align: 'right', colorScale: true, width: mapColumnWidth,
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
              Round-weighted, not a naive average across buckets. Reflects the filters above. Click
              ATK WIN or DEF WIN to sort maps by that rate.
            </p>
            <DataTable columns={winRateColumns} rows={winRateRows} />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Pick rate by map</h3>
            <p className="text-muted text-xs">
              Reflects the filters above — sorted by overall pick rate in scope.
            </p>
            <DataTable columns={pickRateColumns} rows={matrixRows} defaultSortKey="overall" />
          </div>
        </>
      )}
    </div>
  )
}
