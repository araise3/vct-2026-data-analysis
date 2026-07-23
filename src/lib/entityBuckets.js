/**
 * Helpers for the per-event bucket files (player_buckets.json /
 * team_buckets.json).
 *
 * Buckets are stored keyed only by event id + week, since region, event
 * name, event-level stage and phase are all derivable from those. These
 * helpers expand them into flat records the faceted filter can work on,
 * and re-aggregate any filtered subset.
 *
 * All averages are reconstructed from stored (value x rounds) sums rather
 * than averaging pre-computed averages -- that's what keeps a filtered
 * view's numbers consistent with VLR's own rounds-weighted convention.
 */

export function expandBuckets(data, keyField) {
  const { events, buckets } = data
  return buckets.map((b) => {
    const ev = events[b.e] || {}
    const week = b.w || ''
    return {
      ...b,
      id: b[keyField],
      region: ev.region,
      event: ev.name,
      stage: ev.stage,
      phase: week.includes(':') ? week.split(':')[0].trim() : week,
      week,
      competition: ev.competition,
    }
  })
}

function div(num, den) {
  return den ? num / den : null
}

/** Aggregates player buckets. `ratedOnly` subtracts the sparse unrated delta. */
export function aggregatePlayerBuckets(buckets, { ratedOnly = false } = {}) {
  if (!buckets.length) return null
  const t = {
    maps: 0, rnd: 0, ratS: 0, ratR: 0, acsS: 0, acsM: 0,
    kastS: 0, kastR: 0, adrS: 0, adrR: 0, hsS: 0, hsR: 0,
    k: 0, d: 0, a: 0, fk: 0, fd: 0, m2: 0, m3: 0, m4: 0, m5: 0, cl: 0,
  }
  for (const b of buckets) {
    const u = ratedOnly ? b.u : null
    t.maps += b.maps - (u?.maps || 0)
    t.rnd += b.rnd - (u?.rnd || 0)
    t.ratS += b.ratS
    t.ratR += b.ratR
    t.acsS += b.acsS - (u?.acsS || 0)
    t.acsM += b.acsM - (u?.acsM || 0)
    t.kastS += b.kastS - (u?.kastS || 0)
    t.kastR += b.kastR - (u?.kastR || 0)
    t.adrS += b.adrS - (u?.adrS || 0)
    t.adrR += b.adrR - (u?.adrR || 0)
    t.hsS += b.hsS - (u?.hsS || 0)
    t.hsR += b.hsR - (u?.hsR || 0)
    t.k += b.k - (u?.k || 0)
    t.d += b.d - (u?.d || 0)
    t.a += b.a - (u?.a || 0)
    t.fk += b.fk - (u?.fk || 0)
    t.fd += b.fd - (u?.fd || 0)
    t.m2 += b.m2; t.m3 += b.m3; t.m4 += b.m4; t.m5 += b.m5; t.cl += b.cl
  }
  return {
    mapsPlayed: t.maps,
    roundsPlayed: t.rnd,
    avgRating: div(t.ratS, t.ratR),
    avgAcs: div(t.acsS, t.acsM),
    totalKills: t.k,
    totalDeaths: t.d,
    kd: div(t.k, t.d),
    totalAssists: t.a,
    avgKast: div(t.kastS, t.kastR),
    avgAdr: div(t.adrS, t.adrR),
    avgHsPct: div(t.hsS, t.hsR),
    totalFirstKills: t.fk,
    totalFirstDeaths: t.fd,
    total2k: t.m2, total3k: t.m3, total4k: t.m4, totalAce: t.m5,
    totalClutches: t.cl,
  }
}

export function aggregateTeamBuckets(buckets) {
  if (!buckets.length) return null
  const t = { mP: 0, mW: 0, mapP: 0, mapW: 0, rnd: 0, pisW: 0, ratS: 0, ratR: 0 }
  for (const b of buckets) {
    t.mP += b.mP || 0; t.mW += b.mW || 0
    t.mapP += b.mapP || 0; t.mapW += b.mapW || 0
    t.rnd += b.rnd || 0; t.pisW += b.pisW || 0
    t.ratS += b.ratS || 0; t.ratR += b.ratR || 0
  }
  const pistolPlayed = t.mapP * 2
  return {
    matchesPlayed: t.mP,
    matchesWon: t.mW,
    matchWinPct: div(t.mW, t.mP),
    mapsPlayed: t.mapP,
    mapsWon: t.mapW,
    mapWinPct: div(t.mapW, t.mapP),
    roundsPlayed: t.rnd,
    pistolWon: t.pisW,
    pistolPlayed,
    pistolWinPct: div(t.pisW, pistolPlayed),
    avgRating: div(t.ratS, t.ratR),
  }
}

/** Groups filtered bucket records by their entity id. */
export function groupByEntity(records) {
  const out = new Map()
  for (const r of records) {
    if (!out.has(r.id)) out.set(r.id, [])
    out.get(r.id).push(r)
  }
  return out
}

const BUY_TIERS = [
  { key: 'eco', label: 'Eco', r: 'ecoR', w: 'ecoW' },
  { key: 'semiEco', label: 'Semi-eco', r: 'secR', w: 'secW' },
  { key: 'semiBuy', label: 'Semi-buy', r: 'sebR', w: 'sebW' },
  { key: 'fullBuy', label: 'Full buy', r: 'fubR', w: 'fubW' },
]

/** Buy-type distribution and win rates, summed from team buckets. */
export function aggregateEconomyBuckets(buckets) {
  const tiers = BUY_TIERS.map(({ key, label, r, w }) => {
    let rounds = 0
    let won = 0
    for (const b of buckets) {
      rounds += b[r] || 0
      won += b[w] || 0
    }
    return { key, label, rounds, won, winPct: rounds ? won / rounds : null }
  })
  const totalRounds = tiers.reduce((n, t) => n + t.rounds, 0)
  return {
    tiers: tiers.map((t) => ({ ...t, share: totalRounds ? t.rounds / totalRounds : 0 })),
    totalRounds,
  }
}

/** Season-level counts for the Overview KPIs. */
export function aggregateOverview(teamRecords, playerRecords) {
  let matches = 0
  let maps = 0
  let rounds = 0
  const events = new Set()
  const teams = new Set()
  for (const b of teamRecords) {
    matches += b.mP || 0
    maps += b.mapP || 0
    rounds += b.rnd || 0
    events.add(b.e)
    teams.add(b.id)
  }
  const players = new Set(playerRecords.map((b) => b.id))
  // Every match/map/round appears once per team in these buckets, so the
  // raw sums double-count at the competition level.
  return {
    totalEvents: events.size,
    totalMatches: Math.round(matches / 2),
    totalMaps: Math.round(maps / 2),
    totalRounds: Math.round(rounds / 2),
    totalPlayers: players.size,
    totalTeams: teams.size,
  }
}
