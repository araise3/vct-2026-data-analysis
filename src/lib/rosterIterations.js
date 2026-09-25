/**
 * Consecutive series with the same participating players form one roster
 * iteration. Match-level lineups preserve substitutions within an event,
 * which the event-level roster chart intentionally compresses into one row.
 */
export function buildRosterIterations(matchResults, matchPlayers, team) {
  if (!matchResults?.rows || !matchPlayers?.rows || !team) return []

  const playersByMatch = new Map()
  for (const row of matchPlayers.rows) {
    if (row.t !== team) continue
    if (!playersByMatch.has(row.m)) playersByMatch.set(row.m, [])
    playersByMatch.get(row.m).push(row)
  }

  const matches = matchResults.rows
    .filter((match) => match.team1 === team || match.team2 === team)
    .sort((a, b) => (a.ts || a.date).localeCompare(b.ts || b.date) || a.id - b.id)

  const iterations = []
  let current = null
  for (const match of matches) {
    const playerRows = playersByMatch.get(match.id) || []
    const players = [...new Set(playerRows.map((row) => row.p))].sort((a, b) => a.localeCompare(b))
    // An incomplete scoreboard cannot identify a lineup. It also breaks a
    // run, so two identical lineups around it are never silently joined.
    if (players.length < 5) {
      current = null
      continue
    }

    const signature = players.join('\u0000')
    if (!current || current.signature !== signature) {
      current = {
        signature, players, firstDate: match.date, lastDate: match.date,
        eventIds: [], matchIds: [], seriesWon: 0, seriesLost: 0,
        mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0,
        kills: 0, deaths: 0, ratingSum: 0, ratingRounds: 0,
      }
      iterations.push(current)
    }

    current.lastDate = match.date
    current.matchIds.push(match.id)
    if (!current.eventIds.includes(match.e)) current.eventIds.push(match.e)

    const isTeam1 = match.team1 === team
    const ownScore = isTeam1 ? match.s1 : match.s2
    const opponentScore = isTeam1 ? match.s2 : match.s1
    if (ownScore > opponentScore) current.seriesWon += 1
    else if (ownScore < opponentScore) current.seriesLost += 1

    for (const map of match.maps || []) {
      const ownRounds = isTeam1 ? map.s1 : map.s2
      const opponentRounds = isTeam1 ? map.s2 : map.s1
      if (ownRounds > opponentRounds) current.mapsWon += 1
      else if (ownRounds < opponentRounds) current.mapsLost += 1
      current.roundsWon += ownRounds || 0
      current.roundsLost += opponentRounds || 0
    }

    for (const row of playerRows) {
      current.kills += row.k || 0
      current.deaths += row.d || 0
      if (Number.isFinite(row.r) && row.rnd > 0) {
        current.ratingSum += row.r * row.rnd
        current.ratingRounds += row.rnd
      }
    }
  }

  return iterations.map((iteration, index) => ({
    ...iteration,
    number: index + 1,
    avgRating: iteration.ratingRounds ? iteration.ratingSum / iteration.ratingRounds : null,
    kd: iteration.deaths ? iteration.kills / iteration.deaths : null,
  }))
}
