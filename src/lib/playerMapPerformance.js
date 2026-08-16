import { groupMatchPlayers } from './entityBuckets'

/**
 * One row per MAP (not per match/series) for a single player, sourced by
 * joining match_results.json (series shape, `maps[]`) against
 * match_players.json (`ag[]`, that player's own per-map agent pick) against
 * team_map_detail.json (`pl`, that team's per-map per-agent rating/ACS/etc
 * -- see compositions.js's buildTeamMapRows() for the same three-file join,
 * reused here for a single player instead of a whole team-map).
 *
 * match_players.json's own `r` field is the SERIES average, not per-map --
 * there's no per-map rating anywhere except team_map_detail.json's `pl`
 * array, which has no player name field, only `[agent, ...stats]` per team
 * -- so a player's own per-map row has to be found by matching their `ag[i]`
 * (this map's agent, from match_players.json) against `pl`'s own agent
 * field. Safe to key on agent alone (not player+agent) because a team can't
 * run two players on the same agent in the same map under standard
 * competitive rules -- confirmed no such collision needs handling.
 *
 * `detail.pl`'s compact per-player array is `[agent, rounds, kills, deaths,
 * assists, firstKills, firstDeaths, rating, acs, kast, adr, hsPct]` (see
 * export_from_db.py's own comment on this exact shape) -- every field is
 * surfaced here (not just rating) so PerformanceStrip's metric dropdown can
 * switch which stat drives the chart without a second join.
 */
export function buildPlayerMapPerformance(matches, matchPlayersData, teamMapDetailData, playerName) {
  if (!matches?.length || !matchPlayersData || !teamMapDetailData) return []

  const playersByMatch = groupMatchPlayers(matchPlayersData)
  const detailByKey = new Map()
  for (const d of teamMapDetailData.rows) {
    detailByKey.set(`${d.m}|${d.mi}|${d.t}`, d)
  }

  const ordered = [...matches].sort(
    (a, b) => (a.ts || a.date || '').localeCompare(b.ts || b.date || '') || a.id - b.id
  )

  const out = []
  for (const m of ordered) {
    const scoreboard = playersByMatch.get(m.id) || []
    const mine = scoreboard.find((r) => r.p === playerName)
    if (!mine) continue
    const isTeam1 = m.team1 === mine.t
    const myTeam = mine.t
    const opponent = isTeam1 ? m.team2 : m.team1
    const nMaps = m.maps?.length || 0

    for (let i = 0; i < nMaps; i++) {
      const agent = mine.ag?.[i]
      if (!agent) continue // mid-series substitution -- no agent recorded for this map
      const mm = m.maps[i]
      const myScore = isTeam1 ? mm.s1 : mm.s2
      const oppScore = isTeam1 ? mm.s2 : mm.s1
      const detail = detailByKey.get(`${m.id}|${i + 1}|${myTeam}`) // mi is 1-indexed, i is 0-indexed
      const entry = detail?.pl?.find(([a]) => a === agent)
      const [, , kills, deaths, assists, fk, fd, rtg, acs, kast, adr, hsPct] = entry || []
      out.push({
        id: `${m.id}-${i}`,
        matchId: m.id,
        mapIndex: i,
        // VLR's own opaque per-map id, straight off match_results.json's
        // `maps[i].gid` -- null for anything scraped before the scraper
        // started keeping it (see export_from_db.py's own comment), in
        // which case the map just links to the match overall instead (see
        // vlrMapUrl's own fallback).
        gameId: mm.gid ?? null,
        map: mm.map,
        date: m.date,
        ts: m.ts,
        opponent,
        won: myScore === oppScore ? null : myScore > oppScore,
        score: `${myScore}–${oppScore}`,
        agent,
        rating: rtg ?? null,
        acs: acs ?? null,
        adr: adr ?? null,
        kast: kast ?? null,
        hsPct: hsPct ?? null,
        kills: kills ?? null,
        deaths: deaths ?? null,
        assists: assists ?? null,
        fk: fk ?? null,
        fd: fd ?? null,
      })
    }
  }
  return out
}
