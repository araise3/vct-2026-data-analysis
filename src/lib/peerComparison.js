/**
 * Peer comparison: one player's headline stats against the field, with a
 * rank for each. This is the Valorant analogue of a LoL site's "player vs.
 * other Junglers" table -- same idea (a raw stat means little until you
 * know what's normal for someone doing the same job), rebuilt on the stats
 * this dataset actually carries.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It doesn't average pre-computed per-player averages to get the peer
 *    average. Every peer's stats come from aggregatePlayerBuckets() over
 *    their own in-scope buckets (sum-then-divide, per the bucket model),
 *    and the peer "average" is then the MEDIAN of those, not the mean --
 *    a median isn't dragged around by the handful of extreme small-sample
 *    players that any filtered scope produces, and it's what "a typical
 *    player at this position" actually means.
 *
 *  - It doesn't rank against everyone in the file. Peers must clear a
 *    minimum workload in the *current* scope, otherwise a player with two
 *    maps and a hot rating outranks a whole split's worth of real work.
 */
import { aggregatePlayerBuckets, groupByEntity } from './entityBuckets'
import agentRoles from './agentRoles.json'

/**
 * Absolute floor for the qualification threshold, in rounds -- roughly a
 * single map. Nothing below this is ever treated as a ranked sample.
 */
export const MIN_PEER_ROUNDS = 20

/**
 * Share of the scope's MEDIAN rounds a player must reach to qualify.
 *
 * Deliberately relative rather than a fixed round count: this page
 * defaults to the player's most recent event, where a whole scope can be
 * one match and *nobody* clears a fixed bar like 100 rounds -- which
 * silently hid the entire panel. Scaling off the median instead means the
 * threshold is ~200 rounds across a full season and ~20 inside a single
 * week, always excluding the same thing (players who did far less than a
 * typical player in that same scope) rather than an arbitrary count that
 * only suits one scope size.
 */
const QUALIFY_SHARE = 0.5

/**
 * Agent roles this dataset contains that aren't in agentRoles.json.
 * Everything maps except two agents released after the role list was
 * written -- they simply don't contribute to role inference rather than
 * being guessed at. Exported so the UI can say so out loud.
 */
export function unknownRoleAgents(agentNames) {
  return [...new Set(agentNames)].filter((a) => a && !agentRoles[a]).sort()
}

/**
 * Every player's role in the current scope, inferred from the agents they
 * actually played, weighted by maps. Valorant has no "position" field the
 * way LoL has a lane, but agent role is the same concept in practice: a
 * Duelist's first-blood rate is only meaningful next to other Duelists'.
 *
 * Inferred per scope rather than as a static career label, so a player
 * who moved from Sentinel to Duelist between splits compares against the
 * right group for whichever split is filtered.
 *
 * Players whose agents are all missing from agentRoles.json simply don't
 * appear in the returned map, so callers fall back to comparing against
 * every player rather than inventing a role.
 *
 * `agentRecords` are expanded player_agents rows (`id` = player, `ag` =
 * agent, `maps` = maps on that agent).
 */
export function rolesInScope(agentRecords) {
  const byPlayer = new Map()
  for (const r of agentRecords) {
    const role = agentRoles[r.ag]
    if (!role) continue
    let roleMaps = byPlayer.get(r.id)
    if (!roleMaps) { roleMaps = new Map(); byPlayer.set(r.id, roleMaps) }
    roleMaps.set(role, (roleMaps.get(role) || 0) + (r.maps || 0))
  }
  const out = new Map()
  for (const [player, roleMaps] of byPlayer) {
    let best = null
    let bestMaps = 0
    for (const [role, maps] of roleMaps) {
      if (maps > bestMaps) { best = role; bestMaps = maps }
    }
    if (best) out.set(player, best)
  }
  return out
}

/** Median of a numeric array; null when empty. */
function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * The stats compared, in display order.
 *
 * `invert: true` marks a stat where LOWER is better (deaths and first
 * deaths per round), which flips both the rank direction and the
 * good/bad colouring -- without it, the worst entry-fragging player on
 * the list would read as rank 1.
 */
export const COMPARISON_STATS = [
  { key: 'avgRating', label: 'Rating 2.0', digits: 2 },
  { key: 'avgAcs', label: 'ACS', digits: 0 },
  { key: 'kd', label: 'K/D', digits: 2 },
  { key: 'avgAdr', label: 'ADR', digits: 1 },
  { key: 'avgKast', label: 'KAST', pct: true },
  { key: 'avgHsPct', label: 'HS%', pct: true },
  { key: 'kpr', label: 'Kills / round', digits: 2 },
  { key: 'apr', label: 'Assists / round', digits: 2 },
  { key: 'fkpr', label: 'First kills / round', digits: 3 },
  { key: 'fdpr', label: 'First deaths / round', digits: 3, invert: true },
  { key: 'multiKillsPerMap', label: 'Multi-kills / map', digits: 2 },
]

/**
 * Builds the comparison rows for one player.
 *
 * `peerBuckets` is every in-scope player bucket (all players, already
 * filtered by the page's active facets) -- NOT just this player's, since
 * the whole point is the surrounding distribution.
 *
 * Returns null when the player themselves doesn't clear the round
 * threshold or there aren't enough peers to rank against, so the UI can
 * hide the section rather than show a rank of "1st of 1".
 */
export function buildPeerComparison({
  playerName, peerBuckets, ratedOnly = false, role = null, rolesByPlayer = null,
}) {
  const grouped = groupByEntity(peerBuckets)

  // Pass 1: everyone's in-scope stats, so the qualification bar can be
  // derived from the scope itself rather than assumed.
  const all = []
  let subject = null
  for (const [name, buckets] of grouped) {
    const s = aggregatePlayerBuckets(buckets, { ratedOnly })
    if (!s || !s.mapsPlayed) continue
    if (name === playerName) subject = s
    all.push({ name, stats: s })
  }
  if (!subject) return null

  const minRounds = Math.max(
    MIN_PEER_ROUNDS,
    Math.round(QUALIFY_SHARE * (median(all.map((p) => p.stats.roundsPlayed)) ?? 0))
  )

  // Pass 2: the qualified peer group.
  const peers = all.filter((p) => {
    if (p.stats.roundsPlayed < minRounds) return false
    // Role filtering uses the SAME in-scope inference as the subject's
    // own role, so "Duelists" means "players whose in-scope agent pool is
    // mostly Duelists", not a static career label.
    if (role && rolesByPlayer && rolesByPlayer.get(p.name) !== role) return false
    return true
  })

  if (peers.length < 3) return null

  // The threshold exists to keep tiny samples out of the MEDIAN and the
  // ranking, not to hide the player whose page this is. A subject below
  // the bar (very common here, since the profile defaults to the player's
  // most recent event and they may have played one match of it) is added
  // back in so the panel still renders -- flagged via subjectQualified so
  // the UI can caveat the small sample rather than presenting the rank as
  // settled.
  const subjectQualified = peers.some((p) => p.name === playerName)
  const ranked = subjectQualified ? peers : [...peers, { name: playerName, stats: subject }]

  const allRows = COMPARISON_STATS.map((stat) => {
    const values = ranked
      .map((p) => p.stats[stat.key])
      .filter((v) => v !== null && v !== undefined && !Number.isNaN(v))
    const mine = subject[stat.key]
    let rank = null
    if (mine !== null && mine !== undefined && !Number.isNaN(mine)) {
      // Competition ranking: how many peers are strictly better, +1. Ties
      // therefore share a rank rather than being ordered arbitrarily.
      const better = values.filter((v) => (stat.invert ? v < mine : v > mine)).length
      rank = better + 1
    }
    return {
      ...stat,
      value: mine ?? null,
      peer: median(values),
      rank,
      peerCount: values.length,
    }
  })

  // Drop stats nobody in scope has data for at all -- otherwise a
  // China-only scope shows "Multi-kills / map — vs —" rows, since VLR
  // publishes no multi-kill/clutch data for that region.
  const rows = allRows.filter((r) => r.value !== null || r.peer !== null)

  return { rows, peerCount: ranked.length, minRounds, subjectQualified }
}
