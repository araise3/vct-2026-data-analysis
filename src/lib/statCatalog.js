import { PLAYER_STATS, TEAM_STATS } from './statDefs.js'

const integer = (value) => Math.round(value).toLocaleString('en-US')
const decimal = (value) => value.toFixed(2)

// The graphics builder intentionally exposes a curated subset. Searchable
// statistic pages also cover the remaining raw/rate columns people can see
// in the Players and Teams tables, without expanding Graphics' picker as a
// side effect of this routing feature.
const EXTRA_PLAYER_STATS = [
  { key: 'mapsPlayed', label: 'Maps played', cardTitle: 'MAPS PLAYED', compute: (s) => s.mapsPlayed, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'roundsPlayed', label: 'Rounds played', cardTitle: 'ROUNDS PLAYED', compute: (s) => s.roundsPlayed, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'totalKills', label: 'Total kills', cardTitle: 'TOTAL KILLS', compute: (s) => s.totalKills, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalDeaths', label: 'Total deaths', cardTitle: 'TOTAL DEATHS', compute: (s) => s.totalDeaths, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalAssists', label: 'Total assists', cardTitle: 'TOTAL ASSISTS', compute: (s) => s.totalAssists, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalFirstKills', label: 'Total first kills', cardTitle: 'TOTAL FIRST KILLS', compute: (s) => s.totalFirstKills, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalFirstDeaths', label: 'Total first deaths', cardTitle: 'TOTAL FIRST DEATHS', compute: (s) => s.totalFirstDeaths, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'apr', label: 'Assists / round', cardTitle: 'ASSISTS PER ROUND', compute: (s) => s.roundsPlayed ? s.totalAssists / s.roundsPlayed : null, format: decimal, secondary: (s) => ({ value: s.totalAssists, label: 'assists' }) },
  { key: 'fkpr', label: 'First kills / round', cardTitle: 'FIRST KILLS PER ROUND', compute: (s) => s.roundsPlayed ? s.totalFirstKills / s.roundsPlayed : null, format: decimal, secondary: (s) => ({ value: s.totalFirstKills, label: 'first kills' }) },
  { key: 'fdpr', label: 'First deaths / round', cardTitle: 'FIRST DEATHS PER ROUND', compute: (s) => s.roundsPlayed ? s.totalFirstDeaths / s.roundsPlayed : null, format: decimal, secondary: (s) => ({ value: s.totalFirstDeaths, label: 'first deaths' }), higherIsBetter: false },
]

const EXTRA_TEAM_STATS = [
  { key: 'matchesPlayed', label: 'Matches played', cardTitle: 'MATCHES PLAYED', compute: (s) => s.matchesPlayed, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'mapsPlayed', label: 'Maps played', cardTitle: 'MAPS PLAYED', compute: (s) => s.mapsPlayed, format: integer, secondary: (s) => ({ value: s.matchesPlayed, label: 'matches' }) },
  { key: 'roundsPlayed', label: 'Rounds played', cardTitle: 'ROUNDS PLAYED', compute: (s) => s.roundsPlayed, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
]

const SEARCH_OVERRIDES = {
  'players.avg-rating': ['player rating', 'rating 2.0', 'average rating'],
  'players.avg-acs': ['average combat score', 'combat score'],
  'players.kd': ['k d', 'kill death ratio', 'kills deaths ratio'],
  'players.avg-kast': ['kill assist survive trade', 'kast percentage'],
  'players.avg-adr': ['average damage per round', 'damage per round'],
  'players.avg-hs-pct': ['headshot percentage', 'headshot rate', 'hs percentage'],
  'players.maps-played': ['most maps', 'player maps'],
  'players.rounds-played': ['most rounds', 'player rounds'],
  'players.total-kills': ['most kills', 'player kills'],
  'players.total-deaths': ['most deaths', 'player deaths'],
  'players.total-assists': ['most assists', 'player assists'],
  'players.total-first-kills': ['most first kills', 'opening kills total'],
  'players.total-first-deaths': ['most first deaths', 'opening deaths total'],
  'players.apr': ['assists per round', 'apr'],
  'players.fkpr': ['first kills per round', 'fkpr'],
  'players.fdpr': ['first deaths per round', 'fdpr'],
  'players.kpr': ['kills per round'],
  'players.multi24': ['multi kills', 'multikills', 'multi kills per 24 rounds'],
  'players.fk24': ['first kills', 'opening kills'],
  'players.fd24': ['first deaths', 'opening deaths'],
  'players.fkfd': ['opening duel ratio', 'first kill first death ratio'],
  'players.clutch24': ['clutches per round', 'clutch rate'],
  'players.total-clutches': ['most clutches', 'clutch wins'],
  'players.rating-sd': ['most consistent', 'rating consistency', 'rating standard deviation'],
  'players.avg-econ': ['economy rating', 'econ rating'],
  'players.total-plants': ['most plants', 'spike plants'],
  'players.total-defuses': ['most defuses', 'spike defuses'],
  'players.total-ace': ['most aces', 'five kill rounds', '5k rounds'],
  'teams.round-win-pct': ['round win rate', 'round win percentage'],
  'teams.matches-played': ['most matches', 'team matches'],
  'teams.maps-played': ['most team maps', 'team maps played'],
  'teams.rounds-played': ['most team rounds', 'team rounds played'],
  'teams.map-win-pct': ['map win rate', 'map win percentage'],
  'teams.match-win-pct': ['match win rate', 'series win rate'],
  'teams.avg-map-length': ['rounds per map', 'map length'],
  'teams.avg-map-duration': ['average map time', 'average map duration', 'map duration'],
  'teams.avg-series-length': ['maps per series', 'series length'],
  'teams.pistol-win-pct': ['pistol win rate', 'pistol rounds'],
  'teams.full-buy-win-pct': ['full buy win rate', 'full buy rounds'],
  'teams.eco-win-pct': ['eco win rate', 'economy round win rate'],
  'teams.atk-win-pct': ['attack win rate', 'attack side'],
  'teams.def-win-pct': ['defense win rate', 'defence win rate', 'defense side', 'defence side'],
  'teams.post-pistol-anti-eco-win-pct': ['post pistol anti eco'],
  'teams.bonus-win-pct': ['bonus win rate', 'bonus rounds'],
  'teams.anti-eco-win-pct': ['anti eco win rate', 'anti eco rounds'],
  'teams.ot-win-pct': ['overtime win rate', 'ot win rate'],
  'teams.comeback-pct': ['comeback rate', 'comebacks'],
  'teams.elim-pct': ['round wins by elimination', 'elimination win condition'],
  'teams.defuse-pct': ['round wins by defuse', 'defuse win condition'],
  'teams.boom-pct': ['round wins by detonation', 'spike detonation win condition'],
  'teams.avg-rating': ['team average player rating', 'average team rating'],
  'teams.series-duration': ['longest series', 'shortest series', 'series duration', 'match duration'],
  'teams.map-duration': ['longest map', 'shortest map', 'map duration'],
}

const SEARCH_LABELS = {
  'players.total-clutches': 'Most clutches',
  'players.total-plants': 'Most spike plants',
  'players.total-defuses': 'Most defuses',
  'players.total-ace': 'Most aces',
  'players.total-kills': 'Most kills',
  'players.total-deaths': 'Most deaths',
  'players.total-assists': 'Most assists',
  'players.total-first-kills': 'Most first kills',
  'players.total-first-deaths': 'Most first deaths',
  'players.rating-sd': 'Player consistency',
  'teams.series-duration': 'Series duration',
  'teams.map-duration': 'Map duration',
}

export function statKeyToSlug(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function buildEntry(entity, definition) {
  const slug = statKeyToSlug(definition.key)
  const id = `${entity}.${slug}`
  const entityLabel = entity === 'players' ? 'Player' : definition.matchLevel ? 'Matchup' : 'Team'
  const searchLabel = SEARCH_LABELS[id] || `${entityLabel} ${definition.label}`
  const keywords = [
    definition.label,
    definition.cardTitle,
    searchLabel,
    ...(SEARCH_OVERRIDES[id] || []),
  ].filter(Boolean)

  return {
    id,
    entity,
    slug,
    key: definition.key,
    definition,
    searchLabel,
    keywords,
    to: `/statistics/${entity}/${slug}`,
    data: definition.matchLevel
      ? [definition.matchLevel === 'series' ? 'series_length' : 'map_length']
      : [entity === 'players' ? 'player_buckets' : 'team_buckets'],
    description: definition.matchLevel
      ? `Dedicated ${definition.matchLevel} leaderboard with event and date filters`
      : `Dedicated ${entityLabel.toLowerCase()} leaderboard for ${definition.label.toLowerCase()}`,
  }
}

export const STAT_CATALOG = [
  ...[...PLAYER_STATS, ...EXTRA_PLAYER_STATS].map((definition) => buildEntry('players', definition)),
  ...[...TEAM_STATS, ...EXTRA_TEAM_STATS].map((definition) => buildEntry('teams', definition)),
]

export const STAT_IDS = ['', ...STAT_CATALOG.map((entry) => entry.id)]

export function getStatistic(entity, slug) {
  return STAT_CATALOG.find((entry) => entry.entity === entity && entry.slug === slug) || null
}

export function getStatisticById(id) {
  return STAT_CATALOG.find((entry) => entry.id === id) || null
}
