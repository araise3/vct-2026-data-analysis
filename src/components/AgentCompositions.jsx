import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandMatchRows } from '../lib/entityBuckets'
import { buildTeamMapRows, aggregateAgentImpact, aggregateCompositions, aggregateRoleSignatures } from '../lib/compositions'
import FilterPanel, { FACETS } from './FilterPanel'
import FilterChips from './FilterChips'
import DataTable from './DataTable'
import AgentIcon from './AgentIcon'
import MapIcon from './MapIcon'
import { pct, num, rating } from '../lib/format'

const MIN_GAMES_OPTIONS = ['3+', '5+', '10+']
const ALL_MAPS = 'All maps'

const heading = 'font-display text-sm font-semibold text-ink'
const blurb = 'text-muted text-xs'

/**
 * "Compositions & win rates" -- the Agents page's second tab. Joins
 * match_results.json + match_players.json (see src/lib/compositions.js for
 * the join itself and why it can't reuse the bucket model) into per-
 * (team, map) 5-agent compositions, then shows three cuts of that join:
 * per-agent impact stripped of mirror-match noise, the most-played comps
 * themselves, and the role-shape ("2 controller, no sentinel", etc.) meta.
 *
 * Mounted only when this tab is selected (see Agents.jsx / StageTabs), so
 * the two data files this needs (6.7MB + 0.6MB) are never fetched by a
 * plain /agents visit that stays on the Overview tab.
 */
export default function AgentCompositions() {
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

  const [selectedMap, setSelectedMap] = useState(ALL_MAPS)
  const [minGames, setMinGames] = useState('5+')

  const effectiveMap = selectedMap !== ALL_MAPS && !mapsInScope.includes(selectedMap) ? ALL_MAPS : selectedMap

  const mapRows = useMemo(
    () => (effectiveMap === ALL_MAPS ? scoped : scoped.filter((r) => r.map === effectiveMap)),
    [scoped, effectiveMap]
  )

  const impact = useMemo(() => aggregateAgentImpact(mapRows), [mapRows])
  const compositions = useMemo(() => aggregateCompositions(mapRows), [mapRows])
  const roleSignatures = useMemo(() => aggregateRoleSignatures(mapRows), [mapRows])

  const minGamesFloor = parseInt(minGames, 10)
  const flooredComps = useMemo(
    () => compositions.comps.filter((c) => c.games >= minGamesFloor),
    [compositions, minGamesFloor]
  )
  const cappedComps = flooredComps.slice(0, 50)
  const hiddenCompsCount = flooredComps.length - cappedComps.length

  const statStrip = useMemo(() => {
    if (!mapRows.length) return ''
    const distinct = effectiveMap === ALL_MAPS
      ? Object.values(compositions.distinctByMap).reduce((n, c) => n + c, 0)
      : compositions.distinctByMap[effectiveMap] || 0
    const top = compositions.comps[0]
    const label = effectiveMap === ALL_MAPS ? 'All maps' : effectiveMap
    const topPct = top ? pct(top.share, 1) : '—'
    return `${label} · ${num(mapRows.length)} team-maps · ${num(distinct)} distinct compositions · most common played ${topPct} of the time`
  }, [mapRows, compositions, effectiveMap])

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
    { key: 'contestedRate', label: 'Contested%', align: 'right', colorScale: true, format: (v) => pct(v, 1) },
    { key: 'uncontested', label: 'Uncontested', align: 'right', format: (v) => num(v) },
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
    { key: 'hsPct', label: 'HS%', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : pct(v)) },
  ]

  const compColumns = [
    {
      key: 'compLabel', label: 'Composition', align: 'left', noPadding: true,
      format: (v, row) => (
        <span className="flex items-center gap-1 px-3 py-1">
          {row.comp.map((a, i) => <AgentIcon key={`${a}-${i}`} agent={a} size={22} />)}
        </span>
      ),
    },
    ...(effectiveMap === ALL_MAPS ? [{
      key: 'map', label: 'Map', align: 'left', noPadding: true,
      format: (v) => (
        <span className="flex items-center gap-1.5 px-3 py-1">
          <MapIcon map={v} width={28} />
          {v}
        </span>
      ),
    }] : []),
    { key: 'games', label: 'Games', align: 'right', format: (v) => num(v) },
    { key: 'share', label: 'Share', align: 'right', colorScale: true, format: (v) => pct(v, 1) },
    { key: 'winPct', label: 'Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    {
      key: 'rd', label: 'RD', align: 'right', colorScale: true,
      format: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`),
    },
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide font-medium text-muted">Map</span>
          <FilterChips
            options={[ALL_MAPS, ...mapsInScope]}
            value={effectiveMap}
            onChange={setSelectedMap}
            renderLabel={(opt) => opt === ALL_MAPS ? opt : (
              <span className="flex items-center gap-1.5">
                <MapIcon map={opt} width={24} />
                {opt}
              </span>
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide font-medium text-muted">
            Min games (compositions table)
          </span>
          <FilterChips options={MIN_GAMES_OPTIONS} value={minGames} onChange={setMinGames} />
        </div>
      </div>

      {scoped.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
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
              through HS%) use every pick instead, contested or not — a mirror doesn't bias an
              individual player's own numbers, so restricting those to the uncontested subset
              would only throw away real signal. Contested% is how often the other team ran this
              agent too. Select a specific map above to see per-map numbers instead of the
              all-maps average.
            </p>
            <DataTable columns={impactColumns} rows={impact.agents} defaultSortKey="picks" />
            {impact.omitted.length > 0 && (
              <p className="text-muted text-xs">
                Also picked: {impact.omitted.map((o) => `${o.agent} (${o.picks})`).join(', ')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={heading}>Most-played compositions</h3>
            <p className={blurb}>
              Identity is (map, five agents) — the same five agents on different maps are counted
              separately. Share is relative to that composition's own map.
            </p>
            {statStrip && <p className="text-ink text-xs font-medium">{statStrip}</p>}
            <DataTable columns={compColumns} rows={cappedComps} defaultSortKey="games" />
            {hiddenCompsCount > 0 && (
              <p className="text-muted text-xs">
                {hiddenCompsCount} more composition{hiddenCompsCount === 1 ? '' : 's'} with ≥{minGamesFloor} games not shown.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={heading}>Role signatures</h3>
            <p className={blurb}>
              Structural comp shape (duelist/initiator/controller/sentinel counts) — aggregated
              across maps even when one map is selected above, since a role shape is a general
              strategic choice rather than a map-specific artifact.
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
