/**
 * This player's own kill duels against every individual opponent they've
 * faced, summed across every map of every match -- distinct from
 * ComparePlayers.jsx's h2h duels (which fixes BOTH players in advance and
 * only ever looks at the matches between that one specific pair). Here the
 * subject is fixed and every opponent they've ever lined up against is a
 * row, grouped by that opponent's own country per direct request (mirrors
 * vlr.gg's own per-match duel widget -- team logo, player, kills-for/
 * kills-against/diff -- but aggregated across the subject's whole match
 * history instead of one match, and grouped by country instead of by the
 * single opposing team).
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
      })
    }
    const e = byOpponent.get(opponent)
    e.kFor += kFor
    e.kAgainst += kAgainst
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

/**
 * Collapses aggregatePlayerDuelsByOpponent()'s per-opponent groups into one
 * K/D per country -- the subject's own personal K/D specifically against
 * opponents from that country (not that country's own general skill level,
 * which is a different question the site doesn't answer here). Sums kills
 * FIRST across every opponent from a country and divides once, the same
 * sum-first rule every bucket aggregate on this site already follows --
 * averaging each opponent's own K/D ratio instead would weight a 3-kill
 * cameo duel the same as a 40-kill rivalry.
 */
export function aggregateKdByCountry(groups) {
  return groups
    .map((g) => {
      let kFor = 0, kAgainst = 0
      for (const o of g.opponents) {
        kFor += o.kFor
        kAgainst += o.kAgainst
      }
      return {
        code: g.code,
        name: g.name,
        kFor, kAgainst,
        kd: kAgainst ? kFor / kAgainst : null,
        opponents: g.opponents.length,
      }
    })
    .filter((c) => c.kd != null)
    .sort((a, b) => b.kd - a.kd)
}
