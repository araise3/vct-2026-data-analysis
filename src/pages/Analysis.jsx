import { useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  aggregatePlayerBuckets,
  aggregateTeamBuckets,
  attachDateSpans,
  buildPlayerDayGroups,
  expandBuckets,
  expandMapLengthRows,
  expandSeriesRows,
  groupByEntity,
  teamInScope,
} from '../lib/entityBuckets'
import { rolesInScope } from '../lib/peerComparison'
import { getStatisticById } from '../lib/statCatalog'
import { teamTierExtras } from '../lib/statDefs'
import { editDistance, normalizeQuery } from '../lib/startQuery'
import DataTable from '../components/DataTable'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import Flag from '../components/Flag'
import TeamLogo from '../components/TeamLogo'
import { eventLabel, num, pct, rating } from '../lib/format'

const ROLE_NAMES = ['Duelist', 'Initiator', 'Controller', 'Sentinel']

function canonicalName(requested, names) {
  if (!requested || !names.length) return ''
  const normalized = normalizeQuery(requested)
  const exact = names.find((name) => normalizeQuery(name) === normalized)
  if (exact) return exact
  const closest = names
    .map((name) => ({ name, distance: editDistance(normalized, normalizeQuery(name)) }))
    .sort((a, b) => a.distance - b.distance || a.name.length - b.name.length)[0]
  return closest && closest.distance <= (normalized.length <= 5 ? 1 : 2) ? closest.name : ''
}

function SummaryMetric({ label, value, format = (entry) => entry }) {
  return (
    <div className="border-l border-hairline px-4 first:border-l-0 first:pl-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value == null ? '—' : format(value)}</p>
    </div>
  )
}

function AnalysisRoute() {
  const [searchParams] = useSearchParams()
  const requestedPlayers = searchParams.getAll('player').filter(Boolean)
  const requestedTeams = searchParams.getAll('team').filter(Boolean)
  const requestedRole = ROLE_NAMES.includes(searchParams.get('role')) ? searchParams.get('role') : ''
  const requestedPopulation = ['players', 'teams'].includes(searchParams.get('population')) ? searchParams.get('population') : ''
  const statistic = getStatisticById(searchParams.get('metric'))
  const hasPlayerQuestion = requestedPlayers.length > 0 || !!requestedRole
  const mode = hasPlayerQuestion
    ? 'players'
    : requestedTeams.length || requestedPopulation === 'teams'
      ? 'teams'
      : requestedPopulation === 'players' || !statistic
        ? 'players'
        : statistic.definition.matchLevel ? 'matches' : statistic.entity
  const activeStatistic = statistic && (mode === 'matches' || statistic.entity === mode) ? statistic : null
  const dataName = mode === 'players'
    ? 'player_buckets'
    : mode === 'teams' ? 'team_buckets'
    : statistic.definition.matchLevel === 'series' ? 'series_length' : 'map_length'

  const { data, loading, error } = useData(dataName)
  // Role inference is part of the answer rather than an optional detail, so
  // this is eager on the analysis route. It both supplies real per-day spans
  // and determines the primary role each player played inside the same scope.
  const { data: agentData, loading: agentLoading } = useData(mode === 'players' ? 'player_agents' : null)

  const rawRecords = useMemo(() => {
    if (!data) return []
    if (mode === 'matches') {
      return statistic.definition.matchLevel === 'series'
        ? expandSeriesRows(data)
        : expandMapLengthRows(data)
    }
    return expandBuckets(data, mode === 'players' ? 'p' : 't')
  }, [data, mode, statistic])

  const dayGroups = useMemo(
    () => (mode === 'players' && agentData ? buildPlayerDayGroups(agentData.buckets) : new Map()),
    [agentData, mode],
  )
  const records = useMemo(
    () => (mode === 'players' ? attachDateSpans(rawRecords, dayGroups) : rawRecords),
    [dayGroups, mode, rawRecords],
  )

  const {
    selections, setFacet, clearAll, filtered, options, activeCount,
    dateRange, setDateRange, dateBounds,
    includeHiddenEvents, setIncludeHiddenEvents,
  } = useFacetedFilter(records, FACETS, { competition: ['VCT'], year: [2026] })

  const scopedAgentRecords = useMemo(() => {
    if (mode !== 'players' || !agentData) return []
    return expandBuckets(agentData, 'p').filter((record) =>
      matchesFilters(record, FACETS, selections, dateRange, includeHiddenEvents))
  }, [agentData, dateRange, includeHiddenEvents, mode, selections])
  const roleByPlayer = useMemo(() => rolesInScope(scopedAgentRecords), [scopedAgentRecords])

  const entityRows = useMemo(() => {
    if (!data || mode === 'matches') return []
    const output = []
    for (const [name, buckets] of groupByEntity(filtered)) {
      const aggregate = mode === 'players'
        ? aggregatePlayerBuckets(buckets)
        : { ...aggregateTeamBuckets(buckets), ...teamTierExtras(buckets) }
      if (!aggregate?.mapsPlayed) continue
      const meta = data.meta?.[name] || {}
      const metricValue = statistic && statistic.entity === mode && !statistic.definition.matchLevel
        ? statistic.definition.compute(aggregate)
        : null
      output.push({
        ...aggregate,
        name,
        team: mode === 'players' ? teamInScope(buckets, meta.team) : name,
        region: meta.region,
        countryCode: meta.countryCode,
        countryName: meta.countryName,
        role: mode === 'players' ? roleByPlayer.get(name) || '' : '',
        metricValue: Number.isFinite(metricValue) ? metricValue : null,
      })
    }
    return output
  }, [data, filtered, mode, roleByPlayer, statistic])

  const knownNames = useMemo(() => Object.keys(data?.meta || {}), [data])
  const featuredNames = useMemo(
    () => (mode === 'players' ? requestedPlayers : requestedTeams)
      .map((name) => canonicalName(name, knownNames))
      .filter((name, index, all) => name && all.indexOf(name) === index),
    [knownNames, mode, requestedPlayers, requestedTeams],
  )
  const featuredRows = featuredNames.map((name) => entityRows.find((row) => row.name === name)).filter(Boolean)
  const inferredRole = mode === 'players' ? featuredRows[0]?.role || '' : ''
  const effectiveRole = requestedRole || inferredRole

  const tableRows = useMemo(() => {
    if (mode !== 'players' || !effectiveRole) return entityRows
    return entityRows.filter((row) => row.role === effectiveRole)
  }, [effectiveRole, entityRows, mode])

  const matchRows = useMemo(() => {
    if (mode !== 'matches') return []
    return filtered
      .filter((row) => statistic.definition.matchLevel !== 'series' || row.fullyTimed)
      .map((row) => ({ ...row, metricValue: statistic.definition.compute(row) }))
      .filter((row) => Number.isFinite(row.metricValue))
  }, [filtered, mode, statistic])

  if (error) return <p role="alert">This analysis could not be loaded. Please refresh to try again.</p>
  if (loading || (mode === 'players' && agentLoading) || !data) return <div className="text-sm text-muted">Building analysis…</div>

  const requestedOrder = searchParams.get('order')
  const defaultSortDir = requestedOrder === 'asc' || requestedOrder === 'desc'
    ? requestedOrder
    : statistic?.definition.higherIsBetter === false ? 'asc' : 'desc'

  const playerColumns = [
    {
      key: 'name', label: 'Player', align: 'left',
      format: (value, row) => <div className="flex items-center gap-2"><Flag countryCode={row.countryCode} countryName={row.countryName} size={16} /><Link to={`/players/${encodeURIComponent(value)}`} className="font-medium hover:text-accent-bright">{value}</Link></div>,
    },
    { key: 'team', label: 'Team', align: 'left', format: (value) => <Link to={`/teams/${encodeURIComponent(value)}`}><TeamLogo team={value} size={22} showName={false} showTag /></Link> },
    { key: 'role', label: 'Role', align: 'left' },
    ...(activeStatistic?.entity === 'players' ? [{ key: 'metricValue', label: activeStatistic.definition.label, align: 'right', format: (value) => value == null ? '—' : activeStatistic.definition.format(value) }] : []),
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: num },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: num },
    { key: 'avgRating', label: 'Rating', align: 'right', format: rating },
    { key: 'avgAcs', label: 'ACS', align: 'right', format: (value) => num(value, 0) },
    { key: 'kd', label: 'K/D', align: 'right', format: (value) => value == null ? '—' : value.toFixed(2) },
    { key: 'avgKast', label: 'KAST', align: 'right', format: pct },
    { key: 'avgAdr', label: 'ADR', align: 'right', format: (value) => num(value, 1) },
  ]

  const teamColumns = [
    { key: 'name', label: 'Team', align: 'left', format: (value) => <Link to={`/teams/${encodeURIComponent(value)}`} className="flex items-center gap-2 font-medium hover:text-accent-bright"><TeamLogo team={value} size={24} showName={false} />{value}</Link> },
    { key: 'region', label: 'Region', align: 'left' },
    ...(activeStatistic?.entity === 'teams' ? [{ key: 'metricValue', label: activeStatistic.definition.label, align: 'right', format: (value) => value == null ? '—' : activeStatistic.definition.format(value) }] : []),
    { key: 'matchesPlayed', label: 'Matches', align: 'right', format: num },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: num },
    { key: 'matchWinPct', label: 'Match Win%', align: 'right', format: pct },
    { key: 'avgRating', label: 'Avg Rating', align: 'right', format: rating },
    { key: 'atkWinPct', label: 'ATK Win%', align: 'right', format: pct },
    { key: 'defWinPct', label: 'DEF Win%', align: 'right', format: pct },
  ]

  const matchColumns = [
    { key: 'matchup', label: 'Matchup', align: 'left', format: (_, row) => <div className="flex items-center gap-2"><TeamLogo team={row.team1} size={22} /><span className="text-xs text-muted">vs</span><TeamLogo team={row.team2} size={22} /></div> },
    { key: 'event', label: 'Event', align: 'left', format: eventLabel },
    { key: 'date', label: 'Date', align: 'left' },
    ...(statistic?.definition.matchLevel === 'map' ? [{ key: 'mapName', label: 'Map', align: 'left' }] : []),
    { key: 'metricValue', label: statistic?.definition.label || 'Value', align: 'right', format: (value) => statistic.definition.format(value) },
  ]

  const shownRows = mode === 'matches' ? matchRows : tableRows
  const tableTitle = mode === 'players'
    ? effectiveRole ? `${effectiveRole} players in this scope` : activeStatistic ? `${activeStatistic.searchLabel} in this scope` : 'Players in this scope'
    : mode === 'teams' ? activeStatistic ? `${activeStatistic.searchLabel} in this scope` : 'Teams in this scope'
    : statistic.searchLabel

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="data-link text-xs">← New search</Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Custom analysis</h1>
        <p className="mt-1 text-sm text-muted">The summary and comparison population below share one filter scope.</p>
      </div>

      <FilterPanel
        options={options} selections={selections} setFacet={setFacet} clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        summary={`${shownRows.length} ${mode === 'players' ? 'players' : mode === 'teams' ? 'teams' : statistic.definition.matchLevel === 'series' ? 'series' : 'maps'}`}
      />

      {featuredRows.map((row) => (
        <section key={row.name} className="rounded-md border border-hairline bg-surface p-5">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            {mode === 'players' ? <Flag countryCode={row.countryCode} countryName={row.countryName} size={24} /> : <TeamLogo team={row.name} size={34} showName={false} />}
            <div>
              <h2 className="text-lg font-semibold text-ink"><Link to={`/${mode}/${encodeURIComponent(row.name)}`} className="hover:text-accent-bright">{row.name}</Link></h2>
              <p className="text-xs text-muted">{mode === 'players' ? `${row.team}${row.role ? ` · ${row.role}` : ''}` : row.region}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            {activeStatistic && !activeStatistic.definition.matchLevel && <SummaryMetric label={activeStatistic.definition.label} value={row.metricValue} format={activeStatistic.definition.format} />}
            {mode === 'players' ? <>
              <SummaryMetric label="Rating" value={row.avgRating} format={rating} />
              <SummaryMetric label="ACS" value={row.avgAcs} format={(value) => num(value, 0)} />
              <SummaryMetric label="K/D" value={row.kd} format={(value) => value.toFixed(2)} />
              <SummaryMetric label="KAST" value={row.avgKast} format={pct} />
              <SummaryMetric label="ADR" value={row.avgAdr} format={(value) => num(value, 1)} />
            </> : <>
              <SummaryMetric label="Match win" value={row.matchWinPct} format={pct} />
              <SummaryMetric label="Map win" value={row.mapWinPct} format={pct} />
              <SummaryMetric label="Avg rating" value={row.avgRating} format={rating} />
              <SummaryMetric label="ATK win" value={row.atkWinPct} format={pct} />
              <SummaryMetric label="DEF win" value={row.defWinPct} format={pct} />
            </>}
          </div>
          <p className="mt-4 text-xs text-muted">{num(row.mapsPlayed)} maps · {num(row.roundsPlayed)} rounds in the active scope</p>
        </section>
      ))}

      {((mode === 'players' ? requestedPlayers.length : mode === 'teams' ? requestedTeams.length : 0) > featuredRows.length) && (
        <p className="text-sm text-muted">One or more requested names had no data in this scope.</p>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{tableTitle}</h2>
          {effectiveRole && inferredRole && !requestedRole && <p className="mt-1 text-xs text-muted">Peer role inferred from {featuredRows[0]?.name}'s agent usage within these filters.</p>}
        </div>
        <DataTable
          columns={mode === 'players' ? playerColumns : mode === 'teams' ? teamColumns : matchColumns}
          rows={shownRows}
          defaultSortKey={activeStatistic ? 'metricValue' : mode === 'players' ? 'avgRating' : mode === 'teams' ? 'matchWinPct' : 'metricValue'}
          defaultSortDir={defaultSortDir}
          expandKey={(row) => mode === 'matches' ? row.id : row.name}
        />
      </section>
    </div>
  )
}

export default function Analysis() {
  const { search } = useLocation()
  // The faceted hook intentionally treats URL state as initial state. Keying
  // this inner page makes a new compiled query a genuinely fresh analysis.
  return <AnalysisRoute key={search} />
}
