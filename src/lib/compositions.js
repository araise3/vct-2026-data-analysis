/**
 * Team-map compositions: joins match_results.json (series/map scores) with
 * match_players.json (per-map agent picks) into one row per (team, map)
 * with that team's 5-agent composition, then aggregates that join several
 * different ways across three different callers:
 *   - AgentCompositions.jsx (pages/Compositions.jsx's body): most-played
 *     compositions ONLY (aggregateCompositions) -- no agent-impact or
 *     role-signature tables, those moved to Agents' own tab (below).
 *   - AgentImpact.jsx (the Agents page's own "Agent impact" tab):
 *     per-agent pick/win/performance (aggregateAgentImpact) and role-shape
 *     trends (aggregateRoleSignatures).
 *   - TeamProfile.jsx's own Compositions section: this one team's
 *     aggregateCompositions rows, plus aggregateCompositionPlayers for each
 *     row's own expandable detail (which player ran each agent, and their
 *     own numbers, within that specific composition).
 *
 * Why a separate join rather than reusing the bucket model: player_agents/
 * team_buckets are pre-summed per (entity, event, week), which is exactly
 * what makes them fast to re-aggregate under arbitrary filters, but they
 * have no notion of "the other four agents on this map" -- a composition is
 * a property of the whole team-map, not of one player-map row. match_players
 * carries a dense per-map agent array per player (`ag`), so the join has to
 * happen here, once, and get cached by each caller (see AgentCompositions.jsx
 * / AgentImpact.jsx / TeamProfile.jsx) rather than re-run per filter change.
 *
 * Every aggregator here follows the same sum-first rule as
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
 *
 * `teamMapDetailData` (public/data/team_map_detail.json, optional) is a raw,
 * NOT bucket-aggregated per-(match, map, team) row carrying attack/defense
 * round counts AND each of that team's 5 players' own per-map headline
 * stats (rating/ACS/ADR/KAST/HS%/kills/deaths/assists/first-kills/first-
 * deaths) -- see that file's own comment in export_from_db.py for why it's
 * shaped this way. Joined in here (keyed by matchId + map index + team, the
 * same index-alignment convention `ag` already relies on) so every row this
 * function already produces carries atkWon/atkPlayed/defWon/defPlayed and a
 * per-agent `playerStats` lookup for free. This is the general mechanism:
 * adding a NEW raw per-match-map file and joining it in here (rather than
 * pre-aggregating it into a bucket file server-side) is how a future stat
 * should be added without an export_from_db.py edit + DB re-run, as long as
 * it's a function of data at this same (match, map, team[, agent]) grain.
 */
export function buildTeamMapRows(matchResultsData, matchPlayersData, teamMapDetailData) {
  const out = new Map()
  if (!matchResultsData || !matchPlayersData) return out

  const playersByMatch = groupMatchPlayers(matchPlayersData)

  const detailByKey = new Map()
  for (const d of teamMapDetailData?.rows ?? []) {
    detailByKey.set(`${d.m}|${d.mi}|${d.t}`, d)
  }

  // detail.pl is a compact [agent, rounds, kills, deaths, assists,
  // firstKills, firstDeaths, rating, acs, kast, adr, hsPct] array per
  // player (see export_from_db.py's own comment on why) -- reshaped here
  // into an {agent: {...}} lookup once per row, so aggregateAgentImpact()
  // can pull one agent's numbers out by name without re-scanning the array.
  function playerStatsByAgent(detail) {
    if (!detail?.pl) return null
    const m = {}
    for (const [agent, rounds, kills, deaths, assists, fk, fd, rating, acs, kast, adr, hsPct] of detail.pl) {
      m[agent] = { rounds, kills, deaths, assists, fk, fd, rating, acs, kast, adr, hsPct }
    }
    return m
  }

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
      // Unsorted, unlike comp/oppComp -- these pair each player with the
      // one agent they played on THIS map, for TeamProfile.jsx's expanded
      // composition-row view (which player, not just which agent). `comp`
      // itself has to stay sorted (it's the composition's own identity
      // key), so this is kept as a separate field rather than derived from
      // it later, once the pairing with `p` is gone.
      const players1 = t1.map((p) => ({ player: p.p, agent: p.ag[i] }))
      const players2 = t2.map((p) => ({ player: p.p, agent: p.ag[i] }))
      const team1Won = mm.s1 > mm.s2
      // team_map_detail.json's own `mi` is 1-indexed (straight from the
      // scrape DB's map_index column, min observed value 1) while `i` here
      // is a plain 0-indexed loop over res.maps -- despite export_from_db.py's
      // own comment claiming these line up, they don't, and joining on `i`
      // directly silently fetches the PREVIOUS map's detail row for every
      // map after the first (and drops the last map's own row entirely,
      // since no `i+1`-th ever gets looked up). Confirmed against real data:
      // match 666497's mi=1/2/3 rows have round totals (atkP+defP) of
      // 21/18/14, which match res.maps[0/1/2]'s own score totals exactly
      // (13+8, 5+13, 13+1) -- i.e. `mi === i + 1`, not `mi === i`.
      //
      // Missing (no team_map_detail row -- e.g. a status mismatch against
      // match_results, or the file wasn't fetched) degrades to null side
      // fields/playerStats rather than throwing; aggregateAgentImpact()
      // already treats missing data as "no data" the same way it treats a
      // below-floor sample, not a crash.
      const detail1 = detailByKey.get(`${res.id}|${i + 1}|${res.team1}`)
      const detail2 = detailByKey.get(`${res.id}|${i + 1}|${res.team2}`)
      rows.push({
        matchId: res.id, map: mm.map, date: res.date,
        team: res.team1, opp: res.team2, comp: c1, oppComp: c2, players: players1,
        won: team1Won ? 1 : 0, roundsWon: mm.s1, roundsLost: mm.s2,
        atkWon: detail1?.atkW ?? null, atkPlayed: detail1?.atkP ?? null,
        defWon: detail1?.defW ?? null, defPlayed: detail1?.defP ?? null,
        playerStats: playerStatsByAgent(detail1),
      })
      rows.push({
        matchId: res.id, map: mm.map, date: res.date,
        team: res.team2, opp: res.team1, comp: c2, oppComp: c1, players: players2,
        won: team1Won ? 0 : 1, roundsWon: mm.s2, roundsLost: mm.s1,
        atkWon: detail2?.atkW ?? null, atkPlayed: detail2?.atkP ?? null,
        defWon: detail2?.defW ?? null, defPlayed: detail2?.defP ?? null,
        playerStats: playerStatsByAgent(detail2),
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
 *
 * atkWinPct/defWinPct/rd apply the same uncontested-only correction,
 * sourced from buildTeamMapRows()'s joined-in atk/def fields, gated behind
 * the same uncPicks >= MIN_AGENT_PICKS floor as winPct.
 *
 * rating/acs/adr/kast/hsPct/kd/kpr/apr/fkpr/fdpr (sourced from
 * `playerStats`, from team_map_detail.json) are DIFFERENT: computed over
 * EVERY pick, contested or not, gated on the larger `picks >=
 * MIN_AGENT_PICKS` instead. A mirrored opponent pick is what creates the
 * win/loss bias (it contributes exactly one win and one loss by
 * construction), but it does nothing to bias an individual player's OWN
 * rating/ACS/etc -- those are that player's own performance regardless of
 * what the opposing team picked, so restricting them to the uncontested
 * subset would only throw away real signal (Omen's uncontested picks are
 * a mere 16% of its total sample -- see the 84% figure above) for no
 * statistical reason. A row can still show null on one stat even with
 * real data on another -- some maps have no ATK/DEF header breakdown
 * published at all (see team_map_detail.json's own export-time note), and
 * VLR occasionally never publishes Rating 2.0 for a match (the same gap
 * documented on player_buckets.json) -- both show up here as that
 * specific stat's own weighted-sum denominator staying at 0, independent
 * of whether other stats have data.
 *
 * Rating/KAST/ADR/HS% are rounds-weighted (wsum-style: value*rounds
 * summed, divided by rounds summed) exactly like player_buckets.json/
 * player_agents.json already are; ACS is weighted per-map (maps summed,
 * not rounds) matching THEIR acsS/acsM convention too; K/D, KPR, APR,
 * FKPR, FDPR are plain counts divided by total rounds/deaths, the same
 * per-round-rate convention entityBuckets.js's aggregatePlayerBuckets uses.
 */
export function aggregateAgentImpact(rows) {
  const acc = {}
  for (const r of rows) {
    for (const a of r.comp) {
      const s = acc[a] || (acc[a] = {
        agent: a, picks: 0, contested: 0, uncPicks: 0, uncWins: 0, uncRW: 0, uncRL: 0,
        uncAtkWon: 0, uncAtkPlayed: 0, uncDefWon: 0, uncDefPlayed: 0,
        pRnd: 0, pK: 0, pD: 0, pA: 0, pFK: 0, pFD: 0,
        ratS: 0, ratR: 0, acsS: 0, acsN: 0, kastS: 0, kastR: 0, adrS: 0, adrR: 0, hsS: 0, hsR: 0,
      })
      s.picks++
      if (r.oppComp.includes(a)) {
        s.contested++
      } else {
        s.uncPicks++
        s.uncWins += r.won
        s.uncRW += r.roundsWon
        s.uncRL += r.roundsLost
        if (r.atkPlayed != null) { s.uncAtkWon += r.atkWon; s.uncAtkPlayed += r.atkPlayed }
        if (r.defPlayed != null) { s.uncDefWon += r.defWon; s.uncDefPlayed += r.defPlayed }
      }

      // Unlike the block above, this runs for EVERY pick (contested or
      // not) -- see this function's own doc comment on why performance
      // stats don't need the uncontested-only restriction.
      const ps = r.playerStats?.[a]
      if (ps) {
        const rnd = ps.rounds || 0
        s.pRnd += rnd
        s.pK += ps.kills || 0
        s.pD += ps.deaths || 0
        s.pA += ps.assists || 0
        s.pFK += ps.fk || 0
        s.pFD += ps.fd || 0
        if (ps.rating != null) { s.ratS += ps.rating * rnd; s.ratR += rnd }
        if (ps.acs != null) { s.acsS += ps.acs; s.acsN += 1 }
        if (ps.kast != null) { s.kastS += ps.kast * rnd; s.kastR += rnd }
        if (ps.adr != null) { s.adrS += ps.adr * rnd; s.adrR += rnd }
        if (ps.hsPct != null) { s.hsS += ps.hsPct * rnd; s.hsR += rnd }
      }
    }
  }

  const all = Object.values(acc).map((s) => {
    const qualifies = s.uncPicks >= MIN_AGENT_PICKS
    const perfQualifies = s.picks >= MIN_AGENT_PICKS
    return {
      agent: s.agent,
      picks: s.picks,
      pickRate: rows.length ? s.picks / rows.length : 0,
      contestedRate: s.picks ? s.contested / s.picks : 0,
      uncontested: s.uncPicks,
      winPct: qualifies ? s.uncWins / s.uncPicks : null,
      atkWinPct: qualifies && s.uncAtkPlayed ? s.uncAtkWon / s.uncAtkPlayed : null,
      defWinPct: qualifies && s.uncDefPlayed ? s.uncDefWon / s.uncDefPlayed : null,
      rd: qualifies ? (s.uncRW - s.uncRL) / s.uncPicks : null,
      rating: perfQualifies && s.ratR ? s.ratS / s.ratR : null,
      acs: perfQualifies && s.acsN ? s.acsS / s.acsN : null,
      kast: perfQualifies && s.kastR ? s.kastS / s.kastR : null,
      adr: perfQualifies && s.adrR ? s.adrS / s.adrR : null,
      hsPct: perfQualifies && s.hsR ? s.hsS / s.hsR : null,
      kd: perfQualifies && s.pD ? s.pK / s.pD : null,
      kpr: perfQualifies && s.pRnd ? s.pK / s.pRnd : null,
      apr: perfQualifies && s.pRnd ? s.pA / s.pRnd : null,
      fkpr: perfQualifies && s.pRnd ? s.pFK / s.pRnd : null,
      fdpr: perfQualifies && s.pRnd ? s.pFD / s.pRnd : null,
    }
  })

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
 * Returns everything sorted by games desc, unfloored -- the top-50 display
 * cap is applied by the caller (AgentCompositions.jsx / TeamProfile.jsx)
 * rather than here, so this stays a pure aggregation any caller can reuse.
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

/**
 * Per-(player, agent) performance breakdown for ONE specific composition (a
 * fixed map + exact 5-agent set) -- "who's actually behind these numbers"
 * for a single row of aggregateCompositions()'s own output. TeamProfile.jsx
 * uses this for its Compositions table's expandable rows: open a
 * composition, see which player ran each of its 5 agents and their own
 * rating/ACS/etc, sourced from team_map_detail.json's per-player rows
 * exactly like aggregateAgentImpact's performance columns are.
 *
 * Keyed by (player, agent) rather than agent alone -- a roster change mid-
 * season can mean two different players both ran the same agent within the
 * same nominal composition across its games in scope (e.g. a duelist swap
 * that kept the rest of the comp identical), and collapsing those into one
 * "agent" row would silently blend two different players' numbers together
 * under one name. `r.players` (built alongside `r.comp` in
 * buildTeamMapRows, see that field's own comment) is what makes the
 * player/agent pairing possible per row.
 *
 * Caller pre-filters `rows` down to exactly the matching composition (same
 * map, same sorted comp) -- this function doesn't re-derive that itself,
 * since a caller already scoped to one map (e.g. TeamProfile's own
 * `compRows`) only needs a single extra `comp` equality check to get there.
 *
 * Unlike aggregateAgentImpact, there's no contested/uncontested split here:
 * every row passed in already belongs to this exact composition by
 * construction (comp is a property of the row itself), so "did the
 * opponent also pick this agent" isn't a meaningful question to ask of a
 * single team's own 5-agent pick -- that's an Agent-impact-table concern.
 * `games` summed across every (player, agent) row for one agent slot is
 * expected to equal that composition's own overall `games` count (a free
 * correctness check that a caller's own pre-filter actually matched a
 * single comp) UNLESS a mid-run substitution split that slot across more
 * than one player, in which case it's split proportionally instead.
 */
export function aggregateCompositionPlayers(rows) {
  const acc = {}
  for (const r of rows) {
    for (const { player, agent } of r.players ?? []) {
      const key = `${player}|${agent}`
      const s = acc[key] || (acc[key] = {
        player, agent, games: 0,
        pRnd: 0, pK: 0, pD: 0, pA: 0, pFK: 0, pFD: 0,
        ratS: 0, ratR: 0, acsS: 0, acsN: 0, kastS: 0, kastR: 0, adrS: 0, adrR: 0,
      })
      s.games++
      const ps = r.playerStats?.[agent]
      if (!ps) continue
      const rnd = ps.rounds || 0
      s.pRnd += rnd
      s.pK += ps.kills || 0
      s.pD += ps.deaths || 0
      s.pA += ps.assists || 0
      s.pFK += ps.fk || 0
      s.pFD += ps.fd || 0
      if (ps.rating != null) { s.ratS += ps.rating * rnd; s.ratR += rnd }
      if (ps.acs != null) { s.acsS += ps.acs; s.acsN += 1 }
      if (ps.kast != null) { s.kastS += ps.kast * rnd; s.kastR += rnd }
      if (ps.adr != null) { s.adrS += ps.adr * rnd; s.adrR += rnd }
    }
  }
  return Object.values(acc)
    .map((s) => ({
      player: s.player,
      agent: s.agent,
      games: s.games,
      rating: s.ratR ? s.ratS / s.ratR : null,
      acs: s.acsN ? s.acsS / s.acsN : null,
      kd: s.pD ? s.pK / s.pD : null,
      kast: s.kastR ? s.kastS / s.kastR : null,
      adr: s.adrR ? s.adrS / s.adrR : null,
      kpr: s.pRnd ? s.pK / s.pRnd : null,
      apr: s.pRnd ? s.pA / s.pRnd : null,
      fkpr: s.pRnd ? s.pFK / s.pRnd : null,
      fdpr: s.pRnd ? s.pFD / s.pRnd : null,
    }))
    .sort((a, b) => b.games - a.games)
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
