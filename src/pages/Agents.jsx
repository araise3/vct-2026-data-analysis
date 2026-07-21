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

  const availableStages = useMemo(() => {
    if (!data || region === 'All') return []
    return data.regionStages[region] || []
  }, [data, region])

  const topAgents = useMemo(() => {
    if (!data) return []
    let source
    if (region === 'All') {
      source = data.overallPickRates
    } else if (stage === 'All' || !availableStages.includes(stage)) {
      source = data.byRegion[region] || []
    } else {
      source = data.byRegionStage[region]?.[stage] || []
    }
    return source.slice(0, 15)
  }, [data, region, stage, availableStages])

  function handleRegionChange(newRegion) {
    setRegion(newRegion)
    setStage('All') // reset the dependent filter whenever the region changes
  }

  const matrixRows = useMemo(() => {
    if (!data) return []
    const maps = Object.keys(data.mapAgentMatrix)
    const agents = data.overallPickRates.map((a) => a.agent)
    return agents.map((agent) => {
      const row = { agent }
      maps.forEach((mapName) => {
        row[mapName] = data.mapAgentMatrix[mapName][agent] ?? null
      })
      return row
    })
  }, [data])

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Agents</h1>
        <p className="text-muted text-sm mt-1">
          Pick rates and map performance across the season, weighted by rounds played
          (an event with more rounds counts for more than a small one).
        </p>
        <p className="text-muted text-xs mt-2 max-w-2xl">
          Filtering by phase within a stage (Group Stage / Playoffs / Play-ins) isn't available
          here — VLR's agent-utilization page is scraped as one aggregate per whole event, with
          no breakdown by phase. That granularity only exists at the individual-match level
          elsewhere on this site.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <FilterChips options={REGION_OPTIONS} value={region} onChange={handleRegionChange} />
        {region !== 'All' && availableStages.length > 0 && (
          <FilterChips options={['All', ...availableStages]} value={stage} onChange={setStage} />
        )}
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-ink mb-4">
          Top 15 agents by pick rate
          {region !== 'All' && ` — ${region}`}
          {region !== 'All' && stage !== 'All' && ` · ${stage}`}
        </h3>
        <HorizontalBarChart data={topAgents} labelKey="agent" valueKey="pickRate" formatValue={(v) => pct(v)} />
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-ink mb-2">Map win rates (attack vs. defense)</h3>
        <p className="text-muted text-xs mb-4">Season-wide, all regions combined.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.mapWinRates.map((m) => (
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
          Season-wide, all regions combined — sorted by overall pick rate.
        </p>
        <DataTable columns={matrixColumns} rows={matrixRows} defaultSortKey={mapNames[0]} />
      </div>
    </div>
  )
}
