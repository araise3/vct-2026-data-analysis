/**
 * Agent-role inference. Valorant has no position field the way LoL has a
 * lane, but agent role is the same concept in practice -- it's what
 * PlayerProfile's role badge next to a player's name is built from.
 */
import agentRoles from './agentRoles.json'

/**
 * Every player's role in the current scope, inferred from the agents they
 * actually played, weighted by maps.
 *
 * Inferred per scope rather than as a static career label, so a player
 * who moved from Sentinel to Duelist between splits gets the right label
 * for whichever split is filtered.
 *
 * Players whose agents are all missing from agentRoles.json simply don't
 * appear in the returned map, so callers can treat a missing entry as
 * "role unknown" rather than an invented default.
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
