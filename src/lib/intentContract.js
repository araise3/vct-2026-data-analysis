import { STAT_IDS, getStatisticById } from './statCatalog.js'

const DESTINATIONS = [
  'players', 'teams', 'agents', 'compositions', 'events',
  'ratings', 'economy', 'records', 'graphics', 'compare', 'statistics', 'analysis',
]

const STATS = STAT_IDS
const COMPETITIONS = ['VCT', 'EWC']
const REGIONS = ['Americas', 'EMEA', 'Pacific', 'China', 'International']
const SPLITS = ['Kickoff', 'Stage 1', 'Stage 2', 'Champions']

export const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    destination: { type: 'string', enum: DESTINATIONS },
    stat: { type: 'string', enum: STATS },
    order: { type: 'string', enum: ['', 'asc', 'desc'] },
    players: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 80 } },
    teams: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 100 } },
    role: { type: 'string', enum: ['', 'Duelist', 'Initiator', 'Controller', 'Sentinel'] },
    population: { type: 'string', enum: ['', 'players', 'teams'] },
    comparePlayers: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 80 } },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        years: { type: 'array', items: { type: 'integer', minimum: 2023, maximum: 2100 } },
        competitions: { type: 'array', items: { type: 'string', enum: COMPETITIONS } },
        regions: { type: 'array', items: { type: 'string', enum: REGIONS } },
        splits: { type: 'array', items: { type: 'string', enum: SPLITS } },
        event: { type: 'string', maxLength: 160 },
        phase: { type: 'string', maxLength: 100 },
        week: { type: 'string', maxLength: 100 },
        from: { type: 'string', maxLength: 10 },
        to: { type: 'string', maxLength: 10 },
      },
      required: ['years', 'competitions', 'regions', 'splits', 'event', 'phase', 'week', 'from', 'to'],
    },
    summary: { type: 'string', maxLength: 180 },
  },
  required: ['destination', 'stat', 'order', 'players', 'teams', 'role', 'population', 'comparePlayers', 'filters', 'summary'],
}

const ROUTES = {
  players: '/players', teams: '/teams', agents: '/agents', compositions: '/compositions',
  events: '/tournaments', ratings: '/ratings', economy: '/economy', records: '/records',
  graphics: '/graphics', compare: '/compare', analysis: '/analysis', statistics: '/analysis',
}

function oneOf(value, allowed, fallback = '') {
  return allowed.includes(value) ? value : fallback
}

function stringList(value, allowed) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item) => allowed.includes(item)))]
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function safeDate(value) {
  const text = safeText(value, 10)
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) return ''
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? text : ''
}

export function sanitizeIntent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const destination = oneOf(raw.destination, DESTINATIONS, '')
  if (!destination) return null
  const filters = raw.filters && typeof raw.filters === 'object' ? raw.filters : {}
  const years = Array.isArray(filters.years)
    ? [...new Set(filters.years.map(Number).filter((year) => Number.isInteger(year) && year >= 2023 && year <= 2100))]
    : []

  return {
    destination,
    stat: oneOf(raw.stat, STATS),
    order: oneOf(raw.order, ['', 'asc', 'desc']),
    players: Array.isArray(raw.players)
      ? raw.players.map((name) => safeText(name, 80)).filter(Boolean).slice(0, 4)
      : [],
    teams: Array.isArray(raw.teams)
      ? raw.teams.map((name) => safeText(name, 100)).filter(Boolean).slice(0, 4)
      : [],
    role: oneOf(raw.role, ['', 'Duelist', 'Initiator', 'Controller', 'Sentinel']),
    population: oneOf(raw.population, ['', 'players', 'teams']),
    comparePlayers: Array.isArray(raw.comparePlayers)
      ? raw.comparePlayers.map((name) => safeText(name, 80)).filter(Boolean).slice(0, 2)
      : [],
    filters: {
      years,
      competitions: stringList(filters.competitions, COMPETITIONS),
      regions: stringList(filters.regions, REGIONS),
      splits: stringList(filters.splits, SPLITS),
      event: safeText(filters.event, 160),
      phase: safeText(filters.phase, 100),
      week: safeText(filters.week, 100),
      from: safeDate(filters.from),
      to: safeDate(filters.to),
    },
    summary: safeText(raw.summary, 180),
  }
}

function addMany(params, key, values) {
  for (const value of values) params.append(key, String(value))
}

/** Build only known internal routes and known facet parameters from an LLM result. */
export function intentToPath(rawIntent) {
  const intent = sanitizeIntent(rawIntent)
  if (!intent) return null

  let path = ROUTES[intent.destination]
  const params = new URLSearchParams()
  if (intent.stat) {
    if (!getStatisticById(intent.stat)) return null
    path = '/analysis'
    params.set('metric', intent.stat)
    if (intent.order) params.set('order', intent.order)
  }
  if (!path) return null
  if (intent.destination === 'analysis' || intent.destination === 'statistics' || intent.stat) {
    addMany(params, 'player', intent.players)
    addMany(params, 'team', intent.teams)
    if (intent.role) params.set('role', intent.role)
    if (intent.population) params.set('population', intent.population)
  }
  if (intent.destination === 'compare') {
    if (intent.comparePlayers[0]) params.set('a', intent.comparePlayers[0])
    if (intent.comparePlayers[1]) params.set('b', intent.comparePlayers[1])
  }

  addMany(params, 'year', intent.filters.years)
  addMany(params, 'competition', intent.filters.competitions)
  addMany(params, 'region', intent.filters.regions)
  addMany(params, 'split', intent.filters.splits)
  if (intent.filters.event) params.set('event', intent.filters.event)
  // Phase/week values are event-scoped in the site's bucket model.
  if (intent.filters.event && intent.filters.phase) {
    params.set('eventPhase', `${intent.filters.event} § ${intent.filters.phase}`)
  }
  if (intent.filters.event && intent.filters.week) {
    params.set('eventWeek', `${intent.filters.event} § ${intent.filters.week}`)
  }
  if (intent.filters.from) params.set('from', intent.filters.from)
  if (intent.filters.to) params.set('to', intent.filters.to)

  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}`
}
