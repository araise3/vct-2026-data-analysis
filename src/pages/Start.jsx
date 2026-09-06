import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadData, prefetchData, useData } from '../lib/useData'
import { editDistance, findEventNames, fuzzyStatisticScore, normalizeQuery, parseTimeframe, withScope } from '../lib/startQuery'
import { intentToPath, sanitizeIntent } from '../lib/intentContract'
import { STAT_CATALOG } from '../lib/statCatalog'
import { STAT_LIBRARY_ENTRIES } from '../lib/statLibrary'

// Metrics are vocabulary for the query compiler, not fixed destinations.
// Each one opens the composable analysis route, where it can be combined
// with named entities, roles, and scope filters in the same result.
const STAT_DESTINATIONS = STAT_CATALOG.map((statistic) => ({
  label: statistic.searchLabel,
  description: statistic.description,
  to: `/analysis?metric=${encodeURIComponent(statistic.id)}`,
  data: statistic.data,
  keywords: statistic.keywords,
}))

const ENTITY_FUZZY_STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'between', 'best', 'by', 'compare', 'during', 'event', 'events',
  'for', 'from', 'in', 'last', 'me', 'month', 'most', 'of', 'on', 'one', 'past', 'player',
  'players', 'previous', 'show', 'stage', 'stat', 'stats', 'statistics', 'team', 'teams',
  'the', 'this', 'to', 'two', 'week', 'year',
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june',
  'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october',
  'nov', 'november', 'dec', 'december',
])

function normalized(value) {
  return normalizeQuery(value)
}

function mentionsEntity(text, name) {
  const escaped = normalized(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(normalized(text))
}

function findNamedEntities(names, query, limit = 5) {
  const needle = normalized(query)
  if (!needle) return []
  const queryWords = needle.split(' ').filter((word) => !ENTITY_FUZZY_STOPWORDS.has(word) && !/^\d+$/.test(word))

  return names
    .map((name) => {
      const candidate = normalized(name)
      const directIndex = candidate.indexOf(needle)
      const mentioned = mentionsEntity(needle, candidate)
      const candidateWordCount = candidate.split(' ').length
      let fuzzyScore = Infinity
      for (let i = 0; i <= queryWords.length - candidateWordCount; i++) {
        const window = queryWords.slice(i, i + candidateWordCount).join(' ')
        // Entity names get a deliberately tighter edit window than domain
        // vocabulary. This keeps “sentnels” → Sentinels while preventing a
        // conversational filler like “show” from suggesting ShadoW.
        if (Math.abs(window.length - candidate.length) > 1) continue
        const distance = editDistance(window, candidate)
        const allowance = candidate.length <= 5 ? 1 : candidate.length <= 10 ? 2 : 3
        if (distance <= allowance) fuzzyScore = Math.min(fuzzyScore, 5 + distance)
      }
      if (directIndex === -1 && !mentioned && !Number.isFinite(fuzzyScore)) return null
      return {
        name,
        score: candidate === needle ? 0 : mentioned ? 1 : directIndex === 0 ? 2 : directIndex >= 0 ? 3 : fuzzyScore + 4,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function destinationScore(destination, query) {
  let best = Infinity
  for (const keyword of destination.keywords) {
    best = Math.min(best, fuzzyStatisticScore(query, keyword))
  }
  return best
}

function statisticInQuery(query, entity = '') {
  return STAT_CATALOG
    .filter((statistic) => !entity || statistic.entity === entity)
    .map((statistic) => ({
      statistic,
      score: Math.min(...statistic.keywords.map((keyword) => fuzzyStatisticScore(query, keyword))),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.statistic.searchLabel.localeCompare(b.statistic.searchLabel))[0]
    ?.statistic || null
}

function explicitSortOrder(query) {
  const text = normalized(query)
  if (/\b(?:shortest|lowest|least|fewest)\b/.test(text)) return 'asc'
  if (/\b(?:longest|highest|best|most|top)\b/.test(text)) return 'desc'
  return ''
}

function withExplicitOrder(to, order) {
  if (!order) return to
  const url = new URL(to, 'https://vct-data.local')
  url.searchParams.set('order', order)
  return `${url.pathname}${url.search}${url.hash}`
}

const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel']

function roleInQuery(query) {
  const text = normalized(query)
  return ROLES.find((role) => new RegExp(`\\b${role.toLowerCase()}s?\\b`).test(text)) || ''
}

function tableRequested(query) {
  return /\b(?:all|table|leaderboard|leaders|ranking|rankings|ranked|list|players|teams|peers)\b/.test(normalized(query))
}

function analysisPath({ players = [], teams = [], role = '', metric = '', population = '', table = false, event = '' }, scope) {
  const params = new URLSearchParams()
  players.forEach((player) => params.append('player', player))
  teams.forEach((team) => params.append('team', team))
  if (role) params.set('role', role)
  if (metric) params.set('metric', metric)
  if (population) params.set('population', population)
  if (table) params.set('table', '1')
  if (event) params.set('event', event)
  return withScope(`/analysis?${params}`, scope)
}

function canonicalizeIntentEvent(intent, eventNames) {
  if (!intent?.filters?.event || !eventNames.length) return intent
  const event = findEventNames(eventNames, intent.filters.event, 1)[0]?.name
  return event ? { ...intent, filters: { ...intent.filters, event } } : intent
}

function arrowIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" />
    </svg>
  )
}

function libraryIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3.5 4.25h5.25A1.25 1.25 0 0 1 10 5.5v10.25a2 2 0 0 0-2-2H3.5V4.25Z" />
      <path d="M16.5 4.25h-5.25A1.25 1.25 0 0 0 10 5.5v10.25a2 2 0 0 1 2-2h4.5V4.25Z" />
    </svg>
  )
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
  // Vite's development server does not run Cloudflare Pages Functions. Keep
  // local development quiet and deterministic; deployed Pages uses the LLM.
  if (import.meta.env.DEV) throw new Error('Workers AI is unavailable in Vite dev')

  const response = await fetch('/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Intent service unavailable')
  }
  const payload = await response.json()
  const intent = sanitizeIntent(payload.intent)
  if (!intent) throw new Error('Invalid intent')
  return intent
}

export default function Start() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [hasFocused, setHasFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [message, setMessage] = useState('')
  const [interpreting, setInterpreting] = useState(false)
  const [suggestionQuery, setSuggestionQuery] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => setSuggestionQuery(query), 150)
    return () => clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    if (suggestionQuery.trim()) setHasFocused(true)
  }, [suggestionQuery])

  // Entity indexes are intentionally deferred until the visitor pauses after
  // typing. `autoFocus` fires on mount, so loading on focus made the browser
  // parse both large bucket files while the first sentence was still being
  // entered. The same short pause also keeps fuzzy suggestion work off the
  // synchronous keystroke path.
  const { data: playerData } = useData(hasFocused ? 'player_buckets' : null)
  const { data: teamData } = useData(hasFocused ? 'team_buckets' : null)

  const players = useMemo(() => Object.keys(playerData?.meta || {}), [playerData])
  const teams = useMemo(() => Object.keys(teamData?.meta || {}), [teamData])
  const events = useMemo(
    () => [...new Set(Object.values(teamData?.events || {}).map((event) => event.name).filter(Boolean))],
    [teamData],
  )
  const scope = useMemo(() => parseTimeframe(query), [query])
  const suggestionScope = useMemo(() => parseTimeframe(suggestionQuery), [suggestionQuery])

  const suggestions = useMemo(() => {
    if (!suggestionQuery.trim()) return []

    const rows = []
    const needle = normalized(suggestionQuery)
    const comparisonRequest = ['compare', ' versus ', ' vs ', 'against', 'head to head'].some((word) => needle.includes(word))
    const playerCandidates = findNamedEntities(players, suggestionQuery, 2)
    const teamCandidates = findNamedEntities(teams, suggestionQuery, 2)
    const explicitRole = roleInQuery(suggestionQuery)
    const asksForAnalysis = suggestionScope.hasScope || explicitRole || /\b(?:give|show|stats?|statistics|performance|table|leaders?|best|top)\b/.test(needle)
    const playerPopulation = /\bplayers?\b/.test(needle)
    const teamPopulation = /\bteams?\b/.test(needle)
    const wantsTable = tableRequested(suggestionQuery)
    if (asksForAnalysis && (playerCandidates.length || teamCandidates.length || explicitRole || playerPopulation || teamPopulation)) {
      const selectedPlayers = comparisonRequest ? playerCandidates.map((entry) => entry.name) : playerCandidates.slice(0, 1).map((entry) => entry.name)
      const player = selectedPlayers[0]
      const team = !player ? teamCandidates[0]?.name : ''
      const matchedStatistic = statisticInQuery(suggestionQuery, player || explicitRole || playerPopulation ? 'players' : team || teamPopulation ? 'teams' : '')
      rows.push({
        label: selectedPlayers.length > 1 ? `${selectedPlayers.join(' and ')} comparison` : player ? `${player} statistics` : team ? `${team} statistics` : explicitRole ? `${explicitRole} players` : teamPopulation ? 'Team table' : 'Player table',
        description: player || team
          ? wantsTable ? 'Summary plus the requested table' : 'Focused summary only'
          : 'A table built from the requested scope',
        kind: 'Analysis',
        to: analysisPath({ players: selectedPlayers, teams: team ? [team] : [], role: explicitRole, metric: matchedStatistic?.id || '', population: team || teamPopulation ? 'teams' : 'players', table: wantsTable }, suggestionScope),
        data: player || explicitRole ? ['player_buckets', 'player_agents'] : ['team_buckets'],
        score: -12,
      })
    }
    const genericEntityQuery = ['player', 'players', 'team', 'teams', 'stat', 'stats', 'statistics'].includes(normalized(suggestionQuery))
    if (!genericEntityQuery) {
      for (const destination of STAT_DESTINATIONS) {
        const score = destinationScore(destination, suggestionQuery)
        if (Number.isFinite(score)) rows.push({ ...destination, kind: 'Statistic', score: score - 4 })
      }
    }
    for (const result of findNamedEntities(players, suggestionQuery, 4)) {
      rows.push({
        label: result.name,
        description: `${playerData?.meta?.[result.name]?.team || 'Player'} · Focused statistics card`,
        kind: 'Player',
        to: analysisPath({ players: [result.name], population: 'players' }, suggestionScope),
        data: ['player_buckets', 'player_agents'],
        score: result.score,
      })
    }
    for (const result of findNamedEntities(teams, suggestionQuery, 3)) {
      rows.push({
        label: result.name,
        description: `${teamData?.meta?.[result.name]?.region || 'Team'} · Focused statistics card`,
        kind: 'Team',
        to: analysisPath({ teams: [result.name], population: 'teams' }, suggestionScope),
        data: ['team_buckets'],
        score: result.score,
      })
    }
    for (const result of findEventNames(events, suggestionQuery, 2)) {
      rows.push({
        label: result.name,
        description: 'Team table for this event',
        kind: 'Event',
        to: analysisPath({ population: 'teams', table: true, event: result.name }, suggestionScope),
        data: ['team_buckets'],
        score: result.score,
      })
    }

    if (suggestionScope.hasScope && rows.length === 0) {
      rows.push({
        label: 'Players in this scope', description: 'Scoped player table', kind: 'Analysis',
        to: analysisPath({ population: 'players', table: true }, suggestionScope), data: ['player_buckets', 'player_agents'], score: 40,
      })
    }

    return rows
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
      .map((row) => ({
        ...row,
        to: withScope(
          row.kind === 'Statistic' ? withExplicitOrder(row.to, explicitSortOrder(suggestionQuery)) : row.to,
          suggestionScope,
        ),
        description: suggestionScope.label ? `${row.description} · ${suggestionScope.label}` : row.description,
      }))
      .filter((row, index, all) => all.findIndex((candidate) => candidate.to === row.to) === index)
      .slice(0, 6)
  }, [events, playerData, players, suggestionQuery, suggestionScope, teamData, teams])

  function mentionedPlayers(text, playerNames = players) {
    const needle = normalized(text)
    return playerNames
      .map((name) => {
        const candidate = normalized(name)
        return {
          name,
          index: candidate.length > 1 && mentionsEntity(needle, candidate)
            ? needle.indexOf(candidate)
            : -1,
        }
      })
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index || b.name.length - a.name.length)
      .map((entry) => entry.name)
      .filter((name, index, all) => !all.slice(0, index).some((other) => normalized(other).includes(normalized(name))))
  }

  function resolve(text, playerNames = players, teamNames = teams, eventNames = events) {
    const needle = normalized(text)
    if (!needle) return null

    const playerMentions = mentionedPlayers(text, playerNames)
    const wantsComparison = ['compare', ' versus ', ' vs ', 'against', 'head to head'].some((word) => needle.includes(word))
    if (wantsComparison && playerMentions.length >= 2) {
      return analysisPath({ players: playerMentions.slice(0, 2), population: 'players' }, scope)
    }
    if (wantsComparison && playerMentions.length === 1) {
      return analysisPath({ players: [playerMentions[0]], population: 'players' }, scope)
    }

    const playerCandidate = playerMentions[0] || findNamedEntities(playerNames, text, 1)[0]?.name
    const teamCandidate = findNamedEntities(teamNames, text, 1)[0]?.name
    const eventCandidate = findEventNames(eventNames, text, 1)[0]?.name
    const explicitRole = roleInQuery(text)
    const asksForAnalysis = scope.hasScope || explicitRole || /\b(?:give|show|stats?|statistics|performance|table|leaders?|best|top)\b/.test(needle)
    const playerPopulation = /\bplayers?\b/.test(needle)
    const teamPopulation = /\bteams?\b/.test(needle)
    const matchedStatistic = statisticInQuery(text, playerCandidate || explicitRole || playerPopulation ? 'players' : teamCandidate || teamPopulation ? 'teams' : '')
    if (asksForAnalysis && (playerCandidate || teamCandidate || eventCandidate || explicitRole || playerPopulation || teamPopulation || matchedStatistic || scope.hasScope)) {
      return analysisPath({
        players: playerCandidate ? [playerCandidate] : [],
        teams: !playerCandidate && teamCandidate ? [teamCandidate] : [],
        role: explicitRole,
        metric: matchedStatistic?.id || '',
        population: !playerCandidate && !explicitRole && !playerPopulation && (teamCandidate || teamPopulation || eventCandidate) ? 'teams' : 'players',
        table: tableRequested(text) || (!playerCandidate && !teamCandidate && !!eventCandidate),
        event: eventCandidate,
      }, scope)
    }

    if (playerCandidate) return analysisPath({ players: [playerCandidate], population: 'players' }, scope)
    if (teamCandidate) return analysisPath({ teams: [teamCandidate], population: 'teams' }, scope)
    if (eventCandidate) return analysisPath({ population: 'teams', table: true, event: eventCandidate }, scope)

    const entity = suggestions[0]
    if (entity) return entity.to

    const destination = STAT_DESTINATIONS
      .map((row) => ({ ...row, score: destinationScore(row, text) }))
      .filter((row) => Number.isFinite(row.score))
      .sort((a, b) => a.score - b.score)[0]
    return destination ? withScope(destination.to, scope) : null
  }

  function go(to, data = []) {
    data.forEach(prefetchData)
    navigate(to)
  }

  async function submit(event) {
    event?.preventDefault()
    if (interpreting) return
    const active = suggestions[activeIndex]
    if (active) {
      go(active.to, active.data)
      return
    }

    const submittedQuery = query.trim()
    setInterpreting(true)
    setMessage('Understanding your request…')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    let to = null
    try {
      const intent = canonicalizeIntentEvent(await requestLlmIntent(submittedQuery, controller.signal), events)
      to = intentToPath(mergeExplicitScope(intent, parseTimeframe(submittedQuery)))
    } catch {
      // Vite has no Pages Function or Workers AI binding. The deterministic
      // resolver is intentionally retained as a fast/offline fallback, and
      // explicit scope terms are merged into LLM results above as guardrails.
      to = resolve(submittedQuery)
      if (!to && (!players.length || !teams.length)) {
        try {
          setHasFocused(true)
          const [loadedPlayers, loadedTeams] = await Promise.all([
            loadData('player_buckets'),
            loadData('team_buckets'),
          ])
          to = resolve(
            submittedQuery,
            Object.keys(loadedPlayers?.meta || {}),
            Object.keys(loadedTeams?.meta || {}),
            [...new Set(Object.values(loadedTeams?.events || {}).map((event) => event.name).filter(Boolean))],
          )
        } catch {
          // The existing no-result message below covers an unavailable index.
        }
      }
    } finally {
      clearTimeout(timeout)
      setInterpreting(false)
    }

    if (!to?.startsWith('/analysis')) to = resolve(submittedQuery)
    if (to) {
      const params = new URL(to, 'https://vct-data.local').searchParams
      go(to, [params.has('team') || params.get('population') === 'teams' ? 'team_buckets' : 'player_buckets'])
      return
    }
    setMessage('Try a player, team, role, metric, ranking, comparison, or event scope.')
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Escape') {
      setFocused(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const showSuggestions = focused && suggestionQuery === query && query.trim() && suggestions.length > 0
  return (
    <div className="start-stage">
      <div className="start-console">
        <div className="start-mark" aria-label="VCT Data">vct <span>/</span> data</div>
        <div className="start-query-row">
          <form className="start-form" onSubmit={submit} role="search">
            <div className={`start-composer ${showSuggestions ? 'has-suggestions' : ''}`}>
              <label htmlFor="start-query" className="sr-only">Where would you like to go?</label>
              <textarea
                ref={inputRef}
                id="start-query"
                rows={1}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value.replace(/\n/g, ' '))
                  setActiveIndex(-1)
                  setMessage('')
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={onKeyDown}
                placeholder="Ask for a player, team, event, ranking, or analysis…"
                autoComplete="off"
                spellCheck="false"
                autoFocus
              />
              <button type="submit" aria-label={interpreting ? 'Understanding request' : 'Find statistics'} disabled={!query.trim() || interpreting}>
                {interpreting ? <span aria-hidden="true">···</span> : arrowIcon()}
              </button>
            </div>

            {showSuggestions && (
              <div className="start-suggestions" role="listbox" aria-label="Suggested destinations">
                {suggestions.map((row, index) => (
                  <button
                    key={`${row.kind}-${row.to}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? 'is-active' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActiveIndex(index)
                      row.data?.forEach(prefetchData)
                    }}
                    onClick={() => go(row.to, row.data)}
                  >
                    <span className="start-suggestion-copy">
                      <strong>{row.label}</strong>
                      <small>{row.description}</small>
                    </span>
                    <span className="start-suggestion-kind">{row.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </form>
          <button
            type="button"
            className="start-library-trigger"
            aria-label={`Open the library of ${STAT_LIBRARY_ENTRIES.length} statistics on the canvas`}
            title="Open the card library"
            onClick={() => navigate('/analysis?library=1')}
          >
            {libraryIcon()}
            <span className="start-library-label">Library</span>
            <span className="start-library-count" aria-label={`${STAT_LIBRARY_ENTRIES.length} statistics`}>{STAT_LIBRARY_ENTRIES.length}</span>
          </button>
        </div>
        <p className="start-message" aria-live="polite">
          {message || 'Try “give me mada stats in Americas 2026 Stage 1”'}
        </p>
      </div>
    </div>
  )
}
