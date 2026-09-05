import { useEffect, useMemo, useRef, useState } from 'react'
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
import { teamTierExtras } from '../lib/statDefs'
import { editDistance, fuzzyStatisticScore, normalizeQuery, parseTimeframe, withScope } from '../lib/startQuery'
import { intentToPath, sanitizeIntent } from '../lib/intentContract'
import DataTable from '../components/DataTable'
import { FACETS } from '../components/FilterPanel'
import Flag from '../components/Flag'
import TeamLogo from '../components/TeamLogo'
import { eventLabel, num, pct, rating } from '../lib/format'

const ROLE_NAMES = ['Duelist', 'Initiator', 'Controller', 'Sentinel']
const CONTEXT_WORDS = /\b(?:also|and|same|again|his|her|their|that|those|what about)\b/i
const SUBJECT_WORDS = /\b(?:players?|teams?|duelists?|initiators?|controllers?|sentinels?)\b/i
const TABLE_REQUEST_WORDS = /\b(?:all|table|leaderboard|leaders|ranking|rankings|ranked|list|players|teams|duelists|initiators|controllers|sentinels|peers)\b/i
const ENTITY_STOPWORDS = new Set([
  'also', 'and', 'another', 'best', 'for', 'from', 'give', 'in', 'me', 'more', 'of',
  'on', 'player', 'players', 'show', 'stage', 'stat', 'stats', 'statistics', 'team',
  'teams', 'the', 'to', 'with',
])
let nextCardId = 1

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

function localAnalysisPath(query, players, teams) {
  const scope = parseTimeframe(query)
  const player = mentionedEntity(players, query)
  const team = player ? '' : mentionedEntity(teams, query)
  const role = roleInQuery(query)
  const statistic = statisticInQuery(query)
  if (!player && !team && !role && !statistic && !scope.hasScope) return null

  const params = new URLSearchParams()
  if (player) params.append('player', player)
  if (team) params.append('team', team)
  if (role) params.set('role', role)
  if (statistic) params.set('metric', statistic.id)
  const population = team || (!player && !role && statistic?.entity === 'teams') ? 'teams' : 'players'
  params.set('population', population)
  const wantsTable = TABLE_REQUEST_WORDS.test(query)
  if (wantsTable || (!player && !team)) params.set('table', '1')
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

async function requestLlmIntent(query, signal) {
  if (import.meta.env.DEV) throw new Error('Workers AI is unavailable in Vite dev')
  const response = await fetch('/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Intent service unavailable')
  const payload = await response.json()
  const intent = sanitizeIntent(payload.intent)
  if (!intent) throw new Error('Invalid intent')
  return intent
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
  for (const key of ['population', 'metric', 'order', 'table', 'year', 'competition', 'region', 'split', 'event', 'eventPhase', 'eventWeek', 'from', 'to']) {
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
  const showTable = params.get('table') === '1' || (!requestedPlayers.length && !requestedTeams.length)
  const requestedRole = ROLE_NAMES.includes(params.get('role')) ? params.get('role') : ''
  const requestedPopulation = ['players', 'teams'].includes(params.get('population')) ? params.get('population') : ''
  const statistic = getStatisticById(params.get('metric'))
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
  const { data: agentData, loading: agentLoading } = useData(mode === 'players' ? 'player_agents' : null)

  const rawRecords = useMemo(() => {
    if (!data) return []
    if (mode === 'matches') return statistic.definition.matchLevel === 'series' ? expandSeriesRows(data) : expandMapLengthRows(data)
    return expandBuckets(data, mode === 'players' ? 'p' : 't')
  }, [data, mode, statistic])
  const dayGroups = useMemo(() => (mode === 'players' && agentData ? buildPlayerDayGroups(agentData.buckets) : new Map()), [agentData, mode])
  const records = useMemo(() => (mode === 'players' ? attachDateSpans(rawRecords, dayGroups) : rawRecords), [dayGroups, mode, rawRecords])
  const filters = useFacetedFilter(records, FACETS, { competition: ['VCT'], year: [2026] }, search)

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
    return filters.filtered
      .filter((row) => statistic.definition.matchLevel !== 'series' || row.fullyTimed)
      .map((row) => ({ ...row, metricValue: statistic.definition.compute(row) }))
      .filter((row) => Number.isFinite(row.metricValue))
  }, [filters.filtered, mode, statistic])

  if (error) return <p role="alert" className="analysis-card-state">This analysis could not be loaded. Please try again.</p>
  if (loading || (mode === 'players' && agentLoading) || !data) return <p role="status" className="analysis-card-state">Building analysis…</p>

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
  const shownRows = mode === 'matches' ? matchRows : tableRows
  const tableTitle = mode === 'players'
    ? effectiveRole ? `${effectiveRole} players` : activeStatistic ? activeStatistic.searchLabel : 'Players'
    : mode === 'teams' ? activeStatistic ? activeStatistic.searchLabel : 'Teams'
    : statistic.searchLabel
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

      {showTable && <section className="analysis-table-section">
        <div className="analysis-table-heading">
          <div><h3>{tableTitle}</h3>{effectiveRole && inferredRole && !requestedRole && <p>Role inferred from {featuredRows[0]?.name}'s agent usage in this scope.</p>}</div>
          <span>{shownRows.length} {mode === 'players' ? 'players' : mode === 'teams' ? 'teams' : 'results'}</span>
        </div>
        <DataTable
          columns={mode === 'players' ? playerColumns : mode === 'teams' ? teamColumns : matchColumns}
          rows={shownRows}
          defaultSortKey={activeStatistic ? 'metricValue' : mode === 'players' ? 'avgRating' : mode === 'teams' ? 'matchWinPct' : 'metricValue'}
          defaultSortDir={defaultSortDir}
          expandKey={(row) => mode === 'matches' ? row.id : row.name}
        />
      </section>}
    </div>
  )
}

function cardShowsTable(search) {
  const params = new URLSearchParams(search)
  return params.get('table') === '1' || (!params.has('player') && !params.has('team'))
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
  const width = cardShowsTable(normalizedSearch) ? 1060 : 720
  return { id: nextCardId++, search: normalizedSearch, prompt, width, ...initialPosition(index, width) }
}

function CanvasCard({ card, onMove, onFocus, onClose }) {
  const cardRef = useRef(null)
  const dragRef = useRef(null)

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

  return (
    <article ref={cardRef} className={`analysis-window${cardShowsTable(card.search) ? '' : ' is-compact'}`} style={{ '--card-x': `${card.x}px`, '--card-y': `${card.y}px`, '--card-width': `${card.width}px`, zIndex: card.z }} onPointerDown={() => onFocus(card.id)}>
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
      <div className="analysis-window-body"><AnalysisResult search={card.search} /></div>
    </article>
  )
}

function submitIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" /></svg>
}

export default function Analysis() {
  const location = useLocation()
  const navigate = useNavigate()
  const [cards, setCards] = useState(() => [createCard(location.search || '?population=players&year=2026&competition=VCT', '', 0)])
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('Drag a card by its top bar. Ask another question to add more.')
  const [interpreting, setInterpreting] = useState(false)
  const topZRef = useRef(2)
  const inputRef = useRef(null)
  const promptBySearch = useRef(new Map())
  const { data: playerData } = useData('player_buckets')
  const { data: teamData } = useData('team_buckets')
  const players = useMemo(() => Object.keys(playerData?.meta || {}), [playerData])
  const teams = useMemo(() => Object.keys(teamData?.meta || {}), [teamData])

  useEffect(() => {
    if (!location.search) return
    setCards((current) => current.some((card) => card.search === location.search)
      ? current
      : [...current, createCard(location.search, promptBySearch.current.get(location.search) || '', current.length)])
  }, [location.search])

  function focusCard(id) {
    topZRef.current += 1
    const z = topZRef.current
    setCards((items) => items.map((card) => card.id === id ? { ...card, z } : card))
  }

  function moveCard(id, x, y) {
    setCards((items) => items.map((card) => card.id === id ? { ...card, x, y } : card))
  }

  async function submit(event) {
    event?.preventDefault()
    const submitted = query.trim()
    if (!submitted || interpreting) return
    setInterpreting(true)
    setMessage('Understanding your follow-up…')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    let to = null
    try {
      const intent = await requestLlmIntent(submitted, controller.signal)
      to = intentToPath(mergeExplicitScope(intent, parseTimeframe(submitted)))
    } catch {
      to = localAnalysisPath(submitted, players, teams)
    } finally {
      clearTimeout(timeout)
      setInterpreting(false)
    }

    if (!to?.startsWith('/analysis')) to = localAnalysisPath(submitted, players, teams)
    if (!to) {
      setMessage('Try asking for a player, team, role, metric, or event scope.')
      return
    }

    const latest = cards.at(-1)?.search || location.search
    const nextSearch = contextualizeSearch(new URL(to, 'https://vct-data.local').search, latest, submitted)
    topZRef.current += 1
    const nextCard = { ...createCard(nextSearch, submitted, cards.length), z: topZRef.current }
    promptBySearch.current.set(nextSearch, submitted)
    setCards((current) => [...current, nextCard])
    setQuery('')
    setMessage('Added a new card. Drag its top bar to place it anywhere.')
    const nextParams = new URLSearchParams(nextSearch)
    prefetchData(nextParams.get('population') === 'teams' || nextParams.has('team') ? 'team_buckets' : 'player_buckets')
    navigate(`/analysis${nextSearch}`, { replace: true })
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const canvasHeight = Math.max(780, ...cards.map((card) => card.y + (cardShowsTable(card.search) ? 720 : 360)))

  return (
    <div className="analysis-workspace">
      <div className="analysis-workspace-topbar">
        <Link to="/" className="analysis-canvas-mark" aria-label="Start a new search">vct <span>/</span> data</Link>
        <div><span>{cards.length}</span> {cards.length === 1 ? 'card' : 'cards'} on canvas</div>
      </div>

      <section className="analysis-canvas" aria-label="Analysis card canvas" style={{ minHeight: `${canvasHeight}px` }}>
        {cards.map((card) => <CanvasCard key={card.id} card={card} onMove={moveCard} onFocus={focusCard} onClose={(id) => setCards((items) => items.filter((item) => item.id !== id))} />)}
        {cards.length === 0 && <div className="analysis-empty"><strong>Your canvas is empty.</strong><span>Ask a question below to add a card.</span></div>}
      </section>

      <div className="analysis-dock">
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
        <p aria-live="polite">{message}</p>
      </div>
    </div>
  )
}
