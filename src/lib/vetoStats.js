/**
 * Team-level map pick/ban stats, built from match_results.json's own
 * `veto` array (see export_from_db.py's own comment on it) -- one ordered
 * list of {t: team|null, a: 'ban'|'pick'|'decider', m: mapName} per match,
 * present only on matches VLR rendered a veto note for. A team profile's
 * own match list is already exactly the input this needs (team1/team2 +
 * maps[] + veto), so this takes `matches` (already team- and scope-
 * filtered, e.g. TeamProfile.jsx's own `matchRows`) rather than reading
 * match_results.json itself.
 *
 * Distinguishes THREE separate provenances for a played map -- own pick,
 * opponent's pick, decider -- because they answer different questions a
 * single "win% per map" can't: a team's own picks show what they're
 * confident in, the opponent's picks show what beats them, and the
 * decider (neither team's choice) is the closest thing to a neutral
 * baseline for how good the team is in general. Banned maps never appear
 * in a match's own `maps[]` at all (they're removed from the pool before
 * anything is played), so their count comes from the veto array alone.
 */
export function aggregateTeamVetoStats(matches, team) {
  const byMap = new Map()
  function mapEntry(name) {
    if (!byMap.has(name)) {
      byMap.set(name, { map: name, banned: 0, picked: 0, decider: 0, pickWins: 0, pickLosses: 0 })
    }
    return byMap.get(name)
  }

  let matchesWithVeto = 0
  const ownPick = { maps: 0, wins: 0 }
  const oppPick = { maps: 0, wins: 0 }
  const decider = { maps: 0, wins: 0 }

  for (const m of matches) {
    if (!m.veto || !m.veto.length) continue
    matchesWithVeto++

    const pickedByUs = new Set()
    const pickedByOpp = new Set()
    let deciderMap = null
    for (const v of m.veto) {
      if (v.a === 'ban' && v.t === team) mapEntry(v.m).banned++
      if (v.a === 'pick' && v.t === team) {
        mapEntry(v.m).picked++
        pickedByUs.add(v.m)
      } else if (v.a === 'pick' && v.t && v.t !== team) {
        pickedByOpp.add(v.m)
      } else if (v.a === 'decider') {
        deciderMap = v.m
        mapEntry(v.m).decider++
      }
    }
    if (!pickedByUs.size && !pickedByOpp.size && !deciderMap) continue

    const isTeam1 = m.team1 === team
    for (const mp of m.maps || []) {
      if (mp.s1 == null || mp.s2 == null || mp.s1 === mp.s2) continue
      const ourScore = isTeam1 ? mp.s1 : mp.s2
      const oppScore = isTeam1 ? mp.s2 : mp.s1
      const won = ourScore > oppScore

      if (pickedByUs.has(mp.map)) {
        ownPick.maps++
        if (won) ownPick.wins++
        const e = mapEntry(mp.map)
        if (won) e.pickWins++
        else e.pickLosses++
      } else if (pickedByOpp.has(mp.map)) {
        oppPick.maps++
        if (won) oppPick.wins++
      } else if (mp.map === deciderMap) {
        decider.maps++
        if (won) decider.wins++
      }
    }
  }

  const withPct = (b) => ({ ...b, winPct: b.maps ? b.wins / b.maps : null })

  return {
    matchesWithVeto,
    ownPick: withPct(ownPick),
    oppPick: withPct(oppPick),
    decider: withPct(decider),
    byMap: [...byMap.values()]
      .map((e) => ({
        ...e,
        pickWinPct: (e.pickWins + e.pickLosses) ? e.pickWins / (e.pickWins + e.pickLosses) : null,
      }))
      .sort((a, b) => (b.banned + b.picked + b.decider) - (a.banned + a.picked + a.decider)),
  }
}
