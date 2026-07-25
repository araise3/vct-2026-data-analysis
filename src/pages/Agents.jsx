import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandBuckets, aggregateAgentBuckets } from '../lib/entityBuckets'
import HorizontalBarChart from '../components/HorizontalBarChart'
import DataTable from '../components/DataTable'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import AgentIcon from '../components/AgentIcon'
import TeamLogo from '../components/TeamLogo'
import { pct, num, rating } from '../lib/format'


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
  const { data: agentPlayerData } = useData('player_agents')
  const [selectedAgent, setSelectedAgent] = useState('')
  const [minAgentMaps, setMinAgentMaps] = useState(10)
  const buckets = data?.buckets ?? []
  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds } =
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

  // Per-agent player leaderboard, from player_agents.json (same bucket
  // shape as player_buckets but keyed by agent too). Filtered with the
  // shared matcher so it tracks the same facets/date range as everything
  // else on the page.
  const agentPlayerRecords = useMemo(
    () => (agentPlayerData ? expandBuckets(agentPlayerData, 'p') : []),
    [agentPlayerData]
  )

  const agentNames = useMemo(
    () => [...new Set(agentPlayerRecords.map((r) => r.ag))].sort(),
    [agentPlayerRecords]
  )

  const agentPlayerRows = useMemo(() => {
    if (!selectedAgent || !agentPlayerData) return []
    const byPlayer = new Map()
    for (const r of agentPlayerRecords) {
      if (r.ag !== selectedAgent) continue
      if (!matchesFilters(r, FACETS, selections, dateRange)) continue
      if (!byPlayer.has(r.p)) byPlayer.set(r.p, [])
      byPlayer.get(r.p).push(r)
    }
    const out = []
    for (const [player, buckets] of byPlayer) {
      const s = aggregateAgentBuckets(buckets)
      if (!s || s.mapsPlayed < minAgentMaps) continue
      out.push({ player, team: agentPlayerData.meta[player]?.team, ...s })
    }
    return out.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
  }, [agentPlayerRecords, agentPlayerData, selectedAgent, selections, dateRange, minAgentMaps])

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const agentPlayerColumns = [
    {
      key: 'player', label: 'Player', align: 'left',
      format: (v) => (
        <Link to={`/players/${encodeURIComponent(v)}`} className="font-medium hover:text-accent-bright transition-colors">
          {v}
        </Link>
      ),
    },
    { key: 'team', label: 'Team', align: 'left', format: (v) => (v ? <TeamLogo team={v} size={18} /> : '—') },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (v) => num(v) },
    { key: 'avgRating', label: 'Rating', align: 'right', colorScale: true, format: (v) => rating(v) },
    { key: 'avgAcs', label: 'ACS', align: 'right', colorScale: true, format: (v) => num(v, 0) },
    { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v ? v.toFixed(2) : '—') },
  ]

  const matrixColumns = [
    { key: 'agent', label: 'Agent', align: 'left', format: (v) => <AgentIcon agent={v} size={20} /> },
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
                    <span className="text-xs text-muted">{m.roundsPlayed.toLocaleString('en-US')} rounds</span>
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

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Best players by agent</h3>
            <p className="text-muted text-xs">
              Each player's record on one specific agent, respecting the filters above.
            </p>
            <div className="flex items-center gap-3 flex-wrap mt-1">
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-muted"
              >
                <option value="">Select an agent…</option>
                {agentNames.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <label className="flex items-center gap-2 text-xs text-muted">
                Min. maps
                <input
                  type="number" min={0} value={minAgentMaps}
                  onChange={(e) => setMinAgentMaps(Number(e.target.value) || 0)}
                  className="bg-surface2 border border-hairline rounded-lg px-2 py-1 w-16 text-ink focus:outline-none focus:border-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </label>
            </div>
            {selectedAgent ? (
              agentPlayerRows.length ? (
                <DataTable columns={agentPlayerColumns} rows={agentPlayerRows} defaultSortKey="avgRating" />
              ) : (
                <p className="text-muted text-sm mt-2">
                  No players meet the minimum on {selectedAgent} within these filters.
                </p>
              )
            ) : (
              <p className="text-muted text-sm mt-2">Pick an agent to see its leaderboard.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
