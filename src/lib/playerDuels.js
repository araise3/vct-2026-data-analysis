/**
 * This player's own kill duels against every individual opponent they've
 * faced, summed across every map of every match -- distinct from
 * ComparePlayers.jsx's h2h duels (which fixes BOTH players in advance and
 * only ever looks at the matches between that one specific pair). Here the
 * subject is fixed and every opponent they've ever lined up against is a
 * row, grouped by that opponent's own country. Originally fed its own
 * "Duels by country" widget directly (mirroring vlr.gg's own per-match duel
 * widget -- team logo, player, kills-for/kills-against/diff); that widget
 * was removed and this is now purely an intermediate step for
 * aggregateKdByCountry() below.
 *
 * `duelRows` is match_duels.json's raw `rows` array ({m, mi, p1, p2, k1,
 * k2} -- see export_from_db.py's own comment on it). `matchIds` scopes
 * this to the subject's own matches (their `match_duels` rows aren't
 * pre-filtered by player, since the file covers the whole site). `meta` is
 * player_buckets.json's own per-player meta (team/countryCode/countryName)
 * used to identify each opponent.
 */
export function aggregatePlayerDuelsByOpponent(duelRows, matchIds, subjectName, meta) {
  const byOpponent = new Map()

  for (const r of duelRows) {
    if (!matchIds.has(r.m)) continue
    let opponent, kFor, kAgainst
    if (r.p1 === subjectName) {
      opponent = r.p2; kFor = r.k1 ?? 0; kAgainst = r.k2 ?? 0
    } else if (r.p2 === subjectName) {
      opponent = r.p1; kFor = r.k2 ?? 0; kAgainst = r.k1 ?? 0
    } else {
      continue
    }
    if (!byOpponent.has(opponent)) {
      const m = meta?.[opponent]
      byOpponent.set(opponent, {
        opponent,
        team: m?.team ?? null,
        countryCode: m?.countryCode ?? null,
        countryName: m?.countryName ?? null,
        kFor: 0, kAgainst: 0,
        maps: new Set(),
      })
    }
    const e = byOpponent.get(opponent)
    e.kFor += kFor
    e.kAgainst += kAgainst
    e.maps.add(`${r.m}:${r.mi}`)
  }

  const rows = [...byOpponent.values()].map((e) => ({ ...e, diff: e.kFor - e.kAgainst }))

  // Grouped by country (unnamed/missing country sorts last, not first --
  // alphabetically "" would otherwise jump the queue), opponents within a
  // country ranked by total duel volume so the pair with the most history
  // leads that group rather than an alphabetical player-name order.
  const groups = new Map()
  for (const r of rows) {
    const key = r.countryCode || '￿'
    if (!groups.has(key)) groups.set(key, { code: r.countryCode, name: r.countryName, opponents: [] })
    groups.get(key).opponents.push(r)
  }
  for (const g of groups.values()) {
    g.opponents.sort((a, b) => (b.kFor + b.kAgainst) - (a.kFor + a.kAgainst))
  }

  return [...groups.values()].sort((a, b) => (a.name || '￿').localeCompare(b.name || '￿'))
}

// --- Dynamic minimum-volume gate ----------------------------------------
// Same shape as radarProfile.js's own qualification bar (`max(floor, 0.5 x
// median)`): a country this player has barely faced at all (a one-off
// cameo matchup) shouldn't get a bar in the first place, but a FIXED
// minimum would either be toothless for a player with generally deep data
// or wipe out half the chart for one with generally thin data. Scaling to
// each player's own median duel volume per country solves that the same
// way the radar's bar solves "nobody clears 100 rounds in a one-event
// scope".
//
// The volume unit is DISTINCT MAPS played against that country -- not
// opponent count, not total duel kills, not rounds. All four were measured
// against the whole dataset (see project-history) on the same yardstick:
// how often does a single-opponent country still outrank a well-established
// (6+ opponent) one it's compared against.
//   kills exchanged (kFor+kAgainst): 108 such cases -- one hot opponent can
//     rack up enough kills in a short sample to look like real volume.
//   rounds played in those maps: 236+, and starts emptying players' charts
//     entirely at any gate strict enough to compete -- a round only counts
//     for anything here if a duel with the tracked opponent(s) actually
//     happened in it, and that "dead round" noise is proportionally WORSE
//     for a single opponent (fewer chances per round to specifically
//     trade with just them) than for a country with ten different
//     opponents, so rounds hands MORE apparent confidence to exactly the
//     samples that deserve less.
//   opponent count, each capped at a handful of kills: 66 -- the previous
//     version of this file, dropped because opponent diversity isn't a
//     signal that matters here.
//   maps: 51, tightenable to the high 20s with a stricter SORT_Z below at
//     no further cost -- best of all four, and simpler than the capped-
//     opponent version besides. A map is a clean, bounded trial (one real
//     encounter window with the opposing roster) -- it can't be inflated
//     by one hot opponent racking up kills the way a raw kill count can,
//     but unlike a round it doesn't get diluted by stretches where no duel
//     with the tracked opponent(s) happened at all.
// MAP_GATE_FLOOR=2 is the dataset's own near-universal minimum (a completed
// match is a Bo3), with a 0.5x-median fraction: excludes ~10% of the
// thinnest (player, country) entries, never leaves a player with zero
// countries to show.
const MAP_GATE_FLOOR = 2
const MAP_GATE_FRACTION = 0.5

function median(sortedNums) {
  const n = sortedNums.length
  if (!n) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? sortedNums[mid] : (sortedNums[mid - 1] + sortedNums[mid]) / 2
}

// --- Hidden confidence score for SORT ORDER ONLY ------------------------
// By direct request: CountryKdChart must display each country's real,
// unadjusted K/D (kFor/kAgainst) -- the number shown (bar height + label)
// is never shrunk or otherwise touched. But sorting by that raw number is
// exactly the bug this whole thing exists to fix: a player facing 1 German
// opponent at a lucky 2.40 K/D must not outrank facing 10 different
// Brazilian opponents at a rock-solid 1.67 -- confirmed as a real case in
// this dataset, not a hypothetical.
//
// An IMDB-style linear shrinkage (`v/(v+m)*R + m/(v+m)*C`) was tried first
// and is mathematically incapable of this: proven algebraically that for a
// genuinely extreme real case (1 opponent at 3.0 raw K/D vs. 23 opponents
// at a modest 1.09), NO value of m from 1 to 1000 flips the order, because
// it's a linear blend and the tiny sample's raw excess over the mean is
// always disproportionately larger. Fixing that requires a nonlinear tool:
// the Wilson score interval lower bound, the standard technique for
// "rank a proportion by confidence, not just its point value" (the same
// approach Reddit uses to rank comments by score without a fluky 2-upvote
// comment outranking a well-vouched-for one). Since this score is NEVER
// displayed, it's free to be as statistically conservative as it needs to
// be to get the ranking right -- unlike a displayed metric, it doesn't also
// have to look like a believable K/D.
//
// `n` here is distinct maps played against that country -- same volume
// unit as the gate above, and empirically the best of everything tried
// (see the gate's own comment for the full comparison). SORT_Z=2.0 is a
// standard "2-sigma" cutoff; pushing it higher keeps reducing the residual
// outrank-a-well-established-country cases with zero further cost to how
// many countries get gated out, but 2.0 is the point where the choice
// stops being "tuned to squeeze out one more case" and stays a normal,
// citable confidence level.
const SORT_Z = 2.0

function wilsonLowerBound(phat, n, z) {
  if (!n) return null
  const denom = 1 + (z * z) / n
  const center = phat + (z * z) / (2 * n)
  const adj = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)
  return (center - adj) / denom
}

/**
 * Collapses aggregatePlayerDuelsByOpponent()'s per-opponent groups into one
 * K/D per country -- the subject's own personal K/D specifically against
 * opponents from that country (not that country's own general skill level,
 * which is a different question the site doesn't answer here). Sums kills
 * FIRST across every opponent from a country and divides once, the same
 * sum-first rule every bucket aggregate on this site already follows --
 * averaging each opponent's own K/D ratio instead would weight a 3-kill
 * cameo duel the same as a 40-kill rivalry. `kd` here is always the real,
 * unshrunk number -- see SORT_Z above for how (and why) the returned order
 * differs from a plain sort on that number.
 */
export function aggregateKdByCountry(groups) {
  const raw = groups.map((g) => {
    let kFor = 0, kAgainst = 0
    const mapSet = new Set()
    for (const o of g.opponents) {
      kFor += o.kFor
      kAgainst += o.kAgainst
      for (const mapKey of o.maps) mapSet.add(mapKey)
    }
    return { code: g.code, name: g.name, kFor, kAgainst, opponents: g.opponents.length, maps: mapSet.size }
  })

  const gate = Math.max(MAP_GATE_FLOOR, MAP_GATE_FRACTION * median(raw.map((c) => c.maps).sort((a, b) => a - b)))

  return raw
    // `code` is null for an opponent with no player_buckets meta entry at
    // all (a rare cameo appearance, e.g. a Bo1-only sub) -- there's no flag
    // to show and "which country" doesn't have a real answer, so this drops
    // the group entirely rather than crashing flagUrl() or faking a flag.
    .filter((c) => c.code && c.kAgainst && c.maps >= gate)
    .map((c) => {
      const kd = c.kFor / c.kAgainst
      const phat = c.kFor / (c.kFor + c.kAgainst)
      const sortScore = wilsonLowerBound(phat, c.maps, SORT_Z)
      return { code: c.code, name: c.name, kFor: c.kFor, kAgainst: c.kAgainst, opponents: c.opponents, maps: c.maps, kd, sortScore }
    })
    .sort((a, b) => b.sortScore - a.sortScore)
}
