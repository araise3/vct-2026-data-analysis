import { STAT_CATALOG } from './statCatalog'

const PLAYER_TOTAL_IDS = new Set([
  'players.total-clutches', 'players.total-plants', 'players.total-defuses', 'players.total-ace',
  'players.maps-played', 'players.maps-won', 'players.maps-lost',
  'players.rounds-played', 'players.rounds-won', 'players.rounds-lost',
  'players.total-kills', 'players.total-deaths',
  'players.total-assists', 'players.total-first-kills', 'players.total-first-deaths',
  'players.total2k', 'players.total3k', 'players.total4k',
])

const PLAYER_RATE_IDS = new Set([
  'players.win-pct', 'players.round-win-pct', 'players.kpr', 'players.dpr', 'players.apr',
  'players.fkpr', 'players.fdpr', 'players.multi-kills-per-map', 'players.multi24',
  'players.fk24', 'players.fd24', 'players.fkfd', 'players.clutch24',
])

const MATCH_SHAPE_IDS = new Set([
  'teams.avg-map-length', 'teams.avg-map-duration', 'teams.avg-series-length',
  'teams.series-duration', 'teams.map-duration',
])

const TEAM_ECONOMY_IDS = new Set([
  'teams.full-buy-win-pct', 'teams.eco-win-pct', 'teams.semi-eco-win-pct',
  'teams.semi-buy-win-pct', 'teams.post-pistol-anti-eco-win-pct',
  'teams.bonus-win-pct', 'teams.anti-eco-win-pct', 'teams.eco-won',
  'teams.semi-eco-won', 'teams.semi-buy-won', 'teams.full-buy-won',
  'teams.post-pistol-anti-eco-won', 'teams.bonus-won', 'teams.anti-eco-won',
])

const TEAM_SITUATION_IDS = new Set([
  'teams.round-win-pct', 'teams.pistol-win-pct', 'teams.pistol-won',
  'teams.atk-win-pct', 'teams.atk-won', 'teams.def-win-pct', 'teams.def-won',
  'teams.ot-win-pct', 'teams.ot-won', 'teams.comeback-pct', 'teams.comeback-won',
])

const TEAM_WIN_CONDITION_IDS = new Set([
  'teams.elim-pct', 'teams.defuse-pct', 'teams.boom-pct', 'teams.time-pct',
  'teams.elim-wins', 'teams.defuse-wins', 'teams.boom-wins', 'teams.time-wins',
])

const GROUP_DEFINITIONS = [
  { id: 'player-performance', label: 'Player performance', description: 'Averages, impact, efficiency, and consistency' },
  { id: 'player-rates', label: 'Player rates', description: 'Per-round, per-map, opening, and win rates' },
  { id: 'player-totals', label: 'Player totals', description: 'Volume, wins, objectives, and multi-kill tiers' },
  { id: 'team-results', label: 'Team results', description: 'Win rates, ratings, and volume' },
  { id: 'round-situations', label: 'Sides & situations', description: 'Attack, defense, pistols, overtime, and comebacks' },
  { id: 'economy', label: 'Economy', description: 'Every buy tier, anti-ecos, conversions, and bonuses' },
  { id: 'win-conditions', label: 'Win conditions', description: 'Elimination, defuse, detonation, and time expiry' },
  { id: 'match-shape', label: 'Match lengths', description: 'Maps, series, and clock time' },
]

function groupId(statistic) {
  if (MATCH_SHAPE_IDS.has(statistic.id)) return 'match-shape'
  if (PLAYER_TOTAL_IDS.has(statistic.id)) return 'player-totals'
  if (PLAYER_RATE_IDS.has(statistic.id)) return 'player-rates'
  if (TEAM_ECONOMY_IDS.has(statistic.id)) return 'economy'
  if (TEAM_SITUATION_IDS.has(statistic.id)) return 'round-situations'
  if (TEAM_WIN_CONDITION_IDS.has(statistic.id)) return 'win-conditions'
  return statistic.entity === 'players' ? 'player-performance' : 'team-results'
}

function libraryEntry(statistic, overrides = {}) {
  return {
    id: overrides.id || statistic.id,
    entity: statistic.entity,
    label: overrides.label || statistic.searchLabel.replace(/^(?:Player|Team) /, ''),
    fullLabel: overrides.fullLabel || statistic.searchLabel,
    metricLabel: overrides.metricLabel || statistic.definition.label,
    matchLevel: statistic.definition.matchLevel,
    data: statistic.data,
    search: `?metric=${encodeURIComponent(statistic.id)}${overrides.order ? `&order=${overrides.order}` : ''}`,
    groupId: groupId(statistic),
  }
}

export const STAT_LIBRARY_ENTRIES = STAT_CATALOG.flatMap((statistic) => {
  if (statistic.id === 'teams.series-duration') {
    return [
      libraryEntry(statistic, { id: `${statistic.id}.longest`, label: 'Longest series', fullLabel: 'Longest series', metricLabel: 'Series duration', order: 'desc' }),
      libraryEntry(statistic, { id: `${statistic.id}.shortest`, label: 'Shortest series', fullLabel: 'Shortest series', metricLabel: 'Series duration', order: 'asc' }),
    ]
  }
  if (statistic.id === 'teams.map-duration') {
    return [
      libraryEntry(statistic, { id: `${statistic.id}.longest`, label: 'Longest map', fullLabel: 'Longest map', metricLabel: 'Map duration', order: 'desc' }),
      libraryEntry(statistic, { id: `${statistic.id}.shortest`, label: 'Shortest map', fullLabel: 'Shortest map', metricLabel: 'Map duration', order: 'asc' }),
    ]
  }
  return [libraryEntry(statistic)]
})

export const STAT_LIBRARY_GROUPS = GROUP_DEFINITIONS.map((group) => ({
  ...group,
  statistics: STAT_LIBRARY_ENTRIES.filter((statistic) => statistic.groupId === group.id),
}))
