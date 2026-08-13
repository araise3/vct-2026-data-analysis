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

// Split values that exist on events (Champions, EWC's "Main Event"/
// "Qualifier") but aren't offered as Split filter chips -- Main Event and
// Masters specifically, per product decision, even though the underlying
// events remain fully filterable via Competition/Region/Event as before.
const HIDDEN_SPLITS = new Set(['Main Event', 'Masters'])

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
    // Season split (Kickoff / Stage 1 / Stage 2 / Masters / Champions) --
    // already on each event in events.json, just not surfaced as a
    // filterable field before. Distinct from `phase` (Group Stage/
    // Playoffs, a sub-division *within* one event): this spans every
    // region's event of the same split at once, e.g. selecting "Stage 1"
    // matches Americas/EMEA/China/Pacific Stage 1 all together.
    split: HIDDEN_SPLITS.has(ev.stage) ? undefined : ev.stage,
    // Season year (2025/2026) -- tagged per event at export time from which
    // scrape DB it came from. Distinct from `split`/`event`: this is a
    // coarse switch between whole seasons, e.g. selecting "2025" pulls in
    // every 2025 region/split at once regardless of which one.
    year: ev.year,
  }
}

/**
 * `keep`, when given, is a predicate run against the RAW bucket, before any
 * expansion work happens -- so use it whenever a caller wants a subset.
 *
 * Profile pages want exactly one player's/team's records out of a file
 * holding everyone's, and the natural spelling of that
 * (`expandBuckets(data, 'p').filter((r) => r.id === name)`) builds a fully
 * expanded record -- an object spread plus two scoped-value string
 * concatenations -- for all ~21,000 buckets before throwing away all but a
 * couple of dozen of them. Measured on the real files: 10.9ms for
 * player_agents that way, 0.2ms filtering first.
 *
 * The predicate sees the raw bucket, not the expanded record, so it can
 * only test stored fields (`b.p`, `b.t`, `b.e`) -- never the derived facet
 * fields (region/event/phase/split), which don't exist yet at that point.
 * Filtering on those still belongs in a separate pass over the result.
 */
export function expandBuckets(data, keyField, keep = null) {
  const { events } = data
  const buckets = keep ? data.buckets.filter(keep) : data.buckets
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
    maps: 0, rnd: 0, wn: 0, ratS: 0, ratR: 0, acsS: 0, acsM: 0,
    kastS: 0, kastR: 0, adrS: 0, adrR: 0, hsS: 0, hsR: 0,
    k: 0, d: 0, a: 0, fk: 0, fd: 0, m2: 0, m3: 0, m4: 0, m5: 0, cl: 0,
    pl: 0, df: 0, ecS: 0, utN: 0, rmS: 0, rmSq: 0, rmN: 0,
  }
  for (const b of buckets) {
    const u = ratedOnly ? b.u : null
    t.maps += b.maps - (u?.maps || 0)
    t.rnd += b.rnd - (u?.rnd || 0)
    // Maps won. `wn`, not `w` -- `w` is the bucket's week string on this
    // schema (see export_from_db.py, where using `w` for this would have
    // silently overwritten every bucket's week).
    t.wn += (b.wn || 0) - (u?.wn || 0)
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
    mapsWon: t.wn,
    mapsLost: t.maps - t.wn,
    winPct: div(t.wn, t.maps),
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
    // Per-round / per-map rates. Kept here (rather than derived at each
    // call site) so the peer-comparison table below can rank every player
    // on exactly the same definitions the profile page displays.
    kpr: div(t.k, t.rnd),
    dpr: div(t.d, t.rnd),
    apr: div(t.a, t.rnd),
    fkpr: div(t.fk, t.rnd),
    fdpr: div(t.fd, t.rnd),
    // Denominator is utN (maps that actually carry this data), NOT maps.
    // Multi-kills and clutches are part of the same clean region-wide gap
    // as econ/plants/defuses -- VLR publishes none of them for China, and
    // the buckets store 0 rather than null. Dividing by total maps would
    // therefore report a real 0.00 rate for a China-only scope (which
    // then ranks as "1st" in a peer table, since everyone ties at zero)
    // and silently understate a player with a mix of China and
    // international maps. div() returns null on a 0 denominator, so a
    // China-only scope correctly reads "no data" instead.
    multiKillsPerMap: div(t.m2 + t.m3 + t.m4 + t.m5, t.utN),
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
    aeR: 0, aeW: 0, ae2R: 0, ae2W: 0, bonusR: 0, bonusW: 0, cbN: 0, cbW: 0,
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
    t.ae2R += b.ae2R || 0; t.ae2W += b.ae2W || 0
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
    // Round-level stats, now covering the FULL map (both halves + OT).
    // Three DIFFERENT things are all legitimately called "anti-eco" or
    // "bonus round" under different definitions, so each gets its own
    // field rather than merging any of them:
    //   - antiEco (aeR/aeW): economy-based -- we're on eco/semi-buy,
    //     opponent is full-buy, determined from actual loadout value.
    //     Requires the economy tab, so it's the one still absent for
    //     China.
    //   - postPistolAntiEco (ae2R/ae2W): position-based -- round 2/14,
    //     contingent on having won the preceding pistol. Doesn't need
    //     economy data at all, so it's available for China same as
    //     pistol win/loss above.
    //   - bonus (bonusR/bonusW): round 3/15, contingent on having won
    //     BOTH the pistol and the post-pistol anti-eco round -- two
    //     buys deep against a recovering opponent.
    //
    // The re-export this file's history once flagged as pending has since
    // happened: bonusR/bonusW in team_buckets.json correctly means round
    // 3/15, not the old round-2/14 data. Verified directly against vlr.gg's
    // own round-by-round results for 100 Thieves' 3 matches in VCT 2026
    // Americas Stage 2 (7 bonus-round opportunities, 3 wins -- exact match,
    // including the edge case where a 13-0 sweep's second pistol (round 13)
    // has no round 14 to follow up on, so it correctly doesn't count toward
    // this funnel).
    antiEcoRounds: t.aeR,
    antiEcoWinPct: div(t.aeW, t.aeR),
    postPistolAntiEcoRounds: t.ae2R,
    postPistolAntiEcoWinPct: div(t.ae2W, t.ae2R),
    bonusRounds: t.bonusR,
    bonusWinPct: div(t.bonusW, t.bonusR),
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
 * Aggregates team_map_buckets.json buckets (same grain as team_buckets --
 * one row per team per event/week/day -- with map name as an extra
 * dimension) into one row per map name. Used by the Map Stats table on
 * team profile pages. atkStart/defStart (which side the team began the
 * map on, before any halftime swap) come from round 1's winner/side in
 * the scrape and are 0/0 for the rare map with no round-by-round data at
 * all, same partial-coverage caveat as atkP/defP elsewhere in this file.
 */
export function aggregateTeamMapBuckets(buckets) {
  const byMap = new Map()
  for (const b of buckets) {
    if (!b.m) continue
    const d = byMap.get(b.m) || {
      mapP: 0, mapW: 0, rndW: 0, rndL: 0, atkW: 0, atkP: 0, defW: 0, defP: 0,
      otM: 0, otW: 0, atkStart: 0, defStart: 0, pisP: 0, pisW: 0,
    }
    d.mapP += b.mapP || 0
    d.mapW += b.mapW || 0
    d.rndW += b.rndW || 0
    d.rndL += b.rndL || 0
    d.atkW += b.atkW || 0
    d.atkP += b.atkP || 0
    d.defW += b.defW || 0
    d.defP += b.defP || 0
    d.otM += b.otM || 0
    d.otW += b.otW || 0
    d.atkStart += b.atkStart || 0
    d.defStart += b.defStart || 0
    d.pisP += b.pisP || 0
    d.pisW += b.pisW || 0
    byMap.set(b.m, d)
  }
  return [...byMap.entries()]
    .map(([map, d]) => ({
      map,
      mapsPlayed: d.mapP,
      wins: d.mapW,
      losses: d.mapP - d.mapW,
      winPct: div(d.mapW, d.mapP),
      atkStart: d.atkStart,
      defStart: d.defStart,
      otMaps: d.otM,
      otWon: d.otW,
      // How often THIS map reaches OT at all, not how the team does once it
      // gets there (that's otWon/otMaps, the existing "OT" column) -- a
      // separate, purely descriptive rate, so no colorScale on it in the
      // table (there's no "good"/"bad" direction to a map just running long).
      otPct: div(d.otM, d.mapP),
      roundsWon: d.rndW,
      roundsLost: d.rndL,
      atkRounds: d.atkP,
      atkWon: d.atkW,
      atkWinPct: div(d.atkW, d.atkP),
      defRounds: d.defP,
      defWon: d.defW,
      defWinPct: div(d.defW, d.defP),
      pistolRounds: d.pisP,
      pistolWon: d.pisW,
      pistolWinPct: div(d.pisW, d.pisP),
    }))
    .sort((a, b) => b.mapsPlayed - a.mapsPlayed)
}

/**
 * Sums an aggregateTeamMapBuckets() result back down into one overall
 * "All Maps" row -- the Map Stats table's pinned summary row. Sums the
 * same per-map rows the table itself renders (rather than re-deriving
 * from team_buckets.json separately) so the summary is guaranteed
 * consistent with whatever's actually displayed underneath it, and reuses
 * each row's raw win counts (atkWon/defWon), not its already-divided
 * atkWinPct/defWinPct, to avoid compounding rounding error across maps.
 */
export function summarizeTeamMapStats(mapRows) {
  if (!mapRows.length) return null
  const t = {
    mapsPlayed: 0, wins: 0, losses: 0, roundsWon: 0, roundsLost: 0,
    atkRounds: 0, atkWon: 0, defRounds: 0, defWon: 0,
    atkStart: 0, defStart: 0, otMaps: 0, otWon: 0,
    pistolRounds: 0, pistolWon: 0,
  }
  for (const r of mapRows) {
    t.mapsPlayed += r.mapsPlayed
    t.wins += r.wins
    t.losses += r.losses
    t.roundsWon += r.roundsWon
    t.roundsLost += r.roundsLost
    t.atkRounds += r.atkRounds
    t.atkWon += r.atkWon
    t.defRounds += r.defRounds
    t.defWon += r.defWon
    t.atkStart += r.atkStart
    t.defStart += r.defStart
    t.otMaps += r.otMaps
    t.otWon += r.otWon
    t.pistolRounds += r.pistolRounds
    t.pistolWon += r.pistolWon
  }
  return {
    map: 'Overall',
    mapsPlayed: t.mapsPlayed,
    winPct: div(t.wins, t.mapsPlayed),
    wins: t.wins,
    losses: t.losses,
    roundsWon: t.roundsWon,
    roundsLost: t.roundsLost,
    atkRounds: t.atkRounds,
    atkWinPct: div(t.atkWon, t.atkRounds),
    defRounds: t.defRounds,
    defWinPct: div(t.defWon, t.defRounds),
    pistolRounds: t.pistolRounds,
    pistolWinPct: div(t.pistolWon, t.pistolRounds),
    atkStart: t.atkStart,
    defStart: t.defStart,
    otMaps: t.otMaps,
    otWon: t.otWon,
    otPct: div(t.otMaps, t.mapsPlayed),
  }
}

/**
 * Aggregates player_sides.json buckets (attack/defense split) -- a much
 * lighter schema than the main player buckets (just the headline stats:
 * Rating/ACS/K/D/A/KAST/ADR/HS%), so this is a separate function rather
 * than reusing aggregatePlayerBuckets, which sums a few fields (m2/m3/m4/
 * m5/cl) with no `|| 0` fallback -- fine for the main buckets where those
 * always exist, but would silently produce NaN here where they don't.
 *
 * `roundsPlayed` here is genuinely side-specific -- export_from_db.py's
 * `rnd` field on each side bucket is rounds actually played on THAT side
 * (derived from the map's real atk/def round split), not the map's whole
 * round total. Safe to swap into a row's headline `roundsPlayed` when a
 * side is selected, unlike relying on the 'both' aggregate's own value.
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
 * handles the sparse rated-only delta, which this file doesn't carry, and
 * this one has no multi-kill/clutch/utility fields to sum -- a player
 * plays exactly one agent per map, so those are already exposed at the
 * source per map_player_stats row, but aren't broken out here since
 * nothing on the site currently needs them by agent.
 */
export function aggregateAgentBuckets(buckets) {
  if (!buckets.length) return null
  let maps = 0, rnd = 0, wn = 0, ratS = 0, ratR = 0, acsS = 0, acsM = 0,
      kastS = 0, kastR = 0, adrS = 0, adrR = 0, hsS = 0, hsR = 0,
      k = 0, d = 0, a = 0, fk = 0, fd = 0
  for (const b of buckets) {
    maps += b.maps || 0; rnd += b.rnd || 0; wn += b.wn || 0
    ratS += b.ratS || 0; ratR += b.ratR || 0
    acsS += b.acsS || 0; acsM += b.acsM || 0
    kastS += b.kastS || 0; kastR += b.kastR || 0
    adrS += b.adrS || 0; adrR += b.adrR || 0
    hsS += b.hsS || 0; hsR += b.hsR || 0
    k += b.k || 0; d += b.d_ || 0
    a += b.a || 0; fk += b.fk || 0; fd += b.fd || 0
  }
  return {
    mapsPlayed: maps,
    roundsPlayed: rnd,
    mapsWon: wn,
    mapsLost: maps - wn,
    winPct: div(wn, maps),
    avgRating: div(ratS, ratR),
    avgAcs: div(acsS, acsM),
    avgKast: div(kastS, kastR),
    avgAdr: div(adrS, adrR),
    avgHsPct: div(hsS, hsR),
    totalKills: k,
    totalDeaths: d,
    kd: div(k, d),
    totalAssists: a,
    totalFirstKills: fk,
    totalFirstDeaths: fd,
    kpr: div(k, rnd),
    apr: div(a, rnd),
    fkpr: div(fk, rnd),
    fdpr: div(fd, rnd),
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

/**
 * Groups match_players.json rows by match id, so a match history row can
 * hand its scoreboard the ten players of that one match.
 *
 * Unlike the bucket files there's nothing to expand here -- these rows are
 * already final per-match values and carry no event/week key of their own
 * (the match record they're joined to has it). Filtering therefore happens
 * on the *match* records, and this map is only ever a lookup.
 */
export function groupMatchPlayers(data) {
  const out = new Map()
  if (!data?.rows) return out
  for (const r of data.rows) {
    if (!out.has(r.m)) out.set(r.m, [])
    out.get(r.m).push(r)
  }
  return out
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
 * A player's team, but derived from THIS filtered scope rather than a
 * single static value -- meta.team is only ever one fixed answer (their
 * most recent team overall), which is wrong the moment a filter narrows
 * to a period before their latest transfer. Each player bucket carries
 * its own team (the `t` field, added specifically for this).
 *
 * When scope spans multiple teams, shows whichever team is NEWEST (the
 * team of the most recent event in scope), not a rounds-weighted
 * majority -- a player who transferred mid-season should show their new
 * team even if they'd played far more total rounds for their old one.
 * Rounds only break a tie among buckets that share the single latest
 * event id.
 *
 * Falls back to `fallbackTeam` (normally meta.team) if buckets is empty
 * or none of them carry a `t` field.
 */
export function teamInScope(buckets, fallbackTeam) {
  // Event id increases roughly chronologically (same assumption already
  // relied on elsewhere for match_id ordering) -- player buckets don't
  // carry a real per-bucket date (`d` is Deaths, not a date), so this is
  // the best available signal for "which team is newest" within scope.
  // Rounds only break a tie among buckets that share the single latest
  // event id (the rare case of a team switch mid-event).
  let maxEvent = -Infinity
  for (const b of buckets) {
    if (b.t && b.e > maxEvent) maxEvent = b.e
  }
  if (maxEvent === -Infinity) return fallbackTeam

  const rounds = new Map()
  for (const b of buckets) {
    if (b.t && b.e === maxEvent) rounds.set(b.t, (rounds.get(b.t) || 0) + (b.rnd || 0))
  }
  let best = fallbackTeam, bestRounds = -1
  for (const [team, r] of rounds) {
    if (r > bestRounds) { best = team; bestRounds = r }
  }
  return best
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
