import { useMemo } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
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
import { teamTierExtras } from '../lib/statDefs'
import { getStatistic } from '../lib/statCatalog'
import DataTable from '../components/DataTable'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import Flag from '../components/Flag'
import TeamLogo from '../components/TeamLogo'
import { eventLabel, num } from '../lib/format'

function safeSecondary(definition, aggregate) {
  const secondary = definition.secondary?.(aggregate)
  if (!secondary || secondary.value == null) return { value: null, label: '' }
  return secondary
}

function withSecondary(row, definition, aggregate) {
  const sample = safeSecondary(definition, aggregate)
  return { ...row, sampleValue: sample.value, sampleLabel: sample.label }
}

export default function Statistic() {
  const { entity, stat: statSlug } = useParams()
  const { search } = useLocation()
  return <StatisticPage key={`${entity}/${statSlug}${search}`} entity={entity} statSlug={statSlug} />
}

function StatisticPage({ entity, statSlug }) {
  const [searchParams] = useSearchParams()
  const statistic = getStatistic(entity, statSlug)
  const definition = statistic?.definition
  const isPlayer = entity === 'players'
  const isMatchLevel = !!definition?.matchLevel
  const dataName = isMatchLevel
    ? definition.matchLevel === 'series' ? 'series_length' : 'map_length'
    : isPlayer ? 'player_buckets' : statistic ? 'team_buckets' : null

  const { data, loading, error } = useData(dataName)
  const idle = useIdle()
  const { data: agentData } = useData(idle && isPlayer ? 'player_agents' : null)

  const rawRecords = useMemo(() => {
    if (!data || !statistic) return []
    if (definition.matchLevel === 'series') return expandSeriesRows(data)
    if (definition.matchLevel === 'map') return expandMapLengthRows(data)
    return expandBuckets(data, isPlayer ? 'p' : 't')
  }, [data, definition?.matchLevel, isPlayer, statistic])

  const dayGroups = useMemo(
    () => (isPlayer && agentData ? buildPlayerDayGroups(agentData.buckets) : new Map()),
    [agentData, isPlayer],
  )
  const records = useMemo(
    () => (isPlayer ? attachDateSpans(rawRecords, dayGroups) : rawRecords),
    [dayGroups, isPlayer, rawRecords],
  )

  const {
    selections, setFacet, clearAll, filtered, options, activeCount,
    dateRange, setDateRange, dateBounds,
    includeHiddenEvents, setIncludeHiddenEvents,
  } = useFacetedFilter(records, FACETS, { competition: ['VCT'], year: [2026] })

  const rows = useMemo(() => {
    if (!data || !statistic) return []

    if (definition.matchLevel) {
      return filtered
        .filter((row) => definition.matchLevel !== 'series' || row.fullyTimed)
        .map((row) => withSecondary({
          ...row,
          value: definition.compute(row),
        }, definition, row))
        .filter((row) => Number.isFinite(row.value))
    }

    const output = []
    for (const [name, buckets] of groupByEntity(filtered)) {
      const aggregate = isPlayer
        ? aggregatePlayerBuckets(buckets)
        : { ...aggregateTeamBuckets(buckets), ...teamTierExtras(buckets) }
      if (!aggregate?.mapsPlayed) continue
      const value = definition.compute(aggregate)
      if (!Number.isFinite(value)) continue
      const meta = data.meta?.[name] || {}
      output.push(withSecondary({
        ...aggregate,
        name,
        value,
        team: isPlayer ? teamInScope(buckets, meta.team) : name,
        region: meta.region,
        countryCode: meta.countryCode,
        countryName: meta.countryName,
      }, definition, aggregate))
    }
    return output
  }, [data, definition, filtered, isPlayer, statistic])

  if (!statistic) {
    return (
      <div className="py-12">
        <h1 className="font-display text-2xl font-semibold text-ink">Statistic not found</h1>
        <Link className="data-link mt-3 inline-block" to="/">Search for another statistic</Link>
      </div>
    )
  }
  if (error) return <p role="alert">This statistic could not be loaded. Please refresh to try again.</p>
  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  const requestedOrder = searchParams.get('order')
  const defaultSortDir = requestedOrder === 'asc' || requestedOrder === 'desc'
    ? requestedOrder
    : definition.higherIsBetter === false ? 'asc' : 'desc'
  const sourcePath = isPlayer ? '/players' : definition.matchLevel ? '/records' : '/teams'
  const sourceLabel = isPlayer ? 'All player statistics' : definition.matchLevel ? 'All records' : 'All team statistics'
  const title = statistic.searchLabel

  const identityColumns = definition.matchLevel
    ? [
        {
          key: 'matchup', label: 'Matchup', align: 'left',
          format: (_, row) => (
            <div className="flex items-center gap-2">
              <Link to={`/teams/${encodeURIComponent(row.team1)}`}><TeamLogo team={row.team1} size={22} /></Link>
              <span className="text-muted text-xs">vs</span>
              <Link to={`/teams/${encodeURIComponent(row.team2)}`}><TeamLogo team={row.team2} size={22} /></Link>
            </div>
          ),
        },
        { key: 'event', label: 'Event', align: 'left', format: (value) => eventLabel(value) },
        { key: 'date', label: 'Date', align: 'left' },
        ...(definition.matchLevel === 'map' ? [{ key: 'mapName', label: 'Map', align: 'left' }] : []),
      ]
    : [
        {
          key: 'name', label: isPlayer ? 'Player' : 'Team', align: 'left',
          format: (value, row) => (
            <div className="flex items-center gap-2">
              {isPlayer
                ? <Flag countryCode={row.countryCode} countryName={row.countryName} size={16} />
                : <TeamLogo team={value} size={24} showName={false} />}
              <Link
                to={`/${isPlayer ? 'players' : 'teams'}/${encodeURIComponent(value)}`}
                className="font-medium hover:text-accent-bright transition-colors"
              >
                {value}
              </Link>
            </div>
          ),
        },
        ...(isPlayer ? [{
          key: 'team', label: 'Team', align: 'left',
          format: (value) => (
            <Link to={`/teams/${encodeURIComponent(value)}`}>
              <TeamLogo team={value} size={22} showName={false} showTag />
            </Link>
          ),
        }] : [{ key: 'region', label: 'Region', align: 'left' }]),
      ]

  const columns = [
    ...identityColumns,
    {
      key: 'value', label: definition.label, align: 'right',
      format: (value) => definition.format(value),
    },
    ...(!(definition.matchLevel === 'map') ? [{
      key: 'sampleValue', label: 'Sample', align: 'right',
      format: (sample, row) => sample == null
        ? '—'
        : `${typeof sample === 'number' ? num(sample) : sample}${row.sampleLabel ? ` ${row.sampleLabel}` : ''}`,
    }] : []),
    ...(!definition.matchLevel ? [
      ...(definition.key !== 'mapsPlayed' ? [{ key: 'mapsPlayed', label: 'Maps', align: 'right', format: (value) => num(value) }] : []),
      ...(definition.key !== 'roundsPlayed' ? [{ key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (value) => num(value) }] : []),
    ] : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to={sourcePath} className="data-link text-xs">← {sourceLabel}</Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-muted">{statistic.description}. Select any column heading to reorder the full leaderboard.</p>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        summary={`${rows.length} ${definition.matchLevel ? (definition.matchLevel === 'series' ? 'series' : 'maps') : isPlayer ? 'players' : 'teams'}`}
      />

      {definition.matchLevel === 'series' && (
        <p className="text-xs text-muted">Only series with a published duration for every map are included.</p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        defaultSortKey="value"
        defaultSortDir={defaultSortDir}
        expandKey={(row) => definition.matchLevel ? row.id : row.name}
      />
    </div>
  )
}
