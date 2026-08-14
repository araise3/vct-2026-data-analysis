import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandMatchRows } from '../lib/entityBuckets'
import { buildTeamMapRows, aggregateAgentImpact, aggregateRoleSignatures } from '../lib/compositions'
import FilterPanel, { FACETS } from './FilterPanel'
import FilterChips from './FilterChips'
import DataTable from './DataTable'
import AgentIcon from './AgentIcon'
import mapIcons from '../lib/mapIcons.json'
import { pct, num, rating } from '../lib/format'

const heading = 'font-display text-sm font-semibold text-ink'
const blurb = 'text-muted text-xs'

/**
 * Body of the Agents page's "Agent impact" tab. Joins match_results.json +
 * match_players.json (see src/lib/compositions.js for the join itself and
 * why it can't reuse the bucket model) into per-(team, map) 5-agent
 * compositions, then shows two cuts of that join: per-agent impact
 * stripped of mirror-match noise, and the role-shape ("2 controller, no
 * sentinel", etc.) meta. The most-played-compositions cut of the same join
 * lives on its own Compositions page instead (AgentCompositions.jsx) --
 * this tab used to include that table too, split out per direct request so
 * "Compositions" only ever means the composition list itself.
 *
 * Mounted only when this tab is selected (see Agents.jsx / StageTabs), so
 * the heavy data this needs (match_results + match_players + team_map_detail,
 * ~10.4MB combined) is never fetched by a plain /agents visit that stays on
 * the Overview tab.
 *
 * There's no "All maps" option -- a composition is inherently a per-map
 * thing, so a specific map is always selected (see `effectiveMap` below),
 * and every table here is scoped to it.
 */
export default function AgentImpact() {
  const { data: matchData, loading: matchLoading } = useData('match_results')
  const { data: playerData, loading: playerLoading } = useData('match_players')
  // Raw per-(match, map, team) ATK/DEF round counts + each player's own
  // per-map performance stats -- see its own comment in export_from_db.py.
  // Optional in buildTeamMapRows (degrades to null/missing fields if not
  // yet loaded), so this doesn't block the two heavier fetches above from
  // rendering first.
  const { data: detailData } = useData('team_map_detail')

  const byMatch = useMemo(
    () => buildTeamMapRows(matchData, playerData, detailData),
    [matchData, playerData, detailData]
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

  // No "All maps" option -- see this file's own doc comment. Falls back to
  // the most-played map in the current filter scope whenever the prior
  // selection isn't (yet, or any longer) part of it -- covers both first
  // mount and a filter change that drops the previously selected map.
  const [selectedMap, setSelectedMap] = useState(null)

  const effectiveMap = mapsInScope.includes(selectedMap) ? selectedMap : mapsInScope[0]

  const mapRows = useMemo(
    () => scoped.filter((r) => r.map === effectiveMap),
    [scoped, effectiveMap]
  )

  const impact = useMemo(() => aggregateAgentImpact(mapRows), [mapRows])
  const roleSignatures = useMemo(() => aggregateRoleSignatures(mapRows), [mapRows])

  const loading = matchLoading || playerLoading

  if (loading || !matchData || !playerData) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const impactColumns = [
    {
      key: 'agent', label: 'Agent', align: 'left', noPadding: true,
      format: (v) => (
        <span className="flex items-center gap-2 px-3 py-1">
          <AgentIcon agent={v} size={22} />
          <span className="text-ink text-xs font-medium">{v}</span>
        </span>
      ),
    },
    { key: 'picks', label: 'Picks', align: 'right', format: (v) => num(v) },
    { key: 'pickRate', label: 'Pick%', align: 'right', colorScale: true, format: (v) => pct(v, 1) },
    { key: 'winPct', label: 'Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    {
      key: 'rd', label: 'RD', align: 'right', colorScale: true,
      format: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`),
    },
    { key: 'atkWinPct', label: 'ATK Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    { key: 'defWinPct', label: 'DEF Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    { key: 'rating', label: 'R', align: 'right', colorScale: true, format: (v) => rating(v) },
    { key: 'acs', label: 'ACS', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : num(v, 0)) },
    { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'kast', label: 'KAST', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : pct(v)) },
    { key: 'adr', label: 'ADR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : num(v, 1)) },
    { key: 'kpr', label: 'KPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'apr', label: 'APR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fkpr', label: 'FKPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fdpr', label: 'FDPR', align: 'right', colorScale: true, colorInvert: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  ]

  const signatureColumns = [
    { key: 'label', label: 'Signature', align: 'left' },
    { key: 'games', label: 'Games', align: 'right', format: (v) => num(v) },
    { key: 'share', label: 'Share', align: 'right', colorScale: true, format: (v) => pct(v, 1) },
    { key: 'winPct', label: 'Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    {
      key: 'rd', label: 'RD', align: 'right', colorScale: true,
      format: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`),
    },
  ]

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
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">No matches found for this filter combination.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className={heading}>Agent impact</h3>
            <p className={blurb}>
              Win%, ATK Win% and DEF Win% count only maps where the opponent did not also pick
              this agent — a mirrored pick contributes one win and one loss by construction and
              pulls every contested agent's win rate toward 50%. The performance columns (Rating
              through FDPR) use every pick instead, contested or not — a mirror doesn't bias an
              individual player's own numbers, so restricting those to the uncontested subset
              would only throw away real signal. Every number below is scoped to the map
              selected above.
            </p>
            <DataTable columns={impactColumns} rows={impact.agents} defaultSortKey="picks" />
            {impact.omitted.length > 0 && (
              <p className="text-muted text-xs">
                Also picked: {impact.omitted.map((o) => `${o.agent} (${o.picks})`).join(', ')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={heading}>Role signatures</h3>
            <p className={blurb}>
              Structural comp shape (duelist/initiator/controller/sentinel counts) for the map
              selected above.
            </p>
            <DataTable columns={signatureColumns} rows={roleSignatures.signatures} defaultSortKey="games" />
            {roleSignatures.omittedCount > 0 && (
              <p className="text-muted text-xs">
                {roleSignatures.omittedCount} rarer signature{roleSignatures.omittedCount === 1 ? '' : 's'} (&lt;10 games) not shown.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
