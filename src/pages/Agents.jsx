import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import HorizontalBarChart from '../components/HorizontalBarChart'
import DataTable from '../components/DataTable'
import FilterChips from '../components/FilterChips'
import MultiFilterChips from '../components/MultiFilterChips'
import AgentIcon from '../components/AgentIcon'
import { pct } from '../lib/format'

const REGION_OPTIONS = ['All', 'Americas', 'EMEA', 'Pacific', 'China', 'International']

// Aggregates a list of raw buckets into pick rates + map win rates, summing
// counts first and computing percentages last -- this is what makes
// arbitrary multi-select combinations correct (rather than averaging
// pre-computed percentages, which would weight a 10-round week the same as
// a 200-round week).
function aggregateBuckets(buckets) {
  const agentCounts = {}
  let totalRows = 0
  const mapStats = {}

  for (const b of buckets) {
    totalRows += b.playerRows
    for (const [agent, count] of Object.entries(b.agentCounts)) {
      agentCounts[agent] = (agentCounts[agent] || 0) + count
    }
    for (const [mapName, stats] of Object.entries(b.mapStats)) {
      if (!mapStats[mapName]) mapStats[mapName] = { rounds: 0, atkWinRounds: 0, defWinRounds: 0 }
      mapStats[mapName].rounds += stats.rounds
      mapStats[mapName].atkWinRounds += stats.atkWinRounds
      mapStats[mapName].defWinRounds += stats.defWinRounds
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

  return { pickRates, mapWinRates }
}

export default function Agents() {
  const { data, loading } = useData('agents')
  const [region, setRegion] = useState('All')
  const [stage, setStage] = useState('All')
  const [phase, setPhase] = useState('All')
  const [weeks, setWeeks] = useState([]) // multi-select; empty = no filter

  const availableStages = useMemo(() => {
    if (!data || region === 'All') return []
    return data.regionStages[region] || []
  }, [data, region])

  const availablePhases = useMemo(() => {
    if (!data || region === 'All' || stage === 'All') return []
    return data.regionStagePhases[region]?.[stage] || []
  }, [data, region, stage])

  const availableWeeks = useMemo(() => {
    if (!data || region === 'All' || stage === 'All' || phase === 'All') return []
    return data.regionStagePhaseWeeks[region]?.[stage]?.[phase] || []
  }, [data, region, stage, phase])

  const filteredBuckets = useMemo(() => {
    if (!data) return []
    return data.buckets.filter((b) =>
      (region === 'All' || b.region === region) &&
      (stage === 'All' || b.stage === stage) &&
      (phase === 'All' || b.phase === phase) &&
      (weeks.length === 0 || weeks.includes(b.week))
    )
  }, [data, region, stage, phase, weeks])

  const scoped = useMemo(() => aggregateBuckets(filteredBuckets), [filteredBuckets])

  const matrixRows = useMemo(() => {
    if (!data) return []
    const { pickRates } = aggregateBuckets(filteredBuckets)

    const mapAgentCounts = {} // { mapName: { agent: count } }
    const mapTotalRows = {}   // { mapName: totalPlayerRows }
    for (const b of filteredBuckets) {
      for (const [mapName, agentCounts] of Object.entries(b.mapAgentCounts || {})) {
        if (!mapAgentCounts[mapName]) mapAgentCounts[mapName] = {}
        for (const [agent, count] of Object.entries(agentCounts)) {
          mapAgentCounts[mapName][agent] = (mapAgentCounts[mapName][agent] || 0) + count
          mapTotalRows[mapName] = (mapTotalRows[mapName] || 0) + count
        }
      }
    }

    return pickRates.map(({ agent }) => {
      const row = { agent }
      for (const mapName of data.mapNames) {
        const teamSlots = (mapTotalRows[mapName] || 0) / 5
        const count = mapAgentCounts[mapName]?.[agent]
        row[mapName] = teamSlots && count ? count / teamSlots : (count ? 0 : null)
      }
      return row
    })
  }, [data, filteredBuckets])

  function handleRegionChange(newRegion) {
    setRegion(newRegion)
    setStage('All')
    setPhase('All')
    setWeeks([])
  }

  function handleStageChange(newStage) {
    setStage(newStage)
    setPhase('All')
    setWeeks([])
  }

  function handlePhaseChange(newPhase) {
    setPhase(newPhase)
    setWeeks([])
  }

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const mapNames = data.mapNames
  const matrixColumns = [
    { key: 'agent', label: 'Agent', align: 'left', width: 172, format: (v) => <AgentIcon agent={v} size={20} /> },
    ...mapNames.map((m) => ({
      key: m, label: m, align: 'right', colorScale: true,
      format: (v) => (v === null || v === undefined ? '—' : pct(v, 0)),
    })),
  ]

  const scopeLabel = [
    region !== 'All' && region,
    stage !== 'All' && stage,
    phase !== 'All' && phase,
    weeks.length > 0 && `${weeks.length} week${weeks.length > 1 ? 's' : ''} selected`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Agents</h1>
        <p className="text-muted text-sm mt-1">
          Pick rates and map performance, computed directly from per-map player data (not VLR's
          own aggregate page), so every stat here is filterable down to a specific week or round.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <FilterChips options={REGION_OPTIONS} value={region} onChange={handleRegionChange} />
        {region !== 'All' && availableStages.length > 0 && (
          <FilterChips options={['All', ...availableStages]} value={stage} onChange={handleStageChange} />
        )}
        {region !== 'All' && stage !== 'All' && availablePhases.length > 0 && (
          <FilterChips options={['All', ...availablePhases]} value={phase} onChange={handlePhaseChange} />
        )}
        {region !== 'All' && stage !== 'All' && phase !== 'All' && availableWeeks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Week / round (select multiple)</span>
            <MultiFilterChips
              options={availableWeeks}
              selected={weeks}
              onChange={setWeeks}
              renderLabel={(week) => week.includes(': ') ? week.split(': ').slice(1).join(': ') : week}
            />
          </div>
        )}
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-ink mb-4">
          Top 15 agents by pick rate{scopeLabel && ` — ${scopeLabel}`}
        </h3>
        <HorizontalBarChart
          data={scoped.pickRates.slice(0, 15)}
          labelKey="agent" valueKey="pickRate" formatValue={(v) => pct(v)}
          renderLabel={(d) => <AgentIcon agent={d.agent} size={18} />}
        />
        {scoped.pickRates.length === 0 && (
          <p className="text-muted text-xs">No data in this scope yet.</p>
        )}
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-ink mb-2">
          Map win rates (attack vs. defense){scopeLabel && ` — ${scopeLabel}`}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
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
          {scoped.mapWinRates.length === 0 && (
            <p className="text-muted text-xs col-span-full">No maps played in this scope yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">
          Pick rate by map{scopeLabel && ` — ${scopeLabel}`}
        </h3>
        <p className="text-muted text-xs">
          {scopeLabel ? 'Matches the filters above' : 'Season-wide, all regions/stages/weeks combined'} — sorted by overall pick rate.
        </p>
        <DataTable columns={matrixColumns} rows={matrixRows} defaultSortKey={mapNames[0]} />
      </div>
    </div>
  )
}
