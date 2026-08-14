import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandMatchRows } from '../lib/entityBuckets'
import { buildTeamMapRows, aggregateCompositions } from '../lib/compositions'
import FilterPanel, { FACETS } from './FilterPanel'
import FilterChips from './FilterChips'
import CompositionsTable from './CompositionsTable'
import mapIcons from '../lib/mapIcons.json'
import { pct, num } from '../lib/format'

const blurb = 'text-muted text-xs'

/**
 * Body of the Compositions page (pages/Compositions.jsx -- its own
 * top-level route). Joins match_results.json + match_players.json (see
 * src/lib/compositions.js for the join itself and why it can't reuse the
 * bucket model) into per-(team, map) 5-agent compositions, then shows the
 * most-played comps themselves. Per direct request this page is
 * compositions ONLY -- per-agent impact and role-signature trends (which
 * used to live here as sibling tables under the same join) moved to the
 * Agents page's own "Agent impact" tab (AgentImpact.jsx) instead, so
 * "Compositions" always means the composition list and nothing else. No
 * team_map_detail.json fetch here either, unlike AgentImpact.jsx -- the
 * composition list only needs games/wins/roundsWon/roundsLost, all sourced
 * from match_results, so that 3MB+ file would be dead weight on this page.
 *
 * There's no "All maps" option -- a composition is inherently a per-map
 * thing, so a specific map is always selected (see `effectiveMap` below),
 * and the table is scoped to it.
 */
export default function AgentCompositions() {
  const { data: matchData, loading: matchLoading } = useData('match_results')
  const { data: playerData, loading: playerLoading } = useData('match_players')

  const byMatch = useMemo(
    () => buildTeamMapRows(matchData, playerData),
    [matchData, playerData]
  )

  const records = useMemo(() => expandMatchRows(matchData), [matchData])
  const { selections, setFacet, clearAll, options, activeCount,
          dateRange, setDateRange, dateBounds,
          includeHiddenEvents, setIncludeHiddenEvents } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'], year: [2026] })

  const matches = useMemo(
    () => records.filter((r) => matchesFilters(r, FACETS, selections, dateRange, includeHiddenEvents)),
    [records, selections, dateRange, includeHiddenEvents]
  )

  // Team-map rows in scope -- the join itself only ever runs once per data
  // load (see byMatch above); a filter change just re-runs this cheap
  // flatMap over the already-filtered match list.
  const scoped = useMemo(() => matches.flatMap((m) => byMatch.get(m.id) ?? []), [matches, byMatch])

  const mapsInScope = useMemo(() => {
    const counts = new Map()
    for (const r of scoped) counts.set(r.map, (counts.get(r.map) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([map]) => map)
  }, [scoped])

  // No "All maps" option -- a composition is inherently a per-map thing (the
  // same five agents mean something different on Bind vs. Lotus), so this
  // page always scopes the table below to exactly one map. Falls back to
  // the most-played map in the current filter scope whenever the prior
  // selection isn't (yet, or any longer) part of it -- covers both first
  // mount and a filter change that drops the previously selected map.
  const [selectedMap, setSelectedMap] = useState(null)

  const effectiveMap = mapsInScope.includes(selectedMap) ? selectedMap : mapsInScope[0]

  const mapRows = useMemo(
    () => scoped.filter((r) => r.map === effectiveMap),
    [scoped, effectiveMap]
  )

  const compositions = useMemo(() => aggregateCompositions(mapRows), [mapRows])

  const cappedComps = compositions.comps.slice(0, 50)
  const hiddenCompsCount = compositions.comps.length - cappedComps.length

  const statStrip = useMemo(() => {
    if (!mapRows.length) return ''
    const distinct = compositions.distinctByMap[effectiveMap] || 0
    const top = compositions.comps[0]
    const topPct = top ? pct(top.share, 1) : '—'
    return `${effectiveMap} · ${num(mapRows.length)} team-maps · ${num(distinct)} distinct compositions · most common played ${topPct} of the time`
  }, [mapRows, compositions, effectiveMap])

  const loading = matchLoading || playerLoading

  if (loading || !matchData || !playerData) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        summary={`${num(scoped.length)} team-maps in scope`}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wide font-medium text-muted">Map</span>
        <FilterChips
          options={mapsInScope}
          value={effectiveMap}
          onChange={setSelectedMap}
          getBg={(opt) => mapIcons[opt]}
        />
      </div>

      {scoped.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No matches found for this filter combination.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className={blurb}>
            Identity is (map, five agents) — the same five agents on different maps are counted
            separately. Share is relative to that composition's own map.
          </p>
          {statStrip && <p className="text-ink text-xs font-medium">{statStrip}</p>}
          <CompositionsTable rows={cappedComps} hiddenCount={hiddenCompsCount} />
        </div>
      )}
    </div>
  )
}
