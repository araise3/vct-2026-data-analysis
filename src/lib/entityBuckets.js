/**
 * Helpers for the per-event bucket files (player_buckets.json /
 * team_buckets.json).
 *
 * Buckets are stored keyed only by event id + week, since region, event
 * name, phase and week are all derivable from those. These
 * helpers expand them into flat records the faceted filter can work on,
 * and re-aggregate any filtered subset.
 *
 * All averages are reconstructed from stored (value x rounds) sums rather
 * than averaging pre-computed averages -- that's what keeps a filtered
 * view's numbers consistent with VLR's own rounds-weighted convention.
 */

/**
 * Separator for event-scoped facet values. Phase and week names ("Week 2",
 * "Playoffs") repeat across every event, so filtering on the bare name
 * would silently match that week in *all* events at once. Prefixing with
 * the event name makes each value refer to one specific event's week, and
 * FilterPanel splits on this to render them grouped under their event.
 */
export const SCOPE_SEP = ' \u00a7 '

export function scopeValue(event, value) {
  return `${event}${SCOPE_SEP}${value}`
}

export function unscopeValue(scoped) {
  const i = scoped.indexOf(SCOPE_SEP)
  return i === -1
    ? { event: '', value: scoped }
    : { event: scoped.slice(0, i), value: scoped.slice(i + SCOPE_SEP.length) }
}

/** Shared derivation of the filterable fields hanging off an event + week. */
function eventFields(ev, week) {
  const event = ev.name
  const phase = week.includes(':') ? week.split(':')[0].trim() : week
  return {
    region: ev.region,
    event,
    phase,
    week,
    eventPhase: scopeValue(event, phase),
    eventWeek: scopeValue(event, week),
    competition: ev.competition,
  }
}

export function expandBuckets(data, keyField) {
  const { events, buckets } = data
  return buckets.map((b) => ({
    ...b,
    id: b[keyField],
    // Team buckets are keyed per calendar day, so `d` there really is one
    // exact date string ('2026-02-07') -- the same shape as a match-level
    // row's `date`, which lets date filtering treat both record kinds
    // identically. Player buckets, however, are keyed only by
    // (player, event, week) with NO day dimension at all, and `d` on
    // THAT schema is Deaths (a number, e.g. 34) -- a genuine field-name
    // collision between the two bucket shapes, not the same field.
    // Blindly aliasing `date: b.d` here attached a deaths count as a
    // player's "date", which crashed the whole app the first time
    // something tried to .localeCompare() it (PlayerProfile's rating-
    // over-time sort). Guarding on typeof means player buckets correctly
    // end up with date=undefined -- which the trend chart already
    // handles as "not enough dated data" -- instead of a bogus or
    // crashing value. Real per-day rating trends for players would need
    // export_from_db.py to add a day dimension to player buckets like
    // team buckets already have; this is a data-pipeline gap, not
    // something the frontend can recover on its own.
    date: typeof b.d === 'string' ? b.d : undefined,
    ...eventFields(events[b.e] || {}, b.w || ''),
  }))
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
    pl: 0, df: 0, ecS: 0, utN: 0, rmS: 0, rmSq: 0, rmN: 0,
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
    t.pl += b.pl || 0; t.df += b.df || 0
    t.ecS += b.ecS || 0; t.utN += b.utN || 0
    t.rmS += b.rmS || 0; t.rmSq += b.rmSq || 0; t.rmN += b.rmN || 0
  }
  // Standard deviation of per-map rating, from the stored sum and sum of
  // squares: var = E[x^2] - E[x]^2. Storing the squares upstream is what
  // makes this computable over an arbitrary filtered subset by summing
  // buckets, instead of needing every individual map's rating client-side.
  // Clamped at 0 because floating-point error can make a genuinely-zero
  // variance come out very slightly negative.
  let ratingSd = null
  if (t.rmN >= 2) {
    const mean = t.rmS / t.rmN
    ratingSd = Math.sqrt(Math.max(0, t.rmSq / t.rmN - mean * mean))
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
    // Utility/objective. utilMaps is how many maps actually carry these
    // (null for every China-region map), so the site shows nothing rather
    // than a misleading 0 when it's 0.
    totalPlants: t.pl,
    totalDefuses: t.df,
    avgEcon: div(t.ecS, t.utN),
    utilMaps: t.utN,
    // Consistency: lower = steadier map-to-map, higher = boom-or-bust.
    ratingSd,
    ratedMaps: t.rmN,
  }
}

export function aggregateTeamBuckets(buckets) {
  if (!buckets.length) return null
  const t = {
    mP: 0, mW: 0, mapP: 0, mapW: 0, rnd: 0, ratS: 0, ratR: 0, durS: 0, durM: 0,
    atkW: 0, atkP: 0, defW: 0, defP: 0, otM: 0, otW: 0,
    aeR: 0, aeW: 0, bonusR: 0, bonusW: 0, cbN: 0, cbW: 0,
  }
  // 24 regulation slots + 1 OT catch-all (index 24) -- OT length varies
  // map to map, so per-OT-round alignment isn't meaningful the way
  // per-regulation-round is.
  const roundsPlayedByNum = new Array(25).fill(0)
  const roundsWonByNum = new Array(25).fill(0)
  const winConditions = {}
  for (const b of buckets) {
    t.mP += b.mP || 0; t.mW += b.mW || 0
    t.mapP += b.mapP || 0; t.mapW += b.mapW || 0
    t.rnd += b.rnd || 0
    t.ratS += b.ratS || 0; t.ratR += b.ratR || 0
    t.durS += b.durS || 0; t.durM += b.durM || 0
    t.atkW += b.atkW || 0; t.atkP += b.atkP || 0
    t.defW += b.defW || 0; t.defP += b.defP || 0
    t.otM += b.otM || 0; t.otW += b.otW || 0
    t.aeR += b.aeR || 0; t.aeW += b.aeW || 0
    t.bonusR += b.bonusR || 0; t.bonusW += b.bonusW || 0
    t.cbN += b.cbN || 0; t.cbW += b.cbW || 0
    if (b.rnP) {
      for (let i = 0; i < 25; i++) {
        roundsPlayedByNum[i] += b.rnP[i] || 0
        roundsWonByNum[i] += b.rnW?.[i] || 0
      }
    }
    for (const k in b) {
      if (k.startsWith('wc_')) winConditions[k.slice(3)] = (winConditions[k.slice(3)] || 0) + b[k]
    }
  }
  // Pistol win/loss derived from round positions 1 and 13 (indices 0 and
  // 12) rather than a separately-tracked pistol field -- that field is
  // entirely absent from China buckets (no economy-derived data gets
  // extracted for China matches at all), which silently zeroed out every
  // China team's pistol stats. rnP/rnW are tracked for every team
  // regardless of region, so deriving from them instead recovers real
  // China pistol data with no scraper change needed. Cross-checked
  // against the old pisW-based numbers for all 36 non-China teams --
  // identical in every case -- so this isn't a behavior change for
  // anyone except the 12 China teams it fixes. Using roundsPlayedByNum
  // as the denominator (rather than mapP*2) also correctly excludes the
  // occasional map where round-by-round data has a gap, instead of
  // padding the denominator with maps we have no real outcome for.
  const pistolWon = roundsWonByNum[0] + roundsWonByNum[12]
  const pistolPlayed = roundsPlayedByNum[0] + roundsPlayedByNum[12]
  return {
    matchesPlayed: t.mP,
    matchesWon: t.mW,
    matchWinPct: div(t.mW, t.mP),
    mapsPlayed: t.mapP,
    mapsWon: t.mapW,
    mapWinPct: div(t.mapW, t.mapP),
    roundsPlayed: t.rnd,
    pistolWon,
    pistolPlayed,
    pistolWinPct: div(pistolWon, pistolPlayed),
    avgRating: div(t.ratS, t.ratR),
    // Duration coverage is partial (only re-scraped matches carry it), so
    // this divides by mapsWithDuration, not mapsPlayed.
    durationSeconds: t.durS,
    mapsWithDuration: t.durM,
    avgMapDurationSeconds: div(t.durS, t.durM),
    // Attack/defense split, from the maps table's own atk/def score
    // header (regulation rounds only -- overtime isn't included in VLR's
    // per-side scores there). atkRounds/defRounds are 0 for maps where
    // the breakdown wasn't published.
    atkRounds: t.atkP,
    atkWinPct: div(t.atkW, t.atkP),
    defRounds: t.defP,
    defWinPct: div(t.defW, t.defP),
    // Overtime.
    otMaps: t.otM,
    otWon: t.otW,
    otWinPct: div(t.otW, t.otM),
    // Round-level stats, now covering the FULL map (both halves + OT) --
    // anti-eco and pistol-conversion still require economy data, which is
    // absent for China-region matches (rounds/win-condition data itself
    // isn't, since it comes from a different page element VLR always
    // publishes -- see comebackMaps/roundsPlayedByNum below).
    antiEcoRounds: t.aeR,
    antiEcoWinPct: div(t.aeW, t.aeR),
    pistolConvRounds: t.bonusR,
    pistolConvWinPct: div(t.bonusW, t.bonusR),
    // Comeback: faced a 3+ round deficit at some point across the entire
    // map and still won it. comebackWon/comebackMaps is a genuine success
    // rate, not just a count.
    comebackMaps: t.cbN,
    comebackWon: t.cbW,
    comebackPct: div(t.cbW, t.cbN),
    // How rounds are won: elim / defuse / boom (spike detonated) / time
    // (defenders ran out the clock). Available even for China matches.
    winConditions,
    roundsPlayedByNum,
    roundsWonByNum,
  }
}

/**
 * Aggregates player_sides.json buckets (attack/defense split) -- a much
 * lighter schema than the main player buckets (just the headline stats:
 * Rating/ACS/K/D/A/KAST/ADR/HS%), so this is a separate function rather
 * than reusing aggregatePlayerBuckets, which sums a few fields (m2/m3/m4/
 * m5/cl) with no `|| 0` fallback -- fine for the main buckets where those
 * always exist, but would silently produce NaN here where they don't.
 */
export function aggregateSideBuckets(buckets) {
  if (!buckets.length) return null
  const t = {
    maps: 0, rnd: 0, ratS: 0, ratR: 0, acsS: 0, acsM: 0,
    kastS: 0, kastR: 0, adrS: 0, adrR: 0, hsS: 0, hsR: 0,
    k: 0, d: 0, a: 0, fk: 0, fd: 0,
  }
  for (const b of buckets) {
    t.maps += b.maps || 0; t.rnd += b.rnd || 0
    t.ratS += b.ratS || 0; t.ratR += b.ratR || 0
    t.acsS += b.acsS || 0; t.acsM += b.acsM || 0
    t.kastS += b.kastS || 0; t.kastR += b.kastR || 0
    t.adrS += b.adrS || 0; t.adrR += b.adrR || 0
    t.hsS += b.hsS || 0; t.hsR += b.hsR || 0
    t.k += b.k || 0; t.d += b.d || 0; t.a += b.a || 0
    t.fk += b.fk || 0; t.fd += b.fd || 0
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
  }
}

/**
 * Aggregates player_agents.json buckets (same shape as player buckets but
 * split by agent). Separate from aggregatePlayerBuckets because that one
 * handles the sparse rated-only delta, which this file doesn't carry.
 */
export function aggregateAgentBuckets(buckets) {
  if (!buckets.length) return null
  let maps = 0, rnd = 0, ratS = 0, ratR = 0, acsS = 0, acsM = 0, k = 0, d = 0
  for (const b of buckets) {
    maps += b.maps || 0; rnd += b.rnd || 0
    ratS += b.ratS || 0; ratR += b.ratR || 0
    acsS += b.acsS || 0; acsM += b.acsM || 0
    k += b.k || 0; d += b.d_ || 0
  }
  return {
    mapsPlayed: maps,
    roundsPlayed: rnd,
    avgRating: div(ratS, ratR),
    avgAcs: div(acsS, acsM),
    totalKills: k,
    totalDeaths: d,
    kd: div(k, d),
  }
}

/** Expands match_results.json rows (head-to-head, upsets, blowouts). */
export function expandMatchRows(data) {
  if (!data) return []
  const { events, rows } = data
  return rows.map((r) => ({
    ...r,
    ...eventFields(events[r.e] || {}, r.w || ''),
  }))
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

/**
 * Expands series_length.json's match-level rows the same way expandBuckets
 * does for player/team buckets (attaching region/event/phase/week/
 * competition from the shared events lookup) -- but there's no bucket
 * aggregation step afterward, since each row is already one specific
 * match, not a sum that needs re-deriving per filtered subset.
 */
export function expandSeriesRows(data) {
  if (!data) return []
  const { events, rows } = data
  return rows.map((r) => ({
    ...r,
    ...eventFields(events[r.e] || {}, r.w || ''),
  }))
}

/**
 * Expands map_length.json's per-map rows the same way expandSeriesRows
 * does for the match-level file -- one row per individual map that has a
 * scraped duration, no aggregation needed since each row is already atomic.
 */
export function expandMapLengthRows(data) {
  if (!data) return []
  const { events, rows } = data
  return rows.map((r) => ({
    ...r,
    ...eventFields(events[r.e] || {}, r.w || ''),
  }))
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
