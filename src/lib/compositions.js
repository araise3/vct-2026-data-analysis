/**
 * Team-map compositions: joins match_results.json (series/map scores) with
 * match_players.json (per-map agent picks) into one row per (team, map)
 * with that team's 5-agent composition, then aggregates that join three
 * different ways for the Agents page's "Compositions & win rates" tab.
 *
 * Why a separate join rather than reusing the bucket model: player_agents/
 * team_buckets are pre-summed per (entity, event, week), which is exactly
 * what makes them fast to re-aggregate under arbitrary filters, but they
 * have no notion of "the other four agents on this map" -- a composition is
 * a property of the whole team-map, not of one player-map row. match_players
 * carries a dense per-map agent array per player (`ag`), so the join has to
 * happen here, once, and get cached (see AgentCompositions.jsx) rather than
 * re-run per filter change.
 *
 * All three aggregators here follow the same sum-first rule as
 * entityBuckets.js: accumulate raw counts (games/wins/roundsWon/roundsLost)
 * across rows, divide once at the end. Never average a per-row percentage.
 */

import agentRoles from './agentRoles.json'
import { groupMatchPlayers } from './entityBuckets'

/**
 * Joins match_results rows with match_players rows into team-map rows,
 * keyed by match id so the caller can select scoped rows by joining against
 * an already-filtered set of match records (see AgentCompositions.jsx)
 * without attaching facet fields to 9.5k rows or re-running this join on
 * every filter change.
 *
 * Both sides of every map are emitted as separate rows (one for each team),
 * so `sum(row.won)` across any subset of the returned rows is always
 * exactly half that subset's length -- verified against the real data at
 * VCT-2026 scope: 2,504 rows / 1,252 wins.
 *
 * A player's `ag` array is dense (only the maps they actually played) with
 * no index marker for which map a short array covers -- mid-series
 * substitutions produce `ag.length < maps.length`. There's no way to tell
 * which map(s) such a player is missing from, so any (match, team) whose
 * count of "played every map" players isn't exactly 5 is dropped --
 * including the whole match if EITHER team fails, to keep the two team-map
 * rows per map symmetric. Measured cost: 9,595 -> 9,504 team-maps kept
 * (99.0%) across the full dataset.
 */
export function buildTeamMapRows(matchResultsData, matchPlayersData) {
  const out = new Map()
  if (!matchResultsData || !matchPlayersData) return out

  const playersByMatch = groupMatchPlayers(matchPlayersData)

  for (const res of matchResultsData.rows) {
    const prs = playersByMatch.get(res.id)
    if (!prs) continue // forfeits / missing scrapes -- no player rows at all

    const nMaps = res.maps?.length
    if (!nMaps) continue

    const t1 = []
    const t2 = []
    for (const p of prs) {
      if (p.ag.length !== nMaps) continue // substitution mid-series, index unknown
      if (p.t === res.team1) t1.push(p)
      else if (p.t === res.team2) t2.push(p)
    }
    if (t1.length !== 5 || t2.length !== 5) continue // drop whole match (both sides)

    const rows = []
    for (let i = 0; i < nMaps; i++) {
      const mm = res.maps[i]
      if (mm.s1 === mm.s2) continue // never happens in practice; defensive
      const c1 = t1.map((p) => p.ag[i]).sort()
      const c2 = t2.map((p) => p.ag[i]).sort()
      const team1Won = mm.s1 > mm.s2
      rows.push({
        matchId: res.id, map: mm.map, date: res.date,
        team: res.team1, opp: res.team2, comp: c1, oppComp: c2,
        won: team1Won ? 1 : 0, roundsWon: mm.s1, roundsLost: mm.s2,
      })
      rows.push({
        matchId: res.id, map: mm.map, date: res.date,
        team: res.team2, opp: res.team1, comp: c2, oppComp: c1,
        won: team1Won ? 0 : 1, roundsWon: mm.s2, roundsLost: mm.s1,
      })
    }
    if (rows.length) out.set(res.id, rows)
  }
  return out
}

const MIN_AGENT_PICKS = 10

/**
 * Per-agent pick/contest/win-rate summary. Win% and RD are computed only
 * from UNCONTESTED picks (maps where the opponent did NOT also run the
 * agent) -- a mirrored pick contributes exactly one win and one loss by
 * construction, which drags every contested agent's raw win rate toward
 * 50% regardless of how strong the pick actually is. Measured mirror rates
 * are large enough that this matters a lot: Omen 84% of its picks
 * mirrored, Sova 80%, Viper 76%, Brimstone 82%.
 */
export function aggregateAgentImpact(rows) {
  const acc = {}
  for (const r of rows) {
    for (const a of r.comp) {
      const s = acc[a] || (acc[a] = {
        agent: a, picks: 0, contested: 0, uncPicks: 0, uncWins: 0, uncRW: 0, uncRL: 0,
      })
      s.picks++
      if (r.oppComp.includes(a)) {
        s.contested++
      } else {
        s.uncPicks++
        s.uncWins += r.won
        s.uncRW += r.roundsWon
        s.uncRL += r.roundsLost
      }
    }
  }

  const all = Object.values(acc).map((s) => ({
    agent: s.agent,
    picks: s.picks,
    pickRate: rows.length ? s.picks / rows.length : 0,
    contestedRate: s.picks ? s.contested / s.picks : 0,
    uncontested: s.uncPicks,
    winPct: s.uncPicks >= MIN_AGENT_PICKS ? s.uncWins / s.uncPicks : null,
    rd: s.uncPicks >= MIN_AGENT_PICKS ? (s.uncRW - s.uncRL) / s.uncPicks : null,
  }))

  const agents = all.filter((s) => s.picks >= MIN_AGENT_PICKS).sort((a, b) => b.picks - a.picks)
  const omitted = all
    .filter((s) => s.picks < MIN_AGENT_PICKS)
    .sort((a, b) => b.picks - a.picks)
    .map((s) => ({ agent: s.agent, picks: s.picks }))

  return { agents, omitted }
}

/**
 * Most-played 5-agent compositions. Identity is (map, sorted comp) -- the
 * same five agents on Lotus and on Bind are not pooled together, including
 * under "All maps", since a composition is inherently a map-specific
 * strategic choice.
 *
 * Returns everything sorted by games desc, unfloored -- the min-games floor
 * and top-50 cap are applied by the caller (AgentCompositions.jsx) so the
 * "Min games" chip control doesn't force re-running this aggregation.
 */
export function aggregateCompositions(rows) {
  const acc = new Map()
  const mapTotals = {}

  for (const r of rows) {
    mapTotals[r.map] = (mapTotals[r.map] || 0) + 1
    const key = `${r.map}|${r.comp.join('|')}`
    let s = acc.get(key)
    if (!s) {
      s = { key, map: r.map, comp: r.comp, compLabel: r.comp.join(', '), games: 0, wins: 0, rw: 0, rl: 0 }
      acc.set(key, s)
    }
    s.games++
    s.wins += r.won
    s.rw += r.roundsWon
    s.rl += r.roundsLost
  }

  const distinctByMap = {}
  const comps = [...acc.values()]
    .map((s) => {
      distinctByMap[s.map] = (distinctByMap[s.map] || 0) + 1
      return {
        key: s.key, map: s.map, comp: s.comp, compLabel: s.compLabel,
        games: s.games,
        share: mapTotals[s.map] ? s.games / mapTotals[s.map] : 0,
        winPct: s.games ? s.wins / s.games : null,
        rd: s.games ? (s.rw - s.rl) / s.games : null,
      }
    })
    .sort((a, b) => b.games - a.games)

  return { comps, mapTotals, distinctByMap }
}

/** D/I/C/S role counts for one 5-agent composition. Shared so both the
 * aggregator below and any future caller derive a signature identically. */
export function roleSignature(comp) {
  const counts = { Duelist: 0, Initiator: 0, Controller: 0, Sentinel: 0, Unknown: 0 }
  for (const a of comp) {
    const role = agentRoles[a] ?? 'Unknown'
    counts[role] = (counts[role] || 0) + 1
  }
  const { Duelist: D, Initiator: I, Controller: C, Sentinel: S, Unknown: unknown } = counts
  const key = `${D}-${I}-${C}-${S}${unknown ? `-u${unknown}` : ''}`
  const label = `${D}D · ${I}I · ${C}C · ${S}S${unknown ? ` · ${unknown}?` : ''}`
  return { D, I, C, S, unknown, key, label }
}

const MIN_SIGNATURE_GAMES = 10

/**
 * Role-shape (double-controller vs. sentinel-less vs. double-duelist, etc.)
 * win rates. Unlike aggregateCompositions, this pools across maps even when
 * a specific map is selected upstream by the caller passing "All maps"
 * rows -- a role signature is a general strategic shape, not a map-specific
 * artifact, so it's meant to aggregate broadly.
 */
export function aggregateRoleSignatures(rows) {
  const acc = new Map()
  for (const r of rows) {
    const sig = roleSignature(r.comp)
    let s = acc.get(sig.key)
    if (!s) {
      s = { key: sig.key, label: sig.label, games: 0, wins: 0, rw: 0, rl: 0 }
      acc.set(sig.key, s)
    }
    s.games++
    s.wins += r.won
    s.rw += r.roundsWon
    s.rl += r.roundsLost
  }

  const all = [...acc.values()].map((s) => ({
    key: s.key, label: s.label, games: s.games,
    share: rows.length ? s.games / rows.length : 0,
    winPct: s.games ? s.wins / s.games : null,
    rd: s.games ? (s.rw - s.rl) / s.games : null,
  }))

  const signatures = all.filter((s) => s.games >= MIN_SIGNATURE_GAMES).sort((a, b) => b.games - a.games)
  const omittedCount = all.length - signatures.length

  return { signatures, omittedCount }
}
