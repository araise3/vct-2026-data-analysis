/**
 * Stat definitions for the Graphics tab (exportable stat cards).
 *
 * Each definition names a stat, says how to compute it from an aggregated
 * entity record (the output of aggregatePlayerBuckets /
 * aggregateTeamBuckets, plus the extra tier sums added below for teams),
 * how to format it, and what the small secondary line next to the big
 * number should say ("959 rounds", "77 maps", ...).
 *
 * `higherIsBetter: false` flips the default sort so "top" means lowest
 * (e.g. first deaths per 24R).
 */

const f2 = (v) => v.toFixed(2)
const f1 = (v) => v.toFixed(1)
const f0 = (v) => Math.round(v).toLocaleString()
const fpct = (v) => `${(v * 100).toFixed(1)}%`

const per24 = (count, rounds) => (rounds ? (count / rounds) * 24 : null)

export const PLAYER_STATS = [
  {
    key: 'avgRating',
    label: 'Rating',
    cardTitle: 'AVG RATING',
    compute: (s) => s.avgRating,
    format: f2,
    secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }),
  },
  {
    key: 'avgAcs',
    label: 'ACS',
    cardTitle: 'AVG COMBAT SCORE',
    compute: (s) => s.avgAcs,
    format: f0,
    secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }),
  },
  {
    key: 'kd',
    label: 'K/D',
    cardTitle: 'K/D RATIO',
    compute: (s) => s.kd,
    format: f2,
    secondary: (s) => ({ value: s.totalDeaths, label: 'deaths' }),
  },
  {
    key: 'avgKast',
    label: 'KAST',
    cardTitle: 'AVG KAST',
    compute: (s) => s.avgKast,
    format: fpct,
    secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }),
  },
  {
    key: 'avgAdr',
    label: 'ADR',
    cardTitle: 'AVG DAMAGE / ROUND',
    compute: (s) => s.avgAdr,
    format: f0,
    secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }),
  },
  {
    key: 'avgHsPct',
    label: 'HS%',
    cardTitle: 'HEADSHOT %',
    compute: (s) => s.avgHsPct,
    format: fpct,
    secondary: (s) => ({ value: s.totalKills, label: 'kills' }),
  },
  {
    key: 'kpr',
    label: 'Kills / round',
    cardTitle: 'KILLS PER ROUND',
    compute: (s) => (s.roundsPlayed ? s.totalKills / s.roundsPlayed : null),
    format: f2,
    secondary: (s) => ({ value: s.totalKills, label: 'kills' }),
  },
  {
    key: 'multi24',
    label: 'Multi-kills / 24R',
    cardTitle: 'AVG MULTI-KILL 24R',
    compute: (s) =>
      per24(s.total2k + s.total3k + s.total4k + s.totalAce, s.roundsPlayed),
    format: f2,
    secondary: (s) => ({
      value: s.total2k + s.total3k + s.total4k + s.totalAce,
      label: 'multi-kills',
    }),
  },
  {
    key: 'fk24',
    label: 'First kills / 24R',
    cardTitle: 'FIRST KILLS PER 24R',
    compute: (s) => per24(s.totalFirstKills, s.roundsPlayed),
    format: f2,
    secondary: (s) => ({ value: s.totalFirstKills, label: 'first kills' }),
  },
  {
    key: 'fd24',
    label: 'First deaths / 24R',
    cardTitle: 'FIRST DEATHS PER 24R',
    compute: (s) => per24(s.totalFirstDeaths, s.roundsPlayed),
    format: f2,
    secondary: (s) => ({ value: s.totalFirstDeaths, label: 'first deaths' }),
    higherIsBetter: false,
  },
  {
    key: 'fkfd',
    label: 'FK : FD ratio',
    cardTitle: 'OPENING DUEL RATIO',
    compute: (s) => (s.totalFirstDeaths ? s.totalFirstKills / s.totalFirstDeaths : null),
    format: f2,
    secondary: (s) => ({ value: s.totalFirstKills, label: 'first kills' }),
  },
  {
    key: 'clutch24',
    label: 'Clutches / 24R',
    cardTitle: 'CLUTCHES PER 24R',
    compute: (s) => per24(s.totalClutches, s.roundsPlayed),
    format: f2,
    secondary: (s) => ({ value: s.totalClutches, label: 'clutches' }),
  },
  {
    key: 'totalClutches',
    label: 'Total clutches',
    cardTitle: 'CLUTCHES WON',
    compute: (s) => s.totalClutches,
    format: f0,
    secondary: (s) => ({ value: s.roundsPlayed, label: 'rounds' }),
  },
  {
    key: 'totalAce',
    label: 'Total aces',
    cardTitle: 'ACES',
    compute: (s) => s.totalAce,
    format: f0,
    secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }),
  },
]

export const TEAM_STATS = [
  {
    key: 'roundWinPct',
    label: 'Round win %',
    cardTitle: 'ROUND WIN%',
    compute: (s) => s.roundWinPct,
    format: fpct,
    secondary: (s) => ({ value: s.tierRounds, label: 'rounds' }),
  },
  {
    key: 'mapWinPct',
    label: 'Map win %',
    cardTitle: 'MAP WIN%',
    compute: (s) => s.mapWinPct,
    format: fpct,
    secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }),
  },
  {
    key: 'matchWinPct',
    label: 'Match win %',
    cardTitle: 'MATCH WIN%',
    compute: (s) => s.matchWinPct,
    format: fpct,
    secondary: (s) => ({ value: s.matchesPlayed, label: 'matches' }),
  },
  {
    key: 'pistolWinPct',
    label: 'Pistol win %',
    cardTitle: 'PISTOL ROUND WIN%',
    compute: (s) => s.pistolWinPct,
    format: fpct,
    secondary: (s) => ({ value: s.pistolPlayed, label: 'pistols' }),
  },
  {
    key: 'fullBuyWinPct',
    label: 'Full-buy win %',
    cardTitle: 'FULL-BUY ROUND WIN%',
    compute: (s) => s.fullBuyWinPct,
    format: fpct,
    secondary: (s) => ({ value: s.fullBuyRounds, label: 'full buys' }),
  },
  {
    key: 'ecoWinPct',
    label: 'Eco win %',
    cardTitle: 'ECO ROUND WIN%',
    compute: (s) => s.ecoWinPct,
    format: fpct,
    secondary: (s) => ({ value: s.ecoRounds, label: 'ecos' }),
  },
  {
    key: 'avgRating',
    label: 'Avg player rating',
    cardTitle: 'AVG PLAYER RATING',
    compute: (s) => s.avgRating,
    format: f2,
    secondary: (s) => ({ value: s.mapsPlayed, label: 'maps' }),
  },
]

/**
 * Extends aggregateTeamBuckets output with buy-tier round win rates,
 * which the Teams page never needed but the graphic cards do.
 */
export function teamTierExtras(buckets) {
  let ecoR = 0, ecoW = 0, fubR = 0, fubW = 0, allR = 0, allW = 0
  for (const b of buckets) {
    ecoR += b.ecoR || 0; ecoW += b.ecoW || 0
    fubR += b.fubR || 0; fubW += b.fubW || 0
    allR += (b.ecoR || 0) + (b.secR || 0) + (b.sebR || 0) + (b.fubR || 0)
    allW += (b.ecoW || 0) + (b.secW || 0) + (b.sebW || 0) + (b.fubW || 0)
  }
  return {
    ecoRounds: ecoR,
    ecoWinPct: ecoR ? ecoW / ecoR : null,
    fullBuyRounds: fubR,
    fullBuyWinPct: fubR ? fubW / fubR : null,
    tierRounds: allR,
    roundWinPct: allR ? allW / allR : null,
  }
}
