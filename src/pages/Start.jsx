import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData, prefetchData } from '../lib/useData'
import { editDistance, fuzzyPhraseScore, normalizeQuery, parseTimeframe, withScope } from '../lib/startQuery'
import { intentToPath, sanitizeIntent } from '../lib/intentContract'
import { STAT_CATALOG } from '../lib/statCatalog'
import agentRoles from '../lib/agentRoles.json'

const DESTINATIONS = [
  {
    label: 'Player statistics',
    description: 'Rankings, form and individual profiles',
    to: '/players',
    data: ['player_buckets'],
    keywords: ['player', 'players', 'best', 'top', 'rating', 'acs', 'kast', 'kills', 'performance'],
  },
  {
    label: 'Team statistics',
    description: 'Team records, maps and roster performance',
    to: '/teams',
    data: ['team_buckets'],
    keywords: ['team', 'teams', 'record', 'roster', 'map win', 'performance'],
  },
  {
    label: 'Compare players',
    description: 'Side-by-side profile and head-to-head',
    to: '/compare',
    data: ['player_buckets'],
    keywords: ['compare', 'comparison', 'versus', ' vs ', 'against', 'head to head'],
  },
  {
    label: 'Team ratings',
    description: 'Glicko-2 rankings and rating history',
    to: '/ratings',
    data: ['match_results'],
    keywords: ['team rating', 'team ratings', 'power ranking', 'rankings', 'glicko', 'strongest team'],
  },
  {
    label: 'Agent meta',
    description: 'Pick rates, map balance and agent performance',
    to: '/agents',
    data: ['agents'],
    keywords: ['agent', 'agents', 'meta', 'pick rate', 'attack', 'defense', 'defence'],
  },
  {
    label: 'Compositions',
    description: 'Five-agent lineups by map',
    to: '/compositions',
    data: ['match_results', 'match_players'],
    keywords: ['composition', 'compositions', 'comp', 'comps', 'lineup', 'five agents'],
  },
  {
    label: 'Event statistics',
    description: 'Team performance within tournaments',
    to: '/tournaments',
    data: ['team_buckets'],
    keywords: ['event', 'events', 'tournament', 'tournaments', 'masters', 'champions', 'kickoff'],
  },
  {
    label: 'Economy',
    description: 'Buy rounds, conversions and spending',
    to: '/economy',
    data: ['team_buckets'],
    keywords: ['economy', 'eco', 'buy round', 'pistol', 'credits', 'conversion'],
  },
  {
    label: 'Records',
    description: 'Extreme matches and statistical records',
    to: '/records',
    data: ['match_results', 'series_length', 'map_length'],
    keywords: ['record', 'records', 'longest', 'shortest', 'most kills', 'highest'],
  },
  {
    label: 'Export graphics',
    description: 'Create shareable stat cards',
    to: '/graphics',
    data: ['player_buckets', 'team_buckets'],
    keywords: ['graphic', 'graphics', 'export', 'image', 'share', 'stat card'],
  },
]

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

const AGENTS = Object.keys(agentRoles)
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
    best = Math.min(best, fuzzyPhraseScore(query, keyword))
  }
  return best
}

function statisticInQuery(query, entity = '') {
  return STAT_CATALOG
    .filter((statistic) => !entity || statistic.entity === entity)
    .map((statistic) => ({
      statistic,
      score: Math.min(...statistic.keywords.map((keyword) => fuzzyPhraseScore(query, keyword))),
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

function analysisPath({ players = [], teams = [], role = '', metric = '', population = '' }, scope) {
  const params = new URLSearchParams()
  players.forEach((player) => params.append('player', player))
  teams.forEach((team) => params.append('team', team))
  if (role) params.set('role', role)
  if (metric) params.set('metric', metric)
  if (population) params.set('population', population)
  return withScope(`/analysis?${params}`, scope)
}

function arrowIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" />
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

  // Entity indexes are intentionally deferred until the single control is
  // used. The empty start page stays instant instead of parsing both large
  // bucket files before the visitor has expressed any intent.
  const { data: playerData } = useData(hasFocused ? 'player_buckets' : null)
  const { data: teamData } = useData(hasFocused ? 'team_buckets' : null)

  const players = useMemo(() => Object.keys(playerData?.meta || {}), [playerData])
  const teams = useMemo(() => Object.keys(teamData?.meta || {}), [teamData])
  const events = useMemo(
    () => [...new Set(Object.values(teamData?.events || {}).map((event) => event.name).filter(Boolean))],
    [teamData],
  )
  const scope = useMemo(() => parseTimeframe(query), [query])

  const suggestions = useMemo(() => {
    if (!query.trim()) return []

    const rows = []
    const needle = normalized(query)
    const comparisonRequest = ['compare', ' versus ', ' vs ', 'against', 'head to head'].some((word) => needle.includes(word))
    const playerCandidates = findNamedEntities(players, query, 2)
    const teamCandidates = findNamedEntities(teams, query, 2)
    const explicitRole = roleInQuery(query)
    const asksForAnalysis = scope.hasScope || explicitRole || /\b(?:give|show|stats?|statistics|performance|table|leaders?|best|top)\b/.test(needle)
    const playerPopulation = /\bplayers?\b/.test(needle)
    const teamPopulation = /\bteams?\b/.test(needle)
    if (!comparisonRequest && asksForAnalysis && (playerCandidates.length || teamCandidates.length || explicitRole || playerPopulation || teamPopulation)) {
      const player = playerCandidates[0]?.name
      const team = !player ? teamCandidates[0]?.name : ''
      const matchedStatistic = statisticInQuery(query, player || explicitRole || playerPopulation ? 'players' : team || teamPopulation ? 'teams' : '')
      rows.push({
        label: player ? `${player} in context` : team ? `${team} in context` : explicitRole ? `${explicitRole} players` : teamPopulation ? 'Teams in context' : 'Players in context',
        description: player
          ? `Player summary and ${explicitRole || 'inferred-role'} peer table`
          : team ? 'Team summary and scoped team table' : explicitRole ? `All ${explicitRole.toLowerCase()} players in scope` : 'A table built from the requested scope',
        kind: 'Analysis',
        to: analysisPath({ players: player ? [player] : [], teams: team ? [team] : [], role: explicitRole, metric: matchedStatistic?.id || '', population: team || teamPopulation ? 'teams' : 'players' }, scope),
        data: player || explicitRole ? ['player_buckets', 'player_agents'] : ['team_buckets'],
        score: -12,
      })
    }
    const genericEntityQuery = ['player', 'players', 'team', 'teams', 'stat', 'stats', 'statistics'].includes(normalized(query))
    if (!genericEntityQuery) {
      for (const destination of STAT_DESTINATIONS) {
        const score = destinationScore(destination, query)
        if (Number.isFinite(score)) rows.push({ ...destination, kind: 'Statistic', score: score - 4 })
      }
    }
    for (const result of findNamedEntities(players, query, 4)) {
      rows.push({
        label: result.name,
        description: playerData?.meta?.[result.name]?.team || 'Player profile',
        kind: 'Player',
        to: `/players/${encodeURIComponent(result.name)}`,
        score: result.score,
      })
    }
    for (const result of findNamedEntities(teams, query, 3)) {
      rows.push({
        label: result.name,
        description: teamData?.meta?.[result.name]?.region || 'Team profile',
        kind: 'Team',
        to: `/teams/${encodeURIComponent(result.name)}`,
        score: result.score,
      })
    }
    for (const result of findNamedEntities(events, query, 2)) {
      rows.push({
        label: result.name,
        description: 'Event statistics',
        kind: 'Event',
        to: `/tournaments/${encodeURIComponent(result.name)}`,
        score: result.score,
      })
    }

    for (const destination of DESTINATIONS) {
      const score = destinationScore(destination, query)
      if (Number.isFinite(score)) rows.push({ ...destination, kind: 'Explore', score: score + 2 })
    }

    // A timeframe on its own is a useful request. Offer the most common
    // scopes instead of treating “August 2026” as an unrecognized query.
    if (scope.hasScope && rows.length === 0) {
      for (const destination of DESTINATIONS.filter((row) => ['/players', '/teams', '/agents', '/records', '/tournaments'].includes(row.to))) {
        rows.push({ ...destination, kind: 'Explore', score: 40 })
      }
    }

    return rows
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
      .map((row) => ({
        ...row,
        to: withScope(
          row.kind === 'Statistic' ? withExplicitOrder(row.to, explicitSortOrder(query)) : row.to,
          scope,
        ),
        description: scope.label ? `${row.description} · ${scope.label}` : row.description,
      }))
      .filter((row, index, all) => all.findIndex((candidate) => candidate.to === row.to) === index)
      .slice(0, 6)
  }, [events, playerData, players, query, scope, teamData, teams])

  function mentionedPlayers(text) {
    const needle = normalized(text)
    return players
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

  function resolve(text) {
    const needle = normalized(text)
    if (!needle) return null

    const playerMentions = mentionedPlayers(text)
    const wantsComparison = ['compare', ' versus ', ' vs ', 'against', 'head to head'].some((word) => needle.includes(word))
    if (wantsComparison && playerMentions.length >= 2) {
      const params = new URLSearchParams({ a: playerMentions[0], b: playerMentions[1] })
      return withScope(`/compare?${params}`, scope)
    }
    if (wantsComparison && playerMentions.length === 1) {
      return withScope(`/compare?a=${encodeURIComponent(playerMentions[0])}`, scope)
    }

    const playerCandidate = playerMentions[0] || findNamedEntities(players, text, 1)[0]?.name
    const teamCandidate = findNamedEntities(teams, text, 1)[0]?.name
    const explicitRole = roleInQuery(text)
    const asksForAnalysis = scope.hasScope || explicitRole || /\b(?:give|show|stats?|statistics|performance|table|leaders?|best|top)\b/.test(needle)
    const playerPopulation = /\bplayers?\b/.test(needle)
    const teamPopulation = /\bteams?\b/.test(needle)
    if (asksForAnalysis && (playerCandidate || teamCandidate || explicitRole || playerPopulation || teamPopulation)) {
      const matchedStatistic = statisticInQuery(text, playerCandidate || explicitRole || playerPopulation ? 'players' : teamCandidate || teamPopulation ? 'teams' : '')
      return analysisPath({
        players: playerCandidate ? [playerCandidate] : [],
        teams: !playerCandidate && teamCandidate ? [teamCandidate] : [],
        role: explicitRole,
        metric: matchedStatistic?.id || '',
        population: !playerCandidate && (teamCandidate || teamPopulation) ? 'teams' : 'players',
      }, scope)
    }

    const entity = suggestions.find((row) => row.kind !== 'Explore')
    if (entity) return entity.to

    const agent = AGENTS.find((name) => needle.includes(normalized(name)))
    if (agent) return '/agents'

    const destination = [...STAT_DESTINATIONS, ...DESTINATIONS]
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
      const intent = await requestLlmIntent(submittedQuery, controller.signal)
      to = intentToPath(mergeExplicitScope(intent, parseTimeframe(submittedQuery)))
    } catch {
      // Vite has no Pages Function or Workers AI binding. The deterministic
      // resolver is intentionally retained as a fast/offline fallback, and
      // explicit scope terms are merged into LLM results above as guardrails.
      to = resolve(submittedQuery)
    } finally {
      clearTimeout(timeout)
      setInterpreting(false)
    }

    if (to) {
      const destination = [...STAT_DESTINATIONS, ...DESTINATIONS].find((row) => to.startsWith(row.to))
      go(to, destination?.data)
      return
    }
    setMessage('Try a player, team, event, agent, ranking, comparison, record, or economy question.')
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

  const showSuggestions = focused && query.trim() && suggestions.length > 0

  return (
    <div className="start-stage">
      <div className="start-console">
        <div className="start-mark" aria-label="VCT Data">vct <span>/</span> data</div>
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
              onFocus={() => { setFocused(true); setHasFocused(true) }}
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
        <p className="start-message" aria-live="polite">
          {message || 'Try “give me mada stats in Americas 2026 Stage 1”'}
        </p>
      </div>
    </div>
  )
}
