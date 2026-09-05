import { useMemo, useState } from 'react'
import { Segmented } from 'antd'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandMatchRows, buildEventWeekDateSpans, attachEventWeekDateSpans } from '../lib/entityBuckets'
import agentRoles from '../lib/agentRoles.json'
import FilterPanel, { FACETS } from './FilterPanel'
import AgentIcon from './AgentIcon'
import MapArtwork from './MapArtwork'
import { num, pct } from '../lib/format'

const ROLE_ORDER = ['Duelist', 'Initiator', 'Controller', 'Sentinel']
const ROLE_TONE = {
  Duelist: '#ff6573',
  Initiator: '#d9a441',
  Controller: '#7c86e8',
  Sentinel: '#55bda7',
}

function aggregateBuckets(buckets) {
  let totalRows = 0
  const maps = {}
  const agents = {}

  for (const bucket of buckets) {
    totalRows += bucket.playerRows || 0

    for (const [agent, count] of Object.entries(bucket.agentCounts || {})) {
      agents[agent] = (agents[agent] || 0) + count
    }

    for (const [map, values] of Object.entries(bucket.mapStats || {})) {
      if (!maps[map]) {
        maps[map] = {
          rounds: 0,
          atkWinRounds: 0,
          defWinRounds: 0,
          agentCounts: {},
        }
      }
      maps[map].rounds += values.rounds || 0
      maps[map].atkWinRounds += values.atkWinRounds || 0
      maps[map].defWinRounds += values.defWinRounds || 0
    }

    for (const [map, counts] of Object.entries(bucket.mapAgentCounts || {})) {
      if (!maps[map]) {
        maps[map] = {
          rounds: 0,
          atkWinRounds: 0,
          defWinRounds: 0,
          agentCounts: {},
        }
      }
      for (const [agent, count] of Object.entries(counts || {})) {
        maps[map].agentCounts[agent] = (maps[map].agentCounts[agent] || 0) + count
      }
    }
  }

  const teamMaps = totalRows / 5
  const agentRows = Object.entries(agents)
    .map(([agent, picks]) => ({
      agent,
      picks,
      pickRate: teamMaps ? picks / teamMaps : null,
      role: agentRoles[agent] || 'Unknown',
    }))
    .sort((a, b) => b.picks - a.picks)

  const roleRows = ROLE_ORDER.map((role) => {
    const picks = agentRows
      .filter((row) => row.role === role)
      .reduce((sum, row) => sum + row.picks, 0)
    return {
      role,
      picks,
      averagePerComposition: teamMaps ? picks / teamMaps : 0,
      slotShare: totalRows ? picks / totalRows : 0,
    }
  })

  const mapRows = Object.entries(maps).map(([map, values]) => {
    const sideRounds = values.atkWinRounds + values.defWinRounds
    const mapTeamMaps = Object.values(values.agentCounts).reduce((sum, count) => sum + count, 0) / 5
    const topAgents = Object.entries(values.agentCounts)
      .map(([agent, picks]) => ({
        agent,
        picks,
        pickRate: mapTeamMaps ? picks / mapTeamMaps : null,
      }))
      .sort((a, b) => b.picks - a.picks)

    return {
      map,
      rounds: values.rounds,
      sideRounds,
      teamMaps: mapTeamMaps,
      atk: sideRounds ? values.atkWinRounds / sideRounds : null,
      def: sideRounds ? values.defWinRounds / sideRounds : null,
      bias: sideRounds ? values.atkWinRounds / sideRounds - 0.5 : null,
      topAgents,
    }
  })

  const sideRounds = mapRows.reduce((sum, row) => sum + row.sideRounds, 0)
  const attackWins = mapRows.reduce((sum, row) => sum + (row.atk || 0) * row.sideRounds, 0)

  return {
    totalRows,
    teamMaps,
    sideRounds,
    atk: sideRounds ? attackWins / sideRounds : null,
    def: sideRounds ? 1 - attackWins / sideRounds : null,
    maps: mapRows,
    agents: agentRows,
    roles: roleRows,
  }
}

function ScopeMetric({ label, value, detail }) {
  return (
    <div className="min-w-0 border-b border-hairline px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-[-0.025em] text-ink">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted">{detail}</div>
    </div>
  )
}

function edgeLabel(atk) {
  if (atk == null) return 'No side data'
  const points = Math.abs(atk - 0.5) * 100
  if (points < 0.05) return 'Perfectly even'
  return `${atk > 0.5 ? 'Attack' : 'Defense'} +${points.toFixed(1)} pp`
}

function MapBalance({ rows, selectedMap, onSelectMap, sortMode, onSortMode }) {
  const sorted = useMemo(() => {
    const next = [...rows]
    if (sortMode === 'Volume') return next.sort((a, b) => b.rounds - a.rounds)
    if (sortMode === 'ATK') return next.sort((a, b) => (b.atk ?? -1) - (a.atk ?? -1))
    if (sortMode === 'DEF') return next.sort((a, b) => (b.def ?? -1) - (a.def ?? -1))
    return next.sort((a, b) => Math.abs(b.bias || 0) - Math.abs(a.bias || 0))
  }, [rows, sortMode])

  const maxBias = Math.max(0.01, ...rows.map((row) => Math.abs(row.bias || 0)))

  return (
    <section className="rounded-md border border-hairline bg-surface">
      <div className="flex flex-col gap-3 border-b border-hairline px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Side balance by map</h3>
          <p className="mt-0.5 text-[10px] text-muted">Distance from the 50% midpoint, weighted by rounds.</p>
        </div>
        <Segmented
          size="small"
          value={sortMode}
          onChange={onSortMode}
          options={['Bias', 'Volume', 'ATK', 'DEF']}
        />
      </div>

      <div className="divide-y divide-hairline">
        {sorted.map((row) => {
          const attackFavored = (row.bias || 0) >= 0
          const width = Math.min(50, (Math.abs(row.bias || 0) / maxBias) * 48)
          const selected = selectedMap === row.map
          return (
            <button
              key={row.map}
              type="button"
              onClick={() => onSelectMap(row.map)}
              aria-pressed={selected}
              className={`grid w-full grid-cols-[70px_minmax(120px,1fr)_94px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:grid-cols-[84px_minmax(180px,1fr)_126px] ${selected ? 'bg-surface2' : ''}`}
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] font-semibold text-ink">{row.map}</div>
                <div className="mt-0.5 text-[9px] tabular-nums text-muted">{num(row.rounds)} rnds</div>
              </div>

              <div className="relative h-5" aria-label={`${row.map}: ${edgeLabel(row.atk)}`}>
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline" />
                <div className="absolute bottom-0 left-1/2 top-0 w-px bg-muted/50" />
                <div
                  className="absolute top-[5px] h-[10px] rounded-sm"
                  style={{
                    left: attackFavored ? '50%' : `${50 - width}%`,
                    width: `${width}%`,
                    backgroundColor: attackFavored ? '#ff6573' : '#6ea7dc',
                  }}
                />
              </div>

              <div className="flex items-baseline justify-end gap-2 tabular-nums">
                <span className="text-[11px] font-semibold text-accent">{pct(row.atk)}</span>
                <span className="text-[9px] text-muted">ATK</span>
                <span className="text-[11px] font-semibold text-[#84b7e5]">{pct(row.def)}</span>
                <span className="text-[9px] text-muted">DEF</span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-hairline px-4 py-2 text-[9px] uppercase tracking-[0.08em] text-muted">
        <span>Defense advantage</span>
        <span className="text-center normal-case tracking-normal">Scale ±{(maxBias * 100).toFixed(1)} pp</span>
        <span className="text-right">Attack advantage</span>
      </div>
    </section>
  )
}

function MapProfile({ row }) {
  if (!row) return null

  return (
    <aside className="overflow-hidden rounded-md border border-hairline bg-surface">
      <MapArtwork
        map={row.map}
        eyebrow="Selected map"
        detail={`${num(row.teamMaps)} team-maps · ${num(row.rounds)} rounds`}
        className="rounded-none border-0 border-b border-hairline"
      />

      <div className="p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">Side edge</div>
            <div className="mt-1 text-lg font-semibold text-ink">{edgeLabel(row.atk)}</div>
          </div>
          <div className="text-right text-[10px] tabular-nums text-muted">{num(row.sideRounds)} attributed rounds</div>
        </div>

        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface3" aria-label={`Attack ${pct(row.atk)}, defense ${pct(row.def)}`}>
          <div className="bg-accent" style={{ width: `${(row.atk || 0) * 100}%` }} />
          <div className="bg-[#6ea7dc]" style={{ width: `${(row.def || 0) * 100}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums">
          <span className="text-accent">ATK {pct(row.atk)}</span>
          <span className="text-[#84b7e5]">DEF {pct(row.def)}</span>
        </div>

        <div className="mt-5 border-t border-hairline pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-ink">Most selected agents</h4>
            <span className="text-[9px] uppercase tracking-[0.1em] text-muted">Pick rate</span>
          </div>
          <div className="space-y-2.5">
            {row.topAgents.slice(0, 5).map((agent) => (
              <div key={agent.agent} className="grid grid-cols-[22px_68px_1fr_42px] items-center gap-2">
                <AgentIcon agent={agent.agent} size={20} />
                <span className="truncate text-[10px] font-medium text-ink">{agent.agent}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (agent.pickRate || 0) * 100)}%` }} />
                </div>
                <span className="text-right text-[10px] font-semibold tabular-nums text-ink">{pct(agent.pickRate)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}

function MetaDistribution({ agents, roles, teamMaps }) {
  const topAgents = agents.slice(0, 10)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
      <section className="rounded-md border border-hairline bg-surface">
        <div className="border-b border-hairline px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Agent selection landscape</h3>
          <p className="mt-0.5 text-[10px] text-muted">The ten most common picks per team-map in the active scope.</p>
        </div>
        <div className="grid gap-x-5 gap-y-3 p-4 md:grid-cols-2">
          {topAgents.map((row) => (
            <div key={row.agent} className="grid grid-cols-[26px_76px_1fr_44px] items-center gap-2">
              <AgentIcon agent={row.agent} size={24} />
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold text-ink">{row.agent}</div>
                <div className="text-[9px] text-muted">{num(row.picks)} picks</div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (row.pickRate || 0) * 100)}%` }} />
              </div>
              <div className="text-right text-[10px] font-semibold tabular-nums text-ink">{pct(row.pickRate)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-hairline bg-surface">
        <div className="border-b border-hairline px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Role shape</h3>
          <p className="mt-0.5 text-[10px] text-muted">Average role slots in a five-agent composition.</p>
        </div>
        <div className="p-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-surface3">
            {roles.map((row) => (
              <div
                key={row.role}
                title={`${row.role}: ${pct(row.slotShare)}`}
                style={{ width: `${row.slotShare * 100}%`, backgroundColor: ROLE_TONE[row.role] }}
              />
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {roles.map((row) => (
              <div key={row.role} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: ROLE_TONE[row.role] }} />
                  <span className="text-[10px] font-medium text-ink">{row.role}</span>
                </div>
                <div className="text-right tabular-nums">
                  <span className="text-[11px] font-semibold text-ink">{row.averagePerComposition.toFixed(2)}</span>
                  <span className="ml-1 text-[9px] text-muted">/ comp</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-hairline pt-3 text-[9px] leading-relaxed text-muted">
            Based on {num(teamMaps)} observed team compositions. Role totals describe the meta shape, not a required lineup template.
          </div>
        </div>
      </section>
    </div>
  )
}

export default function AgentOverview() {
  const { data, loading } = useData('agents')
  const { data: matchResults } = useData('match_results')
  const [selectedMap, setSelectedMap] = useState(null)
  // Start with the highest-sample maps so the selected profile and first
  // visible row agree. Bias remains one click away for outlier hunting.
  const [sortMode, setSortMode] = useState('Volume')

  const matchRows = useMemo(() => (matchResults ? expandMatchRows(matchResults) : []), [matchResults])
  const eventWeekSpans = useMemo(() => buildEventWeekDateSpans(matchRows), [matchRows])
  const datedBuckets = useMemo(
    () => attachEventWeekDateSpans(data?.buckets || [], eventWeekSpans),
    [data, eventWeekSpans],
  )
  const defaultSelections = useMemo(() => ({ competition: ['VCT'], year: [2026] }), [])
  const ff = useFacetedFilter(datedBuckets, FACETS, defaultSelections)
  const scoped = useMemo(() => aggregateBuckets(ff.filtered), [ff.filtered])

  const effectiveMap = scoped.maps.some((row) => row.map === selectedMap)
    ? selectedMap
    : [...scoped.maps].sort((a, b) => b.rounds - a.rounds)[0]?.map
  const selectedRow = scoped.maps.find((row) => row.map === effectiveMap)
  const mostSkewed = [...scoped.maps].sort((a, b) => Math.abs(b.bias || 0) - Math.abs(a.bias || 0))[0]
  const topFive = scoped.agents.slice(0, 5)
  const topFiveShare = scoped.totalRows
    ? topFive.reduce((sum, row) => sum + row.picks, 0) / scoped.totalRows
    : null

  if (loading || !data) return <p className="p-6 text-sm text-muted">Loading agent overview…</p>

  return (
    <div className="space-y-4">
      <FilterPanel {...ff} facetFields={FACETS} />

      {scoped.maps.length === 0 ? (
        <div className="rounded-md border border-hairline bg-surface px-4 py-10 text-center text-sm text-muted">
          No agent or map data matches this filter combination.
        </div>
      ) : (
        <>
          <section className="grid overflow-hidden rounded-md border border-hairline bg-surface sm:grid-cols-2 lg:grid-cols-4">
            <ScopeMetric label="Observed lineups" value={num(scoped.teamMaps)} detail={`${num(scoped.totalRows)} player-map selections`} />
            <ScopeMetric label="Side balance" value={edgeLabel(scoped.atk)} detail={`ATK ${pct(scoped.atk)} · DEF ${pct(scoped.def)}`} />
            <ScopeMetric label="Largest map tilt" value={mostSkewed?.map || '—'} detail={mostSkewed ? edgeLabel(mostSkewed.atk) : 'No map data'} />
            <ScopeMetric label="Top-five concentration" value={pct(topFiveShare)} detail={topFive.map((row) => row.agent).join(', ')} />
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.75fr)]">
            <MapBalance
              rows={scoped.maps}
              selectedMap={effectiveMap}
              onSelectMap={setSelectedMap}
              sortMode={sortMode}
              onSortMode={setSortMode}
            />
            <MapProfile row={selectedRow} />
          </div>

          <MetaDistribution agents={scoped.agents} roles={scoped.roles} teamMaps={scoped.teamMaps} />

          <p className="px-1 text-[9px] leading-relaxed text-muted">
            Side balance divides side-attributed round wins, so it is round-weighted rather than an average of event buckets. Agent pick rate is selections per team-map and can total 500% across all agents because each lineup contains five agents. For recurring five-agent combinations, use the{' '}
            <Link to="/compositions" className="font-medium text-accent hover:underline">Compositions page</Link>.
          </p>
        </>
      )}
    </div>
  )
}
