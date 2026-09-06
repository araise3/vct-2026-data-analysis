import { PLAYER_STATS, TEAM_STATS } from './statDefs.js'

const integer = (value) => Math.round(value).toLocaleString('en-US')
const decimal = (value) => value.toFixed(2)
const percent = (value) => `${(value * 100).toFixed(1)}%`
const conditionCount = (condition) => (stats) => {
  const conditions = stats.winConditions
  if (!conditions || !Object.values(conditions).some(Boolean)) return null
  return conditions[condition] || 0
}

// The graphics builder intentionally exposes a curated subset. Searchable
// statistic pages also cover the remaining raw/rate columns people can see
// in the Players and Teams tables, without expanding Graphics' picker as a
// side effect of this routing feature.
const EXTRA_PLAYER_STATS = [
  { key: 'mapsPlayed', label: 'Maps played', cardTitle: 'MAPS PLAYED', compute: (s) => s.mapsPlayed, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'mapsWon', label: 'Maps won', cardTitle: 'MAPS WON', compute: (s) => s.mapsWon, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'mapsLost', label: 'Maps lost', cardTitle: 'MAPS LOST', compute: (s) => s.mapsLost, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'winPct', label: 'Map win %', cardTitle: 'MAP WIN%', compute: (s) => s.winPct, format: percent, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'roundsPlayed', label: 'Rounds played', cardTitle: 'ROUNDS PLAYED', compute: (s) => s.roundsPlayed, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'roundsWon', label: 'Rounds won', cardTitle: 'ROUNDS WON', compute: (s) => s.roundsWon, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'roundsLost', label: 'Rounds lost', cardTitle: 'ROUNDS LOST', compute: (s) => s.roundsLost, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'roundWinPct', label: 'Round win %', cardTitle: 'ROUND WIN%', compute: (s) => s.roundWinPct, format: percent, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalKills', label: 'Total kills', cardTitle: 'TOTAL KILLS', compute: (s) => s.totalKills, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalDeaths', label: 'Total deaths', cardTitle: 'TOTAL DEATHS', compute: (s) => s.totalDeaths, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalAssists', label: 'Total assists', cardTitle: 'TOTAL ASSISTS', compute: (s) => s.totalAssists, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalFirstKills', label: 'Total first kills', cardTitle: 'TOTAL FIRST KILLS', compute: (s) => s.totalFirstKills, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'totalFirstDeaths', label: 'Total first deaths', cardTitle: 'TOTAL FIRST DEATHS', compute: (s) => s.totalFirstDeaths, format: integer, secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }) },
  { key: 'apr', label: 'Assists / round', cardTitle: 'ASSISTS PER ROUND', compute: (s) => s.roundsPlayed ? s.totalAssists / s.roundsPlayed : null, format: decimal, secondary: (s) => ({ value: s.totalAssists, label: 'assists' }) },
  { key: 'dpr', label: 'Deaths / round', cardTitle: 'DEATHS PER ROUND', compute: (s) => s.dpr, format: decimal, secondary: (s) => ({ value: s.totalDeaths, label: 'deaths' }), higherIsBetter: false },
  { key: 'fkpr', label: 'First kills / round', cardTitle: 'FIRST KILLS PER ROUND', compute: (s) => s.roundsPlayed ? s.totalFirstKills / s.roundsPlayed : null, format: decimal, secondary: (s) => ({ value: s.totalFirstKills, label: 'first kills' }) },
  { key: 'fdpr', label: 'First deaths / round', cardTitle: 'FIRST DEATHS PER ROUND', compute: (s) => s.roundsPlayed ? s.totalFirstDeaths / s.roundsPlayed : null, format: decimal, secondary: (s) => ({ value: s.totalFirstDeaths, label: 'first deaths' }), higherIsBetter: false },
  { key: 'multiKillsPerMap', label: 'Multi-kills / map', cardTitle: 'MULTI-KILLS PER MAP', compute: (s) => s.multiKillsPerMap, format: decimal, secondary: (s) => ({ value: s.utilMaps, label: 'maps tracked' }) },
  { key: 'total2k', label: '2K rounds', cardTitle: 'TWO-KILL ROUNDS', compute: (s) => s.utilMaps ? s.total2k : null, format: integer, secondary: (s) => ({ value: s.utilMaps, label: 'maps tracked' }) },
  { key: 'total3k', label: '3K rounds', cardTitle: 'THREE-KILL ROUNDS', compute: (s) => s.utilMaps ? s.total3k : null, format: integer, secondary: (s) => ({ value: s.utilMaps, label: 'maps tracked' }) },
  { key: 'total4k', label: '4K rounds', cardTitle: 'FOUR-KILL ROUNDS', compute: (s) => s.utilMaps ? s.total4k : null, format: integer, secondary: (s) => ({ value: s.utilMaps, label: 'maps tracked' }) },
]

const EXTRA_TEAM_STATS = [
  { key: 'matchesPlayed', label: 'Matches played', cardTitle: 'MATCHES PLAYED', compute: (s) => s.matchesPlayed, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'matchesWon', label: 'Matches won', cardTitle: 'MATCHES WON', compute: (s) => s.matchesWon, format: integer, secondary: (s) => ({ value: s.matchesPlayed, label: 'matches' }) },
  { key: 'matchesLost', label: 'Matches lost', cardTitle: 'MATCHES LOST', compute: (s) => s.matchesLost, format: integer, secondary: (s) => ({ value: s.matchesPlayed, label: 'matches' }) },
  { key: 'mapsPlayed', label: 'Maps played', cardTitle: 'MAPS PLAYED', compute: (s) => s.mapsPlayed, format: integer, secondary: (s) => ({ value: s.matchesPlayed, label: 'matches' }) },
  { key: 'mapsWon', label: 'Maps won', cardTitle: 'MAPS WON', compute: (s) => s.mapsWon, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'mapsLost', label: 'Maps lost', cardTitle: 'MAPS LOST', compute: (s) => s.mapsLost, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'roundsPlayed', label: 'Rounds played', cardTitle: 'ROUNDS PLAYED', compute: (s) => s.roundsPlayed, format: integer, secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }) },
  { key: 'roundsWon', label: 'Rounds won', cardTitle: 'ROUNDS WON', compute: (s) => s.roundsWon, format: integer, secondary: (s) => ({ value: s.roundsTracked, label: 'rounds tracked' }) },
  { key: 'roundsLost', label: 'Rounds lost', cardTitle: 'ROUNDS LOST', compute: (s) => s.roundsLost, format: integer, secondary: (s) => ({ value: s.roundsTracked, label: 'rounds tracked' }) },
  { key: 'pistolWon', label: 'Pistol rounds won', cardTitle: 'PISTOL ROUNDS WON', compute: (s) => s.pistolWon, format: integer, secondary: (s) => ({ value: s.pistolPlayed, label: 'pistols' }) },
  { key: 'atkWon', label: 'Attack rounds won', cardTitle: 'ATTACK ROUNDS WON', compute: (s) => s.atkWon, format: integer, secondary: (s) => ({ value: s.atkRounds, label: 'attack rounds' }) },
  { key: 'defWon', label: 'Defense rounds won', cardTitle: 'DEFENSE ROUNDS WON', compute: (s) => s.defWon, format: integer, secondary: (s) => ({ value: s.defRounds, label: 'defense rounds' }) },
  { key: 'otWon', label: 'Overtime maps won', cardTitle: 'OVERTIME MAPS WON', compute: (s) => s.otMaps ? s.otWon : null, format: integer, secondary: (s) => ({ value: s.otMaps, label: 'OT maps' }) },
  { key: 'comebackWon', label: 'Comebacks completed', cardTitle: 'COMEBACKS COMPLETED', compute: (s) => s.comebackMaps ? s.comebackWon : null, format: integer, secondary: (s) => ({ value: s.comebackMaps, label: 'opportunities' }) },
  { key: 'semiEcoWinPct', label: 'Semi-eco win %', cardTitle: 'SEMI-ECO ROUND WIN%', compute: (s) => s.semiEcoWinPct, format: percent, secondary: (s) => ({ value: s.semiEcoRounds, label: 'semi-ecos' }) },
  { key: 'semiBuyWinPct', label: 'Semi-buy win %', cardTitle: 'SEMI-BUY ROUND WIN%', compute: (s) => s.semiBuyWinPct, format: percent, secondary: (s) => ({ value: s.semiBuyRounds, label: 'semi-buys' }) },
  { key: 'ecoWon', label: 'Eco rounds won', cardTitle: 'ECO ROUNDS WON', compute: (s) => s.ecoRounds ? s.ecoWon : null, format: integer, secondary: (s) => ({ value: s.ecoRounds, label: 'ecos' }) },
  { key: 'semiEcoWon', label: 'Semi-eco rounds won', cardTitle: 'SEMI-ECO ROUNDS WON', compute: (s) => s.semiEcoRounds ? s.semiEcoWon : null, format: integer, secondary: (s) => ({ value: s.semiEcoRounds, label: 'semi-ecos' }) },
  { key: 'semiBuyWon', label: 'Semi-buy rounds won', cardTitle: 'SEMI-BUY ROUNDS WON', compute: (s) => s.semiBuyRounds ? s.semiBuyWon : null, format: integer, secondary: (s) => ({ value: s.semiBuyRounds, label: 'semi-buys' }) },
  { key: 'fullBuyWon', label: 'Full-buy rounds won', cardTitle: 'FULL-BUY ROUNDS WON', compute: (s) => s.fullBuyRounds ? s.fullBuyWon : null, format: integer, secondary: (s) => ({ value: s.fullBuyRounds, label: 'full buys' }) },
  { key: 'postPistolAntiEcoWon', label: 'Post-pistol conversions', cardTitle: 'POST-PISTOL CONVERSIONS', compute: (s) => s.postPistolAntiEcoRounds ? s.postPistolAntiEcoWon : null, format: integer, secondary: (s) => ({ value: s.postPistolAntiEcoRounds, label: 'opportunities' }) },
  { key: 'bonusWon', label: 'Bonus rounds won', cardTitle: 'BONUS ROUNDS WON', compute: (s) => s.bonusRounds ? s.bonusWon : null, format: integer, secondary: (s) => ({ value: s.bonusRounds, label: 'bonus rounds' }) },
  { key: 'antiEcoWon', label: 'Anti-eco rounds won', cardTitle: 'ANTI-ECO ROUNDS WON', compute: (s) => s.antiEcoRounds ? s.antiEcoWon : null, format: integer, secondary: (s) => ({ value: s.antiEcoRounds, label: 'anti-ecos' }) },
  { key: 'elimWins', label: 'Wins by elimination', cardTitle: 'ROUNDS WON BY ELIMINATION', compute: conditionCount('elim'), format: integer, secondary: (s) => ({ value: s.roundsTracked, label: 'rounds tracked' }) },
  { key: 'defuseWins', label: 'Wins by defuse', cardTitle: 'ROUNDS WON BY DEFUSE', compute: conditionCount('defuse'), format: integer, secondary: (s) => ({ value: s.roundsTracked, label: 'rounds tracked' }) },
  { key: 'boomWins', label: 'Wins by detonation', cardTitle: 'ROUNDS WON BY DETONATION', compute: conditionCount('boom'), format: integer, secondary: (s) => ({ value: s.roundsTracked, label: 'rounds tracked' }) },
  { key: 'timeWins', label: 'Wins by time expiry', cardTitle: 'ROUNDS WON BY TIME EXPIRY', compute: conditionCount('time'), format: integer, secondary: (s) => ({ value: s.roundsTracked, label: 'rounds tracked' }) },
  { key: 'timePct', label: 'Round wins by time expiry %', cardTitle: 'ROUND WINS BY TIME EXPIRY', compute: (s) => {
    const conditions = s.winConditions
    if (!conditions) return null
    const total = Object.values(conditions).reduce((sum, count) => sum + count, 0)
    return total ? (conditions.time || 0) / total : null
  }, format: percent, secondary: (s) => ({ value: s.winConditions?.time || 0, label: 'rounds' }) },
]

const SEARCH_OVERRIDES = {
  'players.avg-rating': ['player rating', 'rating 2.0', 'average rating'],
  'players.avg-acs': ['average combat score', 'combat score'],
  'players.kd': ['k d', 'kill death ratio', 'kills deaths ratio'],
  'players.avg-kast': ['kill assist survive trade', 'kast percentage'],
  'players.avg-adr': ['average damage per round', 'damage per round'],
  'players.avg-hs-pct': ['headshot percentage', 'headshot rate', 'hs percentage'],
  'players.maps-played': ['most maps', 'player maps'],
  'players.maps-won': ['player map wins', 'most maps won by a player'],
  'players.maps-lost': ['player map losses', 'most maps lost by a player'],
  'players.win-pct': ['player map win rate', 'player map win percentage'],
  'players.rounds-played': ['most rounds', 'player rounds'],
  'players.rounds-won': ['player round wins', 'most rounds won by a player'],
  'players.rounds-lost': ['player round losses', 'most rounds lost by a player'],
  'players.round-win-pct': ['player round win rate', 'player round win percentage'],
  'players.total-kills': ['most kills', 'player kills'],
  'players.total-deaths': ['most deaths', 'player deaths'],
  'players.total-assists': ['most assists', 'player assists'],
  'players.total-first-kills': ['most first kills', 'opening kills total'],
  'players.total-first-deaths': ['most first deaths', 'opening deaths total'],
  'players.apr': ['assists per round', 'apr'],
  'players.dpr': ['deaths per round', 'dpr'],
  'players.fkpr': ['first kills per round', 'fkpr'],
  'players.fdpr': ['first deaths per round', 'fdpr'],
  'players.multi-kills-per-map': ['multi kills per map', 'multikills per map'],
  'players.total2k': ['two kill rounds', '2k rounds', 'double kills'],
  'players.total3k': ['three kill rounds', '3k rounds', 'triple kills'],
  'players.total4k': ['four kill rounds', '4k rounds', 'quad kills'],
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
  'teams.rounds-won': ['team round wins', 'most rounds won by a team'],
  'teams.rounds-lost': ['team round losses', 'most rounds lost by a team'],
  'teams.matches-won': ['team match wins', 'most matches won'],
  'teams.matches-lost': ['team match losses', 'most matches lost'],
  'teams.maps-won': ['team map wins', 'most maps won by a team'],
  'teams.maps-lost': ['team map losses', 'most maps lost by a team'],
  'teams.map-win-pct': ['map win rate', 'map win percentage'],
  'teams.match-win-pct': ['match win rate', 'series win rate'],
  'teams.avg-map-length': ['rounds per map', 'map length'],
  'teams.avg-map-duration': ['average map time', 'average map duration', 'map duration'],
  'teams.avg-series-length': ['maps per series', 'series length'],
  'teams.pistol-win-pct': ['pistol win rate', 'pistol rounds'],
  'teams.full-buy-win-pct': ['full buy win rate', 'full buy rounds'],
  'teams.eco-win-pct': ['eco win rate', 'economy round win rate'],
  'teams.semi-eco-win-pct': ['semi eco win rate', 'semi eco rounds'],
  'teams.semi-buy-win-pct': ['semi buy win rate', 'semi buy rounds'],
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
  'teams.time-pct': ['round wins by time', 'time expiry win condition', 'time expired wins'],
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
