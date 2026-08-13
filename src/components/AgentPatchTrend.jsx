import { useMemo, useState } from 'react'
import { useData, useIdle } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets } from '../lib/entityBuckets'
import {
  buildPatchWindows, indexChangesByAgent, aggregateAgentByWindow, agentSeries,
  MIN_WINDOW_TEAM_MAPS,
} from '../lib/patchNotes'
import DataTable from './DataTable'
import FilterPanel, { FACETS } from './FilterPanel'
import FilterChips from './FilterChips'
import AgentIcon from './AgentIcon'
import TrendChart from './TrendChart'
import agentIcons from '../lib/agentIcons.json'
import { pct, num, shortDate } from '../lib/format'

const AGENT_NAMES = Object.values(agentIcons)
  .map((a) => a.displayName)
  .sort((a, b) => a.localeCompare(b))

const METRICS = ['Pick rate', 'Win rate']

// Both dates are bare 'YYYY-MM-DD' strings, so `new Date(s)` reads each as
// UTC midnight (see format.js's own note on this) -- consistently for both
// sides, so the plain millisecond difference is already a correct, DST-safe
// whole-day count with no extra UTC-anchoring needed.
function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000)
}

/**
 * View 2 of the /patches page: pick agent -> pick metric -> one TrendChart
 * (points are per-patch-window, x-positioned at each window's real release
 * date so unequal window lengths draw to scale) -> a DataTable with one row
 * per window, holding every window regardless of sample size (the chart
 * itself drops thin windows below MIN_WINDOW_TEAM_MAPS, but nothing is
 * hidden from the table -- it just shows a small `n`).
 *
 * Fetches player_agents.json on idle (see Players.jsx's identical
 * `useIdle()` pattern) rather than on mount -- the same 9.57MB file, and
 * this page has no reason to compete with a first paint for it either.
 *
 * `agent`/`onAgentChange` are controlled by the parent (Patches.jsx), which
 * syncs the selection to the `?agent=` query param for a linkable view.
 */
export default function AgentPatchTrend({ patches, eventMetaEvents, agent, onAgentChange }) {
  const [metric, setMetric] = useState(METRICS[0])

  const idle = useIdle()
  const { data, loading } = useData(idle ? 'player_agents' : null)

  const records = useMemo(() => (data ? expandBuckets(data, 'p') : []), [data])
  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds,
          includeHiddenEvents, setIncludeHiddenEvents } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'], year: [2026] })

  const windows = useMemo(() => buildPatchWindows({ patches }), [patches])
  const changesByAgent = useMemo(() => indexChangesByAgent(patches), [patches])
  const windowAggs = useMemo(() => aggregateAgentByWindow(filtered, windows), [filtered, windows])

  const points = useMemo(
    () => agentSeries(windowAggs, agent, metric === 'Pick rate' ? 'pick' : 'win', { minTeamMaps: MIN_WINDOW_TEAM_MAPS }),
    [windowAggs, agent, metric]
  )

  const agentChanges = useMemo(() => changesByAgent.get(agent) || [], [changesByAgent, agent])

  const domain = windows.length
    ? [windows[0].date, windows[windows.length - 1].endDate]
    : null

  const markers = useMemo(
    () => agentChanges.map((c) => ({
      date: c.date, label: `v${c.version}`,
      title: `v${c.version} (${c.type}) — ${c.summary}`,
    })),
    [agentChanges]
  )
  const newVersionDates = useMemo(
    () => new Set(agentChanges.filter((c) => c.type === 'new').map((c) => c.date)),
    [agentChanges]
  )

  const bands = useMemo(
    () => Object.entries(eventMetaEvents || {}).map(([name, ev]) => ({
      from: ev.startDate, to: ev.endDate, label: name,
    })),
    [eventMetaEvents]
  )

  const tableRows = useMemo(() => {
    return windowAggs.map((w, i) => {
      const a = w.byAgent.get(agent)
      const picks = a?.picks || 0
      const pickRate = w.teamMaps ? picks / w.teamMaps : 0
      const winRate = picks ? a.wins / picks : null

      const prev = windowAggs[i - 1]
      let pickDelta = null
      if (prev) {
        const prevA = prev.byAgent.get(agent)
        const prevPicks = prevA?.picks || 0
        const prevRate = prev.teamMaps ? prevPicks / prev.teamMaps : 0
        pickDelta = pickRate - prevRate
      }

      const changesHere = (changesByAgent.get(agent) || []).filter((c) => c.version === w.version)

      return {
        version: w.version,
        date: w.date,
        daysLive: daysBetween(w.date, w.endDate),
        teamMaps: w.teamMaps,
        pickRate,
        pickDelta,
        // scaleDivergingColor's own fixed midpoint is 0.5 (a win rate's
        // real neutral point) -- reusing it for a Δ-from-previous-window
        // stat (whose neutral point is 0, not 0.5) means shifting the
        // color-driving value by +0.5 before it reaches DataTable, while
        // `format` below still reads the real, unshifted `pickDelta` off
        // the row for display. DataTable has no per-column mid override,
        // so this is the least invasive way to get a real "0 = neutral"
        // diverging scale out of it without changing that shared component.
        pickDeltaColor: pickDelta === null ? null : 0.5 + pickDelta,
        winRate,
        changes: changesHere.map((c) => c.summary).join(' '),
      }
    })
  }, [windowAggs, agent, changesByAgent])

  const columns = [
    { key: 'version', label: 'Patch', align: 'left', format: (v) => `v${v}` },
    { key: 'date', label: 'Date', align: 'left', format: (v) => shortDate(v) },
    { key: 'daysLive', label: 'Days live', align: 'right', format: (v) => num(v) },
    { key: 'teamMaps', label: 'Team-maps', align: 'right', format: (v) => num(v, 1) },
    { key: 'pickRate', label: 'Pick%', align: 'right', colorScale: true, format: (v) => pct(v) },
    {
      key: 'pickDeltaColor', label: 'Δ Pick%', align: 'right', colorScale: true, diverging: true,
      format: (v, row) => (row.pickDelta == null ? '—' : `${row.pickDelta >= 0 ? '+' : ''}${pct(row.pickDelta)}`),
    },
    { key: 'winRate', label: 'Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v)) },
    { key: 'changes', label: 'Changes this patch', align: 'left', format: (v) => v || '—' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">Agent trend across patches</h2>
        <p className="text-muted text-sm mt-1">
          Pick rate and win rate are binned by patch window (release date to the next patch's release
          date), not by calendar week or month — the 2026 calendar has multi-week gaps between events
          that make a fixed calendar window land on a week with no matches at all.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {AGENT_NAMES.map((a) => {
          const active = a === agent
          return (
            <button
              key={a}
              onClick={() => onAgentChange(a)}
              className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-2xl text-xs font-medium border transition-colors ${
                active
                  ? 'bg-accent/20 text-accent-bright border-accent/50'
                  : 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
              }`}
            >
              <AgentIcon agent={a} size={18} />
              {a}
            </button>
          )
        })}
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
      />

      {loading || !data ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">Loading agent data…</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="font-display text-sm font-semibold text-ink flex items-center gap-2">
              <AgentIcon agent={agent} size={22} />
              {agent}
            </h3>
            <FilterChips options={METRICS} value={metric} onChange={setMetric} />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-4">
            <TrendChart
              points={points}
              format={(v) => pct(v, 1)}
              domain={domain}
              bands={bands}
              markers={markers}
              highlight={(p) => newVersionDates.has(p.date)}
              height={200}
            />
          </div>

          <DataTable columns={columns} rows={tableRows} defaultSortKey="date" defaultSortDir="asc" />
        </>
      )}
    </div>
  )
}
