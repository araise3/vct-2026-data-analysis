import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import HorizontalBarChart from '../components/HorizontalBarChart'
import DataTable from '../components/DataTable'
import FilterChips from '../components/FilterChips'
import { pct } from '../lib/format'

const REGION_OPTIONS = ['All', 'Americas', 'EMEA', 'Pacific', 'China', 'International']

export default function Agents() {
  const { data, loading } = useData('agents')
  const [region, setRegion] = useState('All')
  const [stage, setStage] = useState('All')
  const [phase, setPhase] = useState('All')

  const availableStages = useMemo(() => {
    if (!data || region === 'All') return []
    return data.regionStages[region] || []
  }, [data, region])

  const availablePhases = useMemo(() => {
    if (!data || region === 'All' || stage === 'All') return []
    return data.regionStagePhases[region]?.[stage] || []
  }, [data, region, stage])

  // Picks the most specific scope currently selected, falling back to
  // whatever is available -- e.g. selecting a region but leaving stage on
  // "All" shows the region-wide numbers, not an error.
  const scoped = useMemo(() => {
    if (!data) return { pickRates: [], mapWinRates: [] }
    if (region === 'All') return data.overall
    if (stage === 'All') return data.byRegion[region] || data.overall
    if (phase === 'All') return data.byRegionStage[region]?.[stage] || data.byRegion[region] || data.overall
    return (
      data.byRegionStagePhase[region]?.[stage]?.[phase] ||
      data.byRegionStage[region]?.[stage] ||
      data.byRegion[region] ||
      data.overall
    )
  }, [data, region, stage, phase])

  const matrixRows = useMemo(() => {
    if (!data) return []
    const maps = Object.keys(data.mapAgentMatrix)
    const agents = data.overall.pickRates.map((a) => a.agent)
    return agents.map((agent) => {
      const row = { agent }
      maps.forEach((mapName) => {
        row[mapName] = data.mapAgentMatrix[mapName][agent] ?? null
      })
      return row
    })
  }, [data])

  function handleRegionChange(newRegion) {
    setRegion(newRegion)
    setStage('All')
    setPhase('All')
  }

  function handleStageChange(newStage) {
    setStage(newStage)
    setPhase('All')
  }

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const mapNames = Object.keys(data.mapAgentMatrix)
  const matrixColumns = [
    { key: 'agent', label: 'Agent', align: 'left' },
    ...mapNames.map((m) => ({
      key: m, label: m, align: 'right', colorScale: true,
      format: (v) => (v === null || v === undefined ? '—' : pct(v, 0)),
    })),
  ]

  const scopeLabel = [region !== 'All' && region, stage !== 'All' && stage, phase !== 'All' && phase]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Agents</h1>
        <p className="text-muted text-sm mt-1">
          Pick rates and map performance, computed directly from per-map player data (not VLR's
          own aggregate page), so every stat here is filterable down to a specific phase.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <FilterChips options={REGION_OPTIONS} value={region} onChange={handleRegionChange} />
        {region !== 'All' && availableStages.length > 0 && (
          <FilterChips options={['All', ...availableStages]} value={stage} onChange={handleStageChange} />
        )}
        {region !== 'All' && stage !== 'All' && availablePhases.length > 0 && (
          <FilterChips options={['All', ...availablePhases]} value={phase} onChange={setPhase} />
        )}
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-ink mb-4">
          Top 15 agents by pick rate{scopeLabel && ` — ${scopeLabel}`}
        </h3>
        <HorizontalBarChart
          data={scoped.pickRates.slice(0, 15)}
          labelKey="agent" valueKey="pickRate" formatValue={(v) => pct(v)}
        />
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
        <h3 className="font-display text-sm font-semibold text-ink">Pick rate by map</h3>
        <p className="text-muted text-xs">
          Season-wide, all regions/stages combined — sorted by overall pick rate.
        </p>
        <DataTable columns={matrixColumns} rows={matrixRows} defaultSortKey={mapNames[0]} />
      </div>
    </div>
  )
}
