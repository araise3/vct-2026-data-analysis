/**
 * Group-stage standings, official tiebreak resolution, and simulated
 * qualifying odds for a VCT round-robin group.
 *
 * Deliberately reads NO data from Liquipedia beyond group composition/
 * tiebreak order/seed outcomes (see tournamentStructure.js) -- every
 * number here comes from this site's own VLR-scraped `match_results.json`
 * (`expandMatchRows`), which already carries per-match series scores AND
 * per-map round scores (`maps: [{map, s1, s2, ot}, ...]`). That's enough
 * to compute every one of the 5 official tiebreak criteria (head-to-head
 * match score / map diff / round diff, plus overall map diff / round
 * diff) without any new data source.
 *
 * `records` throughout is a `Map<teamName, record>`, where a record is
 * `{team, wins, losses, mapsWon, mapsLost, roundsWon, roundsLost,
 * h2h: Map<opponent, {wins, losses, mapsWon, mapsLost, roundsWon, roundsLost}>}`.
 */

function emptyRecord(team) {
  return {
    team, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0,
    h2h: new Map(),
  }
}

function h2hFor(record, opponent) {
  if (!record.h2h.has(opponent)) {
    record.h2h.set(opponent, { wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0 })
  }
  return record.h2h.get(opponent)
}

/**
 * Applies one decided match (real or simulated) to both teams' records,
 * including their mutual head-to-head sub-record. Shared by
 * `computeGroupRecords` (real matches) and `simulateQualifyingOdds` (each
 * Monte Carlo trial's simulated matches) so the accumulation logic exists
 * exactly once. `mapsRoundScores` is the same shape as a match_results.json
 * row's own `maps` array (`[{s1, s2}, ...]`, round scores per map).
 */
function applyMatchToRecords(records, team1, team2, s1, s2, mapsRoundScores) {
  const rec1 = records.get(team1)
  const rec2 = records.get(team2)
  if (!rec1 || !rec2) return
  const r1 = mapsRoundScores.reduce((sum, m) => sum + m.s1, 0)
  const r2 = mapsRoundScores.reduce((sum, m) => sum + m.s2, 0)

  rec1.mapsWon += s1; rec1.mapsLost += s2
  rec2.mapsWon += s2; rec2.mapsLost += s1
  rec1.roundsWon += r1; rec1.roundsLost += r2
  rec2.roundsWon += r2; rec2.roundsLost += r1
  if (s1 > s2) { rec1.wins += 1; rec2.losses += 1 } else { rec2.wins += 1; rec1.losses += 1 }

  const h1 = h2hFor(rec1, team2)
  const h2 = h2hFor(rec2, team1)
  h1.mapsWon += s1; h1.mapsLost += s2
  h2.mapsWon += s2; h2.mapsLost += s1
  h1.roundsWon += r1; h1.roundsLost += r2
  h2.roundsWon += r2; h2.roundsLost += r1
  if (s1 > s2) { h1.wins += 1; h2.losses += 1 } else { h2.wins += 1; h1.losses += 1 }
}

/**
 * Builds one record per team in `groupTeams` from this event's REAL group-
 * stage matches so far. `matches` should already be `expandMatchRows(...)`
 * output filtered to this one event (a page-level filter, same pattern
 * every other page uses) -- this function does the remaining, group-
 * specific narrowing itself: `phase === 'Group Stage'` (excludes any
 * Play-Ins/Playoffs matches already played under the same event id, which
 * is real for EMEA/China Stage 2 2026 -- their group stage already
 * finished and Play-Ins has started) AND both teams must be members of
 * `groupTeams` (a second, redundant safety net against the rare case of
 * two teams from the same original group meeting again post-groups).
 * Ties/unscored matches (`s1 == null` or `s1 === s2`) are skipped.
 */
export function computeGroupRecords(matches, groupTeams) {
  const teamSet = new Set(groupTeams)
  const records = new Map(groupTeams.map((t) => [t, emptyRecord(t)]))
  for (const m of matches) {
    if (m.phase !== 'Group Stage') continue
    if (!teamSet.has(m.team1) || !teamSet.has(m.team2)) continue
    if (m.s1 == null || m.s2 == null || m.s1 === m.s2) continue
    applyMatchToRecords(records, m.team1, m.team2, m.s1, m.s2, m.maps || [])
  }
  return records
}

/** Every unordered pair of `groupTeams` (the full single-round-robin
 * schedule) that does NOT already have a recorded match in `records` --
 * i.e. what's left to simulate. A team with zero recorded matches at all
 * (very early in the stage) correctly returns every one of its pairs. */
export function remainingFixtures(records, groupTeams) {
  const played = new Set()
  for (const [team, rec] of records) {
    for (const opp of rec.h2h.keys()) played.add([team, opp].sort().join('|'))
  }
  const remaining = []
  for (let i = 0; i < groupTeams.length; i++) {
    for (let j = i + 1; j < groupTeams.length; j++) {
      const key = [groupTeams[i], groupTeams[j]].sort().join('|')
      if (!played.has(key)) remaining.push([groupTeams[i], groupTeams[j]])
    }
  }
  return remaining
}

function h2hAgainst(record, subgroup, extract) {
  let total = 0
  for (const opp of subgroup) {
    if (opp.team === record.team) continue
    const h = record.h2h.get(opp.team)
    if (h) total += extract(h)
  }
  return total
}

/** One of the 5 official criteria, evaluated for `record` relative to
 * `subgroup` (the currently-tied cluster -- head-to-head criteria only
 * count matches AGAINST other members of that same cluster, per the
 * documented rule). An unrecognized criterion (e.g. EMEA Stage 2 2026's
 * extra "Strength of Victory" 6th step, which isn't modeled -- see the
 * scraper's own TIEBREAK_VOCAB comment) returns 0 for every team
 * uniformly, which correctly falls through as "can't separate anyone"
 * rather than fabricating an outcome. */
function criterionValue(record, subgroup, criterion) {
  switch (criterion) {
    case 'h2h_match_score': return h2hAgainst(record, subgroup, (h) => h.wins - h.losses)
    case 'h2h_map_diff': return h2hAgainst(record, subgroup, (h) => h.mapsWon - h.mapsLost)
    case 'h2h_round_diff': return h2hAgainst(record, subgroup, (h) => h.roundsWon - h.roundsLost)
    case 'map_diff': return record.mapsWon - record.mapsLost
    case 'round_diff': return record.roundsWon - record.roundsLost
    default: return 0
  }
}

/**
 * The exact recursive "Subgroup Tie-breaker Rule" documented on every VCT
 * stage's own Liquipedia page: within a tied cluster, find the criterion
 * that separates SOME team(s) as strictly highest, peel that top cluster
 * off, treat everyone else as one remaining group, and restart the WHOLE
 * criteria chain from step 1 for EACH of the two resulting subgroups (not
 * continue from the next criterion) -- repeating until every team is
 * ranked or every criterion is exhausted with teams still equal, which is
 * flagged (`stillTiedWith`) rather than silently broken by insertion
 * order, since that's a real edge case needing an actual decider match.
 */
function resolveTieGroup(group, tiebreakOrder, criteriaIndex = 0) {
  if (group.length <= 1) return group
  if (criteriaIndex >= tiebreakOrder.length) {
    return group.map((r) => ({ ...r, stillTiedWith: group.filter((x) => x !== r).map((x) => x.team) }))
  }
  const criterion = tiebreakOrder[criteriaIndex]
  const scored = group.map((r) => ({ r, value: criterionValue(r, group, criterion) }))
  const maxVal = Math.max(...scored.map((s) => s.value))
  const top = scored.filter((s) => s.value === maxVal).map((s) => s.r)
  if (top.length === group.length) {
    // This criterion didn't separate anyone -- try the next one, same group.
    return resolveTieGroup(group, tiebreakOrder, criteriaIndex + 1)
  }
  const rest = group.filter((r) => !top.includes(r))
  return [
    ...resolveTieGroup(top, tiebreakOrder, 0),
    ...resolveTieGroup(rest, tiebreakOrder, 0),
  ]
}

/**
 * Full group ranking: primary tiers by raw match WIN COUNT (not win
 * differential or win% -- the standard "table position" convention for a
 * round-robin still in progress, where teams haven't all played the same
 * number of matches yet), each tier's internal ties resolved via
 * `resolveTieGroup`. This is the REAL, current, already-decided standings
 * -- no simulation involved, and exactly what a finished group's page
 * section should render (no remaining fixtures, so no odds column needed
 * alongside it).
 */
export function rankGroupStandings(records, tiebreakOrder) {
  const byWins = new Map()
  for (const rec of records.values()) {
    if (!byWins.has(rec.wins)) byWins.set(rec.wins, [])
    byWins.get(rec.wins).push(rec)
  }
  const tiers = [...byWins.entries()].sort((a, b) => b[0] - a[0])
  const ranked = []
  for (const [, tier] of tiers) ranked.push(...resolveTieGroup(tier, tiebreakOrder))
  return ranked
}

export const buildGroupStandings = rankGroupStandings

// A team's group-stage round-win-rate so far, shrunk toward a neutral 50%
// when its round sample is thin (STRENGTH_PRIOR_ROUNDS worth of "phantom"
// 50/50 evidence blended in) -- prevents one early, tiny-sample match from
// producing an overconfident strength estimate before the group's had a
// chance to play out. Deliberately self-contained (no second, wider-scope
// data file fetched for a fallback) -- a documented simplification, not a
// claim of statistical rigor.
const STRENGTH_PRIOR_ROUNDS = 20

export function teamStrength(record) {
  const played = record.roundsWon + record.roundsLost
  return (record.roundsWon + STRENGTH_PRIOR_ROUNDS * 0.5) / (played + STRENGTH_PRIOR_ROUNDS)
}

// Elo-style logistic transform of a round-win-rate DIFFERENCE (both inputs
// 0-1) into a single-map win probability. A labeled simplification, not
// ground truth -- every UI surface showing odds derived from this must say
// "simulated" and name round-win-rate as the input. Reference points at
// ELO_K = 0.25 (computed, not asserted): a 5-point edge -> ~61%, a 10-point
// edge -> ~72%, a 20-point edge -> ~86% single-map favorite.
const ELO_K = 0.25

export function mapWinProbability(strengthA, strengthB) {
  const diff = strengthA - strengthB
  return 1 / (1 + Math.pow(10, -diff / ELO_K))
}

/** Standard best-of-3 series win probability from a single-map win
 * probability `p`, assuming maps are independent draws (a simplification
 * -- real Bo3s have map-pick/ban and momentum effects this doesn't model):
 * P(2-0) + P(2-1) = p^2 + 2p^2(1-p) = p^2(3-2p). */
export function seriesWinProbability(p) {
  return p * p * (3 - 2 * p)
}

/** A round score for one map, winner always scoring 13 (VCT's standard
 * round cap absent overtime) and the loser drawn from a plausible losing
 * range -- purely to give simulated matches a round-differential number
 * for the lower-priority tiebreak steps, not a model of real round-by-
 * round play. */
function randomWinningMapRounds() {
  return { winnerRounds: 13, loserRounds: 4 + Math.floor(Math.random() * 8) }
}

/**
 * Draws one random Bo3 outcome between two teams of the given strengths,
 * shaped like a real match_results.json row's own `{team1Score,
 * team2Score, maps}` so it can go straight into `applyMatchToRecords` --
 * the exact same accumulation logic real matches use, so a simulated
 * trial's records are structurally identical to a real ones's.
 */
export function sampleSeriesResult(strengthA, strengthB) {
  const p = mapWinProbability(strengthA, strengthB)
  const aWins = Math.random() < seriesWinProbability(p)
  const winnerP = aWins ? p : 1 - p
  // P(2-0 | series win) = p^2 / (p^2 + 2p^2(1-p)) = 1 / (3 - 2p), the same
  // Bo3 formula seriesWinProbability itself is built from.
  const sweep = Math.random() < 1 / (3 - 2 * winnerP)
  const winner = aWins ? 'A' : 'B'
  const loserMapWins = sweep ? 0 : 1
  const maps = []
  for (let i = 0; i < 2; i++) {
    const { winnerRounds, loserRounds } = randomWinningMapRounds()
    maps.push(winner === 'A' ? { s1: winnerRounds, s2: loserRounds } : { s1: loserRounds, s2: winnerRounds })
  }
  for (let i = 0; i < loserMapWins; i++) {
    const { winnerRounds, loserRounds } = randomWinningMapRounds()
    maps.push(winner === 'A' ? { s1: loserRounds, s2: winnerRounds } : { s1: winnerRounds, s2: loserRounds })
  }
  const team1Score = maps.filter((m) => m.s1 > m.s2).length
  const team2Score = maps.filter((m) => m.s2 > m.s1).length
  return { team1Score, team2Score, maps }
}

function cloneRecords(records) {
  const clone = new Map()
  for (const [team, rec] of records) {
    clone.set(team, {
      team: rec.team, wins: rec.wins, losses: rec.losses,
      mapsWon: rec.mapsWon, mapsLost: rec.mapsLost,
      roundsWon: rec.roundsWon, roundsLost: rec.roundsLost,
      h2h: new Map([...rec.h2h].map(([opp, h]) => [opp, { ...h }])),
    })
  }
  return clone
}

/**
 * Monte Carlo qualifying odds: `trials` random playouts of `fixtures` (the
 * group's remaining matches), each ranked via the same official
 * `rankGroupStandings` used for real current standings, tallied by which
 * SEED-OUTCOME BUCKET (from tournamentStructure.js's `seedOutcomes`, not
 * just "top 2") each team lands in each trial -- a team can care about its
 * odds of the BYE specifically, not merely of advancing at all. Returns
 * `{team: {outcomeSlug: probability, ...}}`.
 *
 * Team strengths are computed ONCE from the real current `records` before
 * any trials run (not recomputed mid-trial from simulated results so
 * far) -- simpler and avoids a same-trial feedback loop where an early
 * simulated result biases that same trial's later fixtures.
 */
export function simulateQualifyingOdds(records, groupTeams, fixtures, tiebreakOrder, seedOutcomes, trials = 20000) {
  const strengths = new Map(groupTeams.map((t) => [t, teamStrength(records.get(t))]))
  const tally = new Map(groupTeams.map((t) => [t, new Map()]))

  for (let trial = 0; trial < trials; trial++) {
    const scratch = cloneRecords(records)
    for (const [a, b] of fixtures) {
      const { team1Score, team2Score, maps } = sampleSeriesResult(strengths.get(a), strengths.get(b))
      applyMatchToRecords(scratch, a, b, team1Score, team2Score, maps)
    }
    const ranked = rankGroupStandings(scratch, tiebreakOrder)
    ranked.forEach((rec, idx) => {
      const rank = idx + 1
      const outcome = seedOutcomes?.[String(rank)]
      const slug = outcome ? outcome.slug : `rank_${rank}`
      const teamTally = tally.get(rec.team)
      teamTally.set(slug, (teamTally.get(slug) || 0) + 1)
    })
  }

  const result = {}
  for (const [team, teamTally] of tally) {
    result[team] = {}
    for (const [slug, count] of teamTally) result[team][slug] = count / trials
  }
  return result
}
