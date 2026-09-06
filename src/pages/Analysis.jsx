import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useData, prefetchData } from '../lib/useData'
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
import { STAT_CATALOG, getStatisticById } from '../lib/statCatalog'
import { STAT_LIBRARY_ENTRIES, STAT_LIBRARY_GROUPS } from '../lib/statLibrary'
import { teamTierExtras } from '../lib/statDefs'
import { editDistance, findEventNames, fuzzyStatisticScore, isRosterHistoryQuery, isTeamProfileQuery, normalizeQuery, parseResultLimit, parseResultOrder, parseTimeframe, teamProfileTabFromQuery, withScope } from '../lib/startQuery'
import { intentToPath, sanitizeIntents } from '../lib/intentContract'
import DataTable, { DataTableStickyHeaderContext } from '../components/DataTable'
import { FACETS } from '../components/FilterPanel'
import Flag from '../components/Flag'
import TeamLogo from '../components/TeamLogo'
import { eventLabel, num, pct, rating } from '../lib/format'
import { rankRows } from '../lib/rankRows'
import { resizeCardGeometry } from '../lib/cardGeometry'
import { headCoachesForTeam } from '../lib/coaches'
import RosterTimeline from '../components/RosterTimeline'

const TeamProfile = lazy(() => import('./TeamProfile'))

const ROLE_NAMES = ['Duelist', 'Initiator', 'Controller', 'Sentinel']
const CONTEXT_WORDS = /\b(?:also|and|same|again|his|her|their|that|those|what about)\b/i
const SUBJECT_WORDS = /\b(?:players?|teams?|duelists?|initiators?|controllers?|sentinels?)\b/i
const TABLE_REQUEST_WORDS = /\b(?:all|table|leaderboard|leaders|ranking|rankings|ranked|list|players|teams|duelists|initiators|controllers|sentinels|peers)\b/i
const ENTITY_STOPWORDS = new Set([
  'also', 'and', 'another', 'best', 'bottom', 'for', 'from', 'give', 'highest', 'in', 'lowest', 'me', 'more', 'of',
  'on', 'player', 'players', 'show', 'stage', 'stat', 'stats', 'statistics', 'team',
  'teams', 'the', 'to', 'top', 'with', 'worst',
])
let nextCardId = 1

function isLibraryLaunch(search) {
  const params = new URLSearchParams(search)
  return params.size === 1 && params.get('library') === '1'
}

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

function mentionedEntity(names, query) {
  const text = normalizeQuery(query)
  const exact = names
    .map((name) => ({ name, value: normalizeQuery(name) }))
    .filter(({ value }) => value.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu').test(text))
    .sort((a, b) => text.indexOf(a.value) - text.indexOf(b.value) || b.value.length - a.value.length)[0]
  if (exact) return exact.name

  const words = text.split(' ').filter((word) => word.length > 1 && !/^\d+$/.test(word) && !ENTITY_STOPWORDS.has(word))
  return names
    .map((name) => {
      const candidate = normalizeQuery(name)
      const wordCount = candidate.split(' ').length
      let distance = Infinity
      for (let index = 0; index <= words.length - wordCount; index++) {
        const window = words.slice(index, index + wordCount).join(' ')
        if (Math.abs(window.length - candidate.length) <= 1) distance = Math.min(distance, editDistance(window, candidate))
      }
      const allowance = candidate.length <= 5 ? 1 : candidate.length <= 10 ? 2 : 3
      return distance <= allowance ? { name, distance } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance || a.name.length - b.name.length)[0]?.name || ''
}

function statisticInQuery(query) {
  return STAT_CATALOG
    .map((statistic) => ({
      statistic,
      score: Math.min(...statistic.keywords.map((keyword) => fuzzyStatisticScore(query, keyword))),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.statistic.searchLabel.localeCompare(b.statistic.searchLabel))[0]?.statistic || null
}

function roleInQuery(query) {
  const text = normalizeQuery(query)
  return ROLE_NAMES.find((role) => new RegExp(`\\b${role.toLowerCase()}s?\\b`).test(text)) || ''
}

function localAnalysisPath(query, players, teams, events) {
  const scope = parseTimeframe(query)
  if (isRosterHistoryQuery(query)) {
    const team = mentionedEntity(teams, query)
    if (team) return withScope(`/analysis?view=roster-history&team=${encodeURIComponent(team)}&population=teams`, scope)
  }
  const profileTeam = mentionedEntity(teams, query)
  const profileStatistic = statisticInQuery(query)
  const comparesEntities = /\b(?:compare|versus|vs|against|head to head)\b/i.test(query)
  const asksForPopulation = /\b(?:all|table|leaderboard|leaders|ranking|rankings|ranked|list|peers)\b/i.test(query) || parseResultLimit(query) > 0
  if (profileTeam && !comparesEntities && !asksForPopulation && (isTeamProfileQuery(query) || !profileStatistic)) {
    const teamTab = teamProfileTabFromQuery(query) || 'overview'
    return withScope(`/analysis?view=team-profile&teamTab=${teamTab}&team=${encodeURIComponent(profileTeam)}&population=teams`, scope)
  }
  const player = mentionedEntity(players, query)
  const team = player ? '' : profileTeam
  const event = findEventNames(events, query, 1)[0]?.name || ''
  const role = roleInQuery(query)
  const statistic = statisticInQuery(query)
  if (!player && !team && !event && !role && !statistic && !scope.hasScope) return null

  const params = new URLSearchParams()
  if (player) params.append('player', player)
  if (team) params.append('team', team)
  if (event) params.set('event', event)
  if (role) params.set('role', role)
  if (statistic) params.set('metric', statistic.id)
  const order = parseResultOrder(query, statistic?.definition.higherIsBetter !== false)
  if (order) params.set('order', order)
  const population = team || event || (!player && !role && statistic?.entity === 'teams') ? 'teams' : 'players'
  params.set('population', population)
  const wantsTable = TABLE_REQUEST_WORDS.test(query)
  const limit = parseResultLimit(query)
  if (wantsTable || limit || (!player && !team)) params.set('table', '1')
  if (limit) params.set('limit', String(limit))
  return withScope(`/analysis?${params}`, scope)
}

function mergeExplicitScope(intent, scope) {
  const filters = { ...intent.filters }
  const add = (key, value) => {
    if (value == null || value === '') return
    filters[key] = [...new Set([...(filters[key] || []), value])]
  }
  add('years', scope.params.year)
  add('competitions', scope.params.competition)
  add('regions', scope.params.region)
  add('splits', scope.params.split)
  if (scope.params.from) filters.from = scope.params.from
  if (scope.params.to) filters.to = scope.params.to
  return { ...intent, filters }
}

function mergeExplicitRequest(intent, query) {
  const limit = parseResultLimit(query)
  const statistic = getStatisticById(intent.stat)
  const order = parseResultOrder(query, statistic?.definition.higherIsBetter !== false)
  const usesNaturalBestOrder = /\b(?:top|best)\b/.test(normalizeQuery(query))
  return {
    ...intent,
    ...(limit ? { includeTable: true, limit } : {}),
    ...(order || usesNaturalBestOrder ? { order } : {}),
  }
}

async function requestLlmIntents(query, signal) {
  if (import.meta.env.DEV) throw new Error('Workers AI is unavailable in Vite dev')
  const response = await fetch('/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Intent service unavailable')
  const payload = await response.json()
  const intents = sanitizeIntents(payload)
  if (!intents.length) throw new Error('Invalid intent plan')
  return intents
}

function contextualizeSearch(nextSearch, previousSearch, query) {
  if (!previousSearch || !CONTEXT_WORDS.test(query)) return nextSearch
  const next = new URLSearchParams(nextSearch)
  const previous = new URLSearchParams(previousSearch)
  const hasNewSubject = next.has('player') || next.has('team') || SUBJECT_WORDS.test(query)

  if (!hasNewSubject) {
    for (const key of ['player', 'team']) {
      if (!next.has(key)) previous.getAll(key).forEach((value) => next.append(key, value))
    }
  }
  for (const key of ['view', 'teamTab', 'population', 'metric', 'order', 'table', 'limit', 'year', 'competition', 'region', 'split', 'event', 'eventPhase', 'eventWeek', 'from', 'to']) {
    if (key === 'limit' && /\ball\b/i.test(query)) continue
    if (!next.has(key) && previous.has(key)) previous.getAll(key).forEach((value) => next.append(key, value))
  }
  return `?${next}`
}

function scopeParts(search) {
  const params = new URLSearchParams(search)
  return ['year', 'competition', 'region', 'split', 'event']
    .flatMap((key) => params.getAll(key).flatMap((value) => value.split(',')))
    .filter(Boolean)
}

function describeSearch(search) {
  const params = new URLSearchParams(search)
  if (params.get('view') === 'roster-history') {
    return `${params.getAll('team')[0] || 'Team'} roster history`
  }
  if (params.get('view') === 'team-profile') {
    const tab = params.get('teamTab')
    const suffix = { matches: 'match history', maps: 'map statistics', agents: 'compositions', roster: 'roster' }[tab] || 'team profile'
    return `${params.getAll('team')[0] || 'Team'} ${suffix}`
  }
  const subject = params.getAll('player')[0]
    || params.getAll('team')[0]
    || params.get('role')
    || getStatisticById(params.get('metric'))?.searchLabel
    || (params.get('population') === 'teams' ? 'Team analysis' : 'Player analysis')
  const scope = scopeParts(search)
  return scope.length ? `${subject} · ${scope.join(' · ')}` : subject
}

function SummaryMetric({ label, value, format = (entry) => entry }) {
  return (
    <div className="analysis-summary-metric">
      <p>{label}</p>
      <strong>{value == null ? '—' : format(value)}</strong>
    </div>
  )
}

function AnalysisResult({ search }) {
  const params = useMemo(() => new URLSearchParams(search), [search])
  const requestedPlayers = params.getAll('player').filter(Boolean)
  const requestedTeams = params.getAll('team').filter(Boolean)
  const requestedRole = ROLE_NAMES.includes(params.get('role')) ? params.get('role') : ''
  const requestedPopulation = ['players', 'teams'].includes(params.get('population')) ? params.get('population') : ''
  const parsedLimit = Number(params.get('limit'))
  const requestedLimit = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 1000 ? parsedLimit : 0
  const statistic = getStatisticById(params.get('metric'))
  const showTable = params.get('table') === '1' || !!statistic?.definition.matchLevel || (!requestedPlayers.length && !requestedTeams.length)
  const hasPlayerQuestion = requestedPlayers.length > 0 || !!requestedRole
  const mode = statistic?.definition.matchLevel && !hasPlayerQuestion
    ? 'matches'
    : hasPlayerQuestion
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
  const { data: agentData, loading: agentLoading } = useData(mode === 'players' ? 'player_agents' : null)

  const rawRecords = useMemo(() => {
    if (!data) return []
    if (mode === 'matches') return statistic.definition.matchLevel === 'series' ? expandSeriesRows(data) : expandMapLengthRows(data)
    return expandBuckets(data, mode === 'players' ? 'p' : 't')
  }, [data, mode, statistic])
  const dayGroups = useMemo(() => (mode === 'players' && agentData ? buildPlayerDayGroups(agentData.buckets) : new Map()), [agentData, mode])
  const records = useMemo(() => (mode === 'players' ? attachDateSpans(rawRecords, dayGroups) : rawRecords), [dayGroups, mode, rawRecords])
  const filters = useFacetedFilter(records, FACETS, params.has('event') ? {} : { competition: ['VCT'], year: [2026] }, search)

  const scopedAgentRecords = useMemo(() => {
    if (mode !== 'players' || !agentData) return []
    return expandBuckets(agentData, 'p').filter((record) => matchesFilters(record, FACETS, filters.selections, filters.dateRange, filters.includeHiddenEvents))
  }, [agentData, filters.dateRange, filters.includeHiddenEvents, filters.selections, mode])
  const roleByPlayer = useMemo(() => rolesInScope(scopedAgentRecords), [scopedAgentRecords])

  const entityRows = useMemo(() => {
    if (!data || mode === 'matches') return []
    const output = []
    for (const [name, buckets] of groupByEntity(filters.filtered)) {
      const aggregate = mode === 'players' ? aggregatePlayerBuckets(buckets) : { ...aggregateTeamBuckets(buckets), ...teamTierExtras(buckets) }
      if (!aggregate?.mapsPlayed) continue
      const meta = data.meta?.[name] || {}
      const metricValue = statistic && statistic.entity === mode && !statistic.definition.matchLevel ? statistic.definition.compute(aggregate) : null
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
  }, [data, filters.filtered, mode, roleByPlayer, statistic])

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
  const tableRows = useMemo(() => (mode === 'players' && effectiveRole ? entityRows.filter((row) => row.role === effectiveRole) : entityRows), [effectiveRole, entityRows, mode])
  const matchRows = useMemo(() => {
    if (mode !== 'matches') return []
    const matchTeamNames = [...new Set(filters.filtered.flatMap((row) => [row.team1, row.team2]).filter(Boolean))]
    const requestedMatchTeams = new Set(requestedTeams.map((name) => canonicalName(name, matchTeamNames)).filter(Boolean))
    return filters.filtered
      .filter((row) => statistic.definition.matchLevel !== 'series' || row.fullyTimed)
      .filter((row) => !requestedMatchTeams.size || requestedMatchTeams.has(row.team1) || requestedMatchTeams.has(row.team2))
      .map((row) => ({ ...row, metricValue: statistic.definition.compute(row) }))
      .filter((row) => Number.isFinite(row.metricValue))
  }, [filters.filtered, mode, requestedTeams, statistic])

  if (error) return <p role="alert" className="analysis-card-state">This analysis could not be loaded. Please try again.</p>
  if (loading || (mode === 'players' && agentLoading) || !data) return <p role="status" className="analysis-card-state">Building analysis…</p>
  if (params.has('event') && filters.filtered.length === 0) {
    return <p role="status" className="analysis-card-state">No statistics are available for {params.get('event')} in this scope.</p>
  }

  const requestedOrder = params.get('order')
  const defaultSortDir = requestedOrder === 'asc' || requestedOrder === 'desc' ? requestedOrder : statistic?.definition.higherIsBetter === false ? 'asc' : 'desc'
  const playerIdentityColumns = [
    { key: 'name', label: 'Player', align: 'left', format: (value, row) => <div className="flex items-center gap-2"><Flag countryCode={row.countryCode} countryName={row.countryName} size={16} /><span className="font-medium">{value}</span></div> },
    { key: 'team', label: 'Team', align: 'left', format: (value) => <TeamLogo team={value} size={22} showName={false} showTag /> },
    { key: 'role', label: 'Role', align: 'left' },
  ]
  const playerSampleColumns = [
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: num },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: num },
  ]
  const playerColumns = activeStatistic?.entity === 'players'
    ? [...playerIdentityColumns, { key: 'metricValue', label: activeStatistic.definition.label, align: 'right', format: (value) => value == null ? '—' : activeStatistic.definition.format(value) }, ...playerSampleColumns]
    : [...playerIdentityColumns, ...playerSampleColumns,
    { key: 'avgRating', label: 'Rating', align: 'right', format: rating },
    { key: 'avgAcs', label: 'ACS', align: 'right', format: (value) => num(value, 0) },
    { key: 'kd', label: 'K/D', align: 'right', format: (value) => value == null ? '—' : value.toFixed(2) },
    { key: 'avgKast', label: 'KAST', align: 'right', format: pct },
    { key: 'avgAdr', label: 'ADR', align: 'right', format: (value) => num(value, 1) },
  ]
  const teamIdentityColumns = [
    { key: 'name', label: 'Team', align: 'left', format: (value) => <div className="flex items-center gap-2 font-medium"><TeamLogo team={value} size={24} showName={false} />{value}</div> },
    { key: 'region', label: 'Region', align: 'left' },
  ]
  const teamSampleColumns = [
    { key: 'matchesPlayed', label: 'Matches', align: 'right', format: num },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: num },
  ]
  const teamColumns = activeStatistic?.entity === 'teams'
    ? [...teamIdentityColumns, { key: 'metricValue', label: activeStatistic.definition.label, align: 'right', format: (value) => value == null ? '—' : activeStatistic.definition.format(value) }, ...teamSampleColumns]
    : [...teamIdentityColumns, ...teamSampleColumns,
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
  const allShownRows = mode === 'matches' ? matchRows : tableRows
  const defaultSortKey = activeStatistic ? 'metricValue' : mode === 'players' ? 'avgRating' : mode === 'teams' ? 'matchWinPct' : 'metricValue'
  const shownRows = rankRows(allShownRows, defaultSortKey, defaultSortDir, requestedLimit)
  return (
    <div className="analysis-result">
      {featuredRows.map((row) => (
        <section key={row.name} className="analysis-featured">
          <div className="analysis-featured-person">
            {mode === 'players' ? <Flag countryCode={row.countryCode} countryName={row.countryName} size={24} /> : <TeamLogo team={row.name} size={34} showName={false} />}
            <div>
              <h3>{row.name}</h3>
              <p>{mode === 'players' ? `${row.team}${row.role ? ` · ${row.role}` : ''}` : row.region}</p>
            </div>
          </div>
          <div className="analysis-summary-grid">
            {activeStatistic && !activeStatistic.definition.matchLevel
              ? <SummaryMetric label={activeStatistic.definition.label} value={row.metricValue} format={activeStatistic.definition.format} />
              : mode === 'players' ? <>
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
          <p className="analysis-sample">{num(row.mapsPlayed)} maps · {num(row.roundsPlayed)} rounds in scope</p>
        </section>
      ))}

      {((mode === 'players' ? requestedPlayers.length : mode === 'teams' ? requestedTeams.length : 0) > featuredRows.length) && <p className="analysis-card-state">One or more requested names had no data in this scope.</p>}

      {showTable && <section className={`analysis-table-section${featuredRows.length ? '' : ' is-only-table'}`}>
        <DataTable
          columns={mode === 'players' ? playerColumns : mode === 'teams' ? teamColumns : matchColumns}
          rows={shownRows}
          defaultSortKey={defaultSortKey}
          defaultSortDir={defaultSortDir}
          expandKey={(row) => mode === 'matches' ? row.id : row.name}
          stickyHeader={false}
        />
      </section>}
    </div>
  )
}

function RosterHistoryResult({ search }) {
  const params = useMemo(() => new URLSearchParams(search), [search])
  const requestedTeam = params.getAll('team')[0] || ''
  const { data: teamData, loading: teamsLoading, error: teamsError } = useData('team_buckets')
  const { data: playerData, loading: playersLoading, error: playersError } = useData('player_buckets')
  const { data: matchData, loading: matchesLoading, error: matchesError } = useData('match_results')
  const { data: matchPlayerData } = useData('match_players')
  const { data: liquipediaData } = useData('liquipedia_rosters')
  const team = useMemo(
    () => canonicalName(requestedTeam, Object.keys(teamData?.meta || {})),
    [requestedTeam, teamData],
  )
  const headCoaches = useMemo(
    () => headCoachesForTeam(liquipediaData, team),
    [liquipediaData, team],
  )

  if (teamsError || playersError || matchesError) {
    return <p role="alert" className="analysis-card-state">This roster history could not be loaded. Please try again.</p>
  }
  if (teamsLoading || playersLoading || matchesLoading || !teamData || !playerData || !matchData) {
    return <p role="status" className="analysis-card-state">Building roster history…</p>
  }
  if (!requestedTeam || !team) {
    return <p role="status" className="analysis-card-state">Choose a known team to show its roster history.</p>
  }

  return (
    <div className="analysis-result">
      <RosterTimeline
        playerBuckets={playerData}
        team={team}
        matchResultsRows={matchData.rows || []}
        matchPlayersRows={matchPlayerData?.rows || []}
        headCoaches={headCoaches}
      />
    </div>
  )
}

function TeamProfileResult({ search }) {
  const params = useMemo(() => new URLSearchParams(search), [search])
  const requestedTeam = params.getAll('team')[0] || ''
  const { data: teamData, loading, error } = useData('team_buckets')
  const team = useMemo(
    () => canonicalName(requestedTeam, Object.keys(teamData?.meta || {})),
    [requestedTeam, teamData],
  )

  if (error) return <p role="alert" className="analysis-card-state">This team profile could not be loaded. Please try again.</p>
  if (loading || !teamData) return <p role="status" className="analysis-card-state">Building team profile…</p>
  if (!requestedTeam || !team) return <p role="status" className="analysis-card-state">Choose a known team to show its profile.</p>

  return (
    <div className="analysis-result analysis-team-profile">
      <Suspense fallback={<p role="status" className="analysis-card-state">Building team profile…</p>}>
        <DataTableStickyHeaderContext.Provider value={false}>
          <TeamProfile team={team} initialTab={params.get('teamTab') || 'overview'} />
        </DataTableStickyHeaderContext.Provider>
      </Suspense>
    </div>
  )
}

function RoutedAnalysisResult({ search }) {
  const view = new URLSearchParams(search).get('view')
  if (view === 'roster-history') return <RosterHistoryResult search={search} />
  if (view === 'team-profile') return <TeamProfileResult search={search} />
  return <AnalysisResult search={search} />
}

const MemoizedAnalysisResult = memo(RoutedAnalysisResult)

function cardShowsTable(search) {
  const params = new URLSearchParams(search)
  return ['roster-history', 'team-profile'].includes(params.get('view')) || params.get('table') === '1' || (!params.has('player') && !params.has('team'))
}

function initialPosition(index, width) {
  const viewport = typeof window === 'undefined' ? 1200 : window.innerWidth
  const renderedWidth = Math.min(width, viewport - 48)
  const centered = Math.max(16, (viewport - renderedWidth) / 2)
  const maxX = Math.max(16, viewport - renderedWidth - 16)
  return { x: Math.min(centered + (index % 4) * 28, maxX), y: 72 + (index % 4) * 28, z: index + 1 }
}

function createCard(search, prompt, index) {
  const normalizedSearch = search.startsWith('?') ? search : `?${search}`
  const table = cardShowsTable(normalizedSearch)
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
  const width = Math.min(table ? 900 : 620, Math.max(320, viewportWidth - 48))
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const height = table
    ? Math.min(560, Math.max(360, viewportHeight - 240))
    : Math.min(300, Math.max(220, viewportHeight - 240))
  return { id: nextCardId++, search: normalizedSearch, prompt, width, height, ...initialPosition(index, width) }
}

const CanvasCard = memo(function CanvasCard({ card, onMove, onResize, onFocus, onClose }) {
  const cardRef = useRef(null)
  const dragRef = useRef(null)
  const resizeRef = useRef(null)

  function moveTo(x, y) {
    const width = cardRef.current?.offsetWidth || 900
    const maxX = Math.max(16, window.innerWidth - Math.min(width, window.innerWidth - 32) - 16)
    onMove(card.id, Math.min(Math.max(16, x), maxX), Math.max(56, y))
  }

  function startDrag(event) {
    if (event.button !== 0) return
    onFocus(card.id)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: card.x, y: card.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function drag(event) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    moveTo(dragRef.current.x + event.clientX - dragRef.current.startX, dragRef.current.y + event.clientY - dragRef.current.startY)
  }

  function stopDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  function moveWithKeyboard(event) {
    const delta = event.shiftKey ? 50 : 16
    const directions = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
    if (!directions[event.key]) return
    event.preventDefault()
    moveTo(card.x + directions[event.key][0], card.y + directions[event.key][1])
  }

  function resizeConstraints() {
    const table = cardShowsTable(card.search)
    return { minWidth: table ? 480 : 360, minHeight: table ? 280 : 190 }
  }

  function startResize(event, edge) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onFocus(card.id)
    resizeRef.current = {
      pointerId: event.pointerId,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      x: card.x,
      y: card.y,
      width: cardRef.current?.offsetWidth || card.width,
      height: cardRef.current?.offsetHeight || card.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resize(event) {
    const active = resizeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    const next = resizeCardGeometry(
      active,
      active.edge,
      event.clientX - active.startX,
      event.clientY - active.startY,
      resizeConstraints(),
      window.innerWidth,
    )
    onResize(card.id, next)
  }

  function stopResize(event) {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null
  }

  function resizeWithKeyboard(event, edge) {
    const step = event.shiftKey ? 64 : 24
    const horizontal = edge.includes('w') || edge.includes('e')
    const vertical = edge.includes('n') || edge.includes('s')
    const deltas = {
      ArrowLeft: horizontal ? [-step, 0] : null,
      ArrowRight: horizontal ? [step, 0] : null,
      ArrowUp: vertical ? [0, -step] : null,
      ArrowDown: vertical ? [0, step] : null,
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const next = resizeCardGeometry(card, edge, delta[0], delta[1], resizeConstraints(), window.innerWidth)
    onResize(card.id, next)
  }

  function resizeHandle(edge, className, dimension) {
    return (
      <button
        type="button"
        className={`analysis-resize-handle ${className}`}
        aria-label={`Resize ${describeSearch(card.search)} card ${dimension}. Drag with the pointer or use arrow keys. Current size ${Math.round(card.width)} by ${Math.round(card.height)} pixels.`}
        onPointerDown={(event) => startResize(event, edge)}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={(event) => resizeWithKeyboard(event, edge)}
      />
    )
  }

  return (
    <article ref={cardRef} className={`analysis-window${cardShowsTable(card.search) ? '' : ' is-compact'}`} style={{ '--card-x': `${card.x}px`, '--card-y': `${card.y}px`, '--card-width': `${card.width}px`, '--card-height': `${card.height}px`, zIndex: card.z }} onPointerDown={() => onFocus(card.id)}>
      <header className="analysis-window-bar">
        <button
          type="button"
          className="analysis-drag-handle"
          aria-label={`Move ${describeSearch(card.search)} card. Use arrow keys to move.`}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onKeyDown={moveWithKeyboard}
        >
          <span aria-hidden="true" className="analysis-grip"><i /><i /><i /><i /><i /><i /></span>
          <span>{card.prompt || describeSearch(card.search)}</span>
        </button>
        <button type="button" className="analysis-window-close" onClick={() => onClose(card.id)} aria-label={`Close ${describeSearch(card.search)} card`}>×</button>
      </header>
      <div className="analysis-window-body"><MemoizedAnalysisResult search={card.search} /></div>
      {resizeHandle('w', 'is-left', 'from the left edge')}
      {resizeHandle('e', 'is-right', 'from the right edge')}
      {resizeHandle('n', 'is-top', 'from the top edge')}
      {resizeHandle('s', 'is-bottom', 'from the bottom edge')}
      {resizeHandle('nw', 'is-top-left', 'from the top-left corner')}
      {resizeHandle('ne', 'is-top-right', 'from the top-right corner')}
      {resizeHandle('sw', 'is-bottom-left', 'from the bottom-left corner')}
      {resizeHandle('se', 'is-bottom-right', 'from the bottom-right corner')}
    </article>
  )
})

function submitIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" /></svg>
}

function libraryIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3.5 4.25h5.25A1.25 1.25 0 0 1 10 5.5v10.25a2 2 0 0 0-2-2H3.5V4.25Z" />
      <path d="M16.5 4.25h-5.25A1.25 1.25 0 0 0 10 5.5v10.25a2 2 0 0 1 2-2h4.5V4.25Z" />
    </svg>
  )
}

function miniatureSubject(statistic) {
  if (statistic.matchLevel) return statistic.matchLevel === 'series' ? 'Matchup' : 'Map'
  return statistic.entity === 'players' ? 'Player' : 'Team'
}

const StatisticLibrary = memo(function StatisticLibrary({ onAdd, onClose, onDragState, onPointerDrop }) {
  const [activeGroup, setActiveGroup] = useState('all')
  const pointerDragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const visibleGroups = activeGroup === 'all'
    ? STAT_LIBRARY_GROUPS
    : STAT_LIBRARY_GROUPS.filter((group) => group.id === activeGroup)

  return (
    <aside id="analysis-card-library" className="analysis-library-panel" aria-labelledby="analysis-library-title">
      <header className="analysis-library-header">
        <div>
          <span>Drag a window onto the canvas</span>
          <h2 id="analysis-library-title">Card library</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close card library">×</button>
      </header>
      <nav className="analysis-library-tabs" aria-label="Card categories">
        <button type="button" className={activeGroup === 'all' ? 'is-active' : ''} aria-pressed={activeGroup === 'all'} onClick={() => setActiveGroup('all')}>All <span>{STAT_LIBRARY_ENTRIES.length}</span></button>
        {STAT_LIBRARY_GROUPS.map((group) => (
          <button key={group.id} type="button" className={activeGroup === group.id ? 'is-active' : ''} aria-pressed={activeGroup === group.id} onClick={() => setActiveGroup(group.id)}>{group.label} <span>{group.statistics.length}</span></button>
        ))}
      </nav>
      <div className="analysis-library-scroll">
        <p id="analysis-library-instructions" className="sr-only">Drag a miniature window onto the canvas. You can also click it or press Enter to add it automatically.</p>
        {visibleGroups.map((group) => (
          <section key={group.id} className="analysis-library-group" aria-labelledby={`analysis-library-${group.id}`}>
            <div className="analysis-library-group-heading">
              <div><h3 id={`analysis-library-${group.id}`}>{group.label}</h3><p>{group.description}</p></div>
              <span>{group.statistics.length}</span>
            </div>
            <div className="analysis-library-miniatures">
              {group.statistics.map((statistic) => (
                <button
                  key={statistic.id}
                  type="button"
                  className="analysis-library-miniature"
                  aria-describedby="analysis-library-instructions"
                  aria-label={`Add ${statistic.fullLabel} card to the canvas`}
                  onMouseEnter={() => statistic.data.forEach(prefetchData)}
                  onFocus={() => statistic.data.forEach(prefetchData)}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    onAdd(statistic)
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    pointerDragRef.current = {
                      pointerId: event.pointerId,
                      statistic,
                      startX: event.clientX,
                      startY: event.clientY,
                      dragging: false,
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const drag = pointerDragRef.current
                    if (!drag || drag.pointerId !== event.pointerId) return
                    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return
                    drag.dragging = true
                    onDragState({ statistic: drag.statistic, x: event.clientX, y: event.clientY })
                  }}
                  onPointerUp={(event) => {
                    const drag = pointerDragRef.current
                    if (!drag || drag.pointerId !== event.pointerId) return
                    if (drag.dragging) {
                      suppressClickRef.current = true
                      onPointerDrop(drag.statistic, { x: event.clientX, y: event.clientY })
                      onDragState(null)
                    }
                    pointerDragRef.current = null
                  }}
                  onPointerCancel={() => {
                    pointerDragRef.current = null
                    onDragState(null)
                  }}
                >
                  <span className="analysis-library-mini-bar">
                    <span aria-hidden="true" className="analysis-library-mini-grip"><i /><i /><i /><i /><i /><i /></span>
                    <strong>{statistic.fullLabel}</strong>
                    <span aria-hidden="true">+</span>
                  </span>
                  <span className="analysis-library-mini-body">
                    <span className="analysis-library-mini-columns"><span>{miniatureSubject(statistic)}</span><span>{statistic.metricLabel}</span></span>
                    <span className="analysis-library-mini-row"><i /><i /></span>
                    <span className="analysis-library-mini-row"><i /><i /></span>
                    <span className="analysis-library-mini-row"><i /><i /></span>
                  </span>
                  <span className="analysis-library-mini-foot">Drag to place <span>Click to add</span></span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
})

export default function Analysis() {
  const location = useLocation()
  const navigate = useNavigate()
  const launchedFromLibrary = isLibraryLaunch(location.search)
  const [cards, setCards] = useState(() => {
    if (launchedFromLibrary) return []
    const planned = Array.isArray(location.state?.analysisCards)
      ? location.state.analysisCards
        .filter((card) => typeof card?.search === 'string' && card.search.startsWith('?'))
        .filter((card, index, all) => all.findIndex((other) => other.search === card.search) === index)
        .slice(0, 6)
      : []
    return planned.length
      ? planned.map((card, index) => createCard(card.search, typeof card.prompt === 'string' ? card.prompt : '', index))
      : [createCard(location.search || '?population=players&year=2026&competition=VCT', '', 0)]
  })
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState(launchedFromLibrary ? 'Drag a miniature onto the canvas, or click one to add it.' : 'Drag a card by its top bar. Ask another question to add more.')
  const [interpreting, setInterpreting] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(launchedFromLibrary)
  const [libraryDrag, setLibraryDrag] = useState(null)
  const topZRef = useRef(Math.max(2, cards.length + 1))
  const inputRef = useRef(null)
  const libraryButtonRef = useRef(null)
  const canvasRef = useRef(null)
  const promptBySearch = useRef(new Map())
  const { data: playerData } = useData('player_buckets')
  const { data: teamData } = useData('team_buckets')
  const players = useMemo(() => Object.keys(playerData?.meta || {}), [playerData])
  const teams = useMemo(() => Object.keys(teamData?.meta || {}), [teamData])
  const events = useMemo(() => [...new Set(Object.values(teamData?.events || {}).map((event) => event.name).filter(Boolean))], [teamData])

  useEffect(() => {
    if (!location.search || isLibraryLaunch(location.search)) return
    setCards((current) => current.some((card) => card.search === location.search)
      ? current
      : [...current, createCard(location.search, promptBySearch.current.get(location.search) || '', current.length)])
  }, [location.search])

  useEffect(() => {
    if (!libraryOpen) return undefined
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return
      setLibraryOpen(false)
      setLibraryDrag(null)
      libraryButtonRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [libraryOpen])

  const focusCard = useCallback((id) => {
    topZRef.current += 1
    const z = topZRef.current
    setCards((items) => items.map((card) => card.id === id ? { ...card, z } : card))
  }, [])

  const moveCard = useCallback((id, x, y) => {
    setCards((items) => items.map((card) => card.id === id ? { ...card, x, y } : card))
  }, [])

  const resizeCard = useCallback((id, geometry) => {
    setCards((items) => items.map((card) => card.id === id ? { ...card, ...geometry } : card))
  }, [])

  const closeCard = useCallback((id) => {
    setCards((items) => items.filter((item) => item.id !== id))
  }, [])

  const closeLibrary = useCallback(() => {
    setLibraryOpen(false)
    setLibraryDrag(null)
    requestAnimationFrame(() => libraryButtonRef.current?.focus())
  }, [])

  const setLibraryDragState = useCallback((drag) => setLibraryDrag(drag), [])

  const addLibraryCard = useCallback((statistic, position) => {
    if (!statistic) return
    statistic.data.forEach(prefetchData)
    topZRef.current += 1
    const z = topZRef.current
    setCards((current) => {
      const card = { ...createCard(statistic.search, statistic.fullLabel, current.length), z }
      if (position && window.innerWidth >= 768) {
        const renderedWidth = Math.min(card.width, window.innerWidth - 48)
        const maxX = Math.max(16, window.innerWidth - renderedWidth - 16)
        card.x = Math.min(Math.max(16, position.x - 90), maxX)
        card.y = Math.max(56, position.y - 22)
      }
      return [...current, card]
    })
    setLibraryDrag(null)
    setMessage(`Added ${statistic.fullLabel}. Drag its top bar to fine-tune the position.`)
    navigate(`/analysis${statistic.search}`, { replace: true })
  }, [navigate])

  const dropLibraryCard = useCallback((statistic, pointer) => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect()
    const panelBounds = document.getElementById('analysis-card-library')?.getBoundingClientRect()
    const insideCanvas = canvasBounds
      && pointer.x >= canvasBounds.left && pointer.x <= canvasBounds.right
      && pointer.y >= canvasBounds.top && pointer.y <= canvasBounds.bottom
    const insidePanel = panelBounds
      && pointer.x >= panelBounds.left && pointer.x <= panelBounds.right
      && pointer.y >= panelBounds.top && pointer.y <= panelBounds.bottom
    if (!insideCanvas || insidePanel) {
      setMessage('Drop the miniature on the open canvas, or click it to add automatically.')
      return
    }
    addLibraryCard(statistic, { x: pointer.x - canvasBounds.left, y: pointer.y - canvasBounds.top })
  }, [addLibraryCard])

  async function submit(event) {
    event?.preventDefault()
    const submitted = query.trim()
    if (!submitted || interpreting) return
    setInterpreting(true)
    setMessage('Understanding your follow-up…')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    let plans = []
    try {
      const intents = (await requestLlmIntents(submitted, controller.signal)).map((intent) => {
        const canonicalEvent = intent.filters?.event
          ? findEventNames(events, intent.filters.event, 1)[0]?.name
          : ''
        return canonicalEvent
          ? { ...intent, filters: { ...intent.filters, event: canonicalEvent } }
          : intent
      })
      const prepared = intents.length === 1
        ? [mergeExplicitScope(mergeExplicitRequest(intents[0], submitted), parseTimeframe(submitted))]
        : intents
      plans = prepared
        .map((intent) => ({ to: intentToPath(intent), prompt: intent.summary || submitted }))
        .filter((plan) => plan.to?.startsWith('/analysis'))
    } catch {
      const to = localAnalysisPath(submitted, players, teams, events)
      if (to) plans = [{ to, prompt: submitted }]
    } finally {
      clearTimeout(timeout)
      setInterpreting(false)
    }

    if (!plans.length) {
      setMessage('Try asking for a player, team, role, metric, or event scope.')
      return
    }

    const latest = cards.at(-1)?.search || location.search
    const nextCards = plans.map((plan, index) => {
      const planSearch = new URL(plan.to, 'https://vct-data.local').search
      const search = plans.length === 1 ? contextualizeSearch(planSearch, latest, submitted) : planSearch
      topZRef.current += 1
      promptBySearch.current.set(search, plan.prompt)
      return { ...createCard(search, plans.length === 1 ? submitted : plan.prompt, cards.length + index), z: topZRef.current }
    })
    setCards((current) => [...current, ...nextCards])
    setQuery('')
    setMessage(plans.length === 1 ? 'Added a new card. Drag its top bar to place it anywhere.' : `Added ${plans.length} cards from your request.`)
    for (const card of nextCards) {
      const params = new URLSearchParams(card.search)
      prefetchData(params.get('population') === 'teams' || params.has('team') ? 'team_buckets' : 'player_buckets')
    }
    navigate(`/analysis${nextCards.at(-1).search}`, { replace: true })
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const canvasHeight = Math.max(780, ...cards.map((card) => card.y + card.height + 40))

  return (
    <div className="analysis-workspace">
      <div className="analysis-workspace-topbar">
        <Link to="/" className="analysis-canvas-mark" aria-label="Start a new search">vct <span>/</span> data</Link>
        <div><span>{cards.length}</span> {cards.length === 1 ? 'card' : 'cards'} on canvas</div>
      </div>

      <section
        ref={canvasRef}
        className={`analysis-canvas${libraryDrag ? ' is-library-dragging' : ''}`}
        aria-label="Analysis card canvas"
        style={{ minHeight: `${canvasHeight}px` }}
      >
        {cards.map((card) => <CanvasCard key={card.id} card={card} onMove={moveCard} onResize={resizeCard} onFocus={focusCard} onClose={closeCard} />)}
        {cards.length === 0 && <div className="analysis-empty"><strong>Your canvas is empty.</strong><span>{libraryOpen ? 'Drag a miniature here, or click one to add it.' : 'Ask a question below or open the card library.'}</span></div>}
      </section>

      {libraryDrag && (
        <div className="analysis-library-drag-ghost" style={{ left: `${libraryDrag.x + 12}px`, top: `${libraryDrag.y + 12}px` }} aria-hidden="true">
          <span className="analysis-library-mini-grip"><i /><i /><i /><i /><i /><i /></span>
          <strong>{libraryDrag.statistic.fullLabel}</strong>
        </div>
      )}

      <div className="analysis-dock">
        {libraryOpen && <StatisticLibrary onAdd={addLibraryCard} onClose={closeLibrary} onDragState={setLibraryDragState} onPointerDrop={dropLibraryCard} />}
        <div className="analysis-dock-controls">
          <form className="analysis-dock-form" onSubmit={submit} role="search">
            <label htmlFor="analysis-followup" className="sr-only">Ask for more statistics</label>
            <textarea
              ref={inputRef}
              id="analysis-followup"
              rows={1}
              value={query}
              onChange={(event) => setQuery(event.target.value.replace(/\n/g, ' '))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder="Ask for another player, table, metric, or scope…"
              autoComplete="off"
              spellCheck="false"
            />
            <button type="submit" disabled={!query.trim() || interpreting} aria-label={interpreting ? 'Understanding follow-up' : 'Add analysis card'}>
              {interpreting ? <span aria-hidden="true">···</span> : submitIcon()}
            </button>
          </form>
          <button
            ref={libraryButtonRef}
            type="button"
            className="analysis-library-trigger"
            aria-expanded={libraryOpen}
            aria-controls="analysis-card-library"
            title="Open the card library"
            onClick={() => setLibraryOpen((open) => !open)}
          >
            {libraryIcon()}
            <span>Library</span>
            <small>{STAT_LIBRARY_ENTRIES.length}</small>
          </button>
        </div>
        <p aria-live="polite">{message}</p>
      </div>
    </div>
  )
}
