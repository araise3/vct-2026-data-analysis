/**
 * Event-based "who held which seat" roster history for a team profile --
 * replaces the old calendar Gantt chart entirely (see RosterTimeline.jsx).
 * Rows are events (VCT/EWC, chronological); columns are the team's 5
 * starting seats, each a "seat succession chain" rather than a fixed role
 * or a person's own lane -- when a starter leaves and someone else takes
 * over, the new player continues in the SAME column the old one held,
 * the same way a spreadsheet-style manual roster tracker reads.
 *
 * Deliberately NOT scoped to the page's active filter selections (same
 * independence the old calendar chart already had, via its own separate
 * Last year/All time toggle) -- this is meant to read as one continuous
 * team history, not shrink to whatever a Region/Event chip happens to be
 * set to elsewhere on the page.
 *
 * Built mostly from player_buckets.json, already fetched on TeamProfile
 * for the Players table -- no separate match-level fetch needed for the
 * row/column skeleton itself. Each bucket already carries maps played per
 * (player, event, week) with a team field, so summing `maps` across a
 * player's buckets sharing one event id gives exactly "how many maps this
 * player played for this team in this event", which is the input the
 * seat-ranking/succession logic below needs. Event chronology (which ROW
 * an event lands on) comes from real match dates via buildEventDateOrder,
 * not event id order -- see that function's own comment for why id order
 * isn't safe.
 *
 * `matchPlayersRows` is an optional extra input that layers on top of that
 * skeleton without changing it: it resolves WITHIN a split seat cell which
 * occupant actually played first -- see buildPlayerEventDates below for
 * why the event-row-level date isn't granular enough for that. Omitting
 * it leaves split-seat occupants in their old maps-descending order.
 */

const NUM_SEATS = 5

function seatMaps(seat) {
  return seat.occupants.reduce((sum, o) => sum + o.maps, 0)
}

// An overflow occupant needs to represent at least this share of a
// seat's resulting total maps to get its own visible split -- otherwise
// it's folded away entirely and the primary occupant keeps the whole
// cell. User-reported from a real render: a 7-map Benkai stint sharing a
// seat with a 24-map "something" (22.6% share) rendered as an
// illegibly thin sliver and read as noise, not real roster information.
// Calibrated against every real overflow case in the current dataset
// (110 of them, `node`-computed directly against player_buckets.json,
// not guessed) rather than picked to fit this one example: share alone
// forms a smooth, gapless spread from ~3% to 50% with no natural cutoff,
// but 1/3 lands cleanly between the genuinely trivial single/double-map
// appearances (Paper Rex's cgrs at 1 map/3.3%, Sentinels' Victor at 2
// maps/16.7%, Marved at 3 maps/27.3% -- all correctly dropped) and the
// real near-50/50 in-event swaps this feature exists to surface
// (Sentinels' TenZ/Marved at 48.1%, Gen.G's eKo/Sylvan at 48.3%, T1's
// carpe/Rossy at an even 50% -- all correctly kept). Equivalent to
// requiring the overflow occupant's own maps to be at least half the
// primary occupant's, which is the more intuitive way to state the same
// rule: maps >= primary/2  <=>  maps/(maps+primary) >= 1/3.
const MIN_OVERFLOW_SHARE = 1 / 3

/**
 * One event's roster snapshot: the top NUM_SEATS players by maps played
 * become the seats. A 6th+ contributor (a genuine in-event substitution,
 * not a whole new starter) is folded into whichever of those seats has
 * the fewest maps that event -- the seat most likely to be the one they
 * shared -- as a second occupant, per direct instruction: a mid-event
 * swap should split that one seat's row rather than opening a 6th
 * column. That fold-in only happens if it clears MIN_OVERFLOW_SHARE
 * (see above); otherwise the contributor is dropped from the table
 * entirely rather than rendered as an unreadably thin band. `primary` is
 * whichever occupant played more of that seat, used for succession-
 * matching and for the cell's dominant label/color -- deliberately still
 * maps-based, not date-based: the primary is "who held this seat the
 * most", not "who held it first".
 *
 * `occupants` IS date-ordered when `playerDates` is available (earliest
 * first), independent of who's primary -- this is what the visible
 * top-to-bottom stacking in a split cell reads off (see SeatCell in
 * RosterTimeline.jsx). User-reported bug this fixes: occupants used to
 * render in maps-descending order, which put whoever played MORE of a
 * seat on top regardless of when they actually played it -- e.g. a real
 * Kickoff 2026 case where PxS played first and Neon took over afterward,
 * but Neon (more total maps that event) rendered above PxS, reading as
 * "Neon played before PxS" to anyone scanning top-to-bottom. `playerDates`
 * keys are `${eventId}:${player}`, built by buildPlayerEventDates.
 */
function buildEventSeats(playerMaps, eventId, playerDates) {
  const sorted = [...playerMaps.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, NUM_SEATS)
  const overflow = sorted.slice(NUM_SEATS)

  const seats = top.map(([player, maps]) => ({ occupants: [{ player, maps }] }))
  for (const [player, maps] of overflow) {
    seats.sort((a, b) => seatMaps(a) - seatMaps(b))
    const weakest = seats[0]
    const share = maps / (maps + seatMaps(weakest))
    if (share < MIN_OVERFLOW_SHARE) continue
    weakest.occupants.push({ player, maps })
  }
  return seats.map((seat) => {
    const occupants = [...seat.occupants]
    if (occupants.length > 1 && playerDates) {
      occupants.sort((a, b) => {
        const da = playerDates.get(`${eventId}:${a.player}`)
        const db = playerDates.get(`${eventId}:${b.player}`)
        if (!da || !db) return 0
        return da < db ? -1 : da > db ? 1 : 0
      })
    }
    return {
      occupants,
      primary: [...occupants].sort((a, b) => b.maps - a.maps)[0].player,
    }
  })
}

/**
 * Earliest match date per (event, player), for ordering occupants WITHIN
 * a split seat cell chronologically -- the event-row-level date from
 * buildEventDateOrder isn't granular enough for that, since both
 * occupants of a split seat share the same event (and thus the same row
 * date) by construction.
 *
 * Needs a real per-match join, not anything in player_buckets.json --
 * that file's buckets are grouped by (player, event, WEEK), and a week
 * label ("Lower Round 1", "Week 2") isn't a reliable chronology proxy on
 * its own (bracket round names don't sort, and don't carry a date at
 * all). match_players.json rows carry the match id (`m`) and the player's
 * team (`t`) but no date of their own; match_results.json rows carry the
 * date and event id (`e`) per match id, plus team1/team2 to scope to just
 * this team's own matches. Joining the two gives an actual per-match date
 * per player, which is then reduced to the earliest one per event.
 *
 * Both inputs are the full site-wide row lists (not pre-filtered to this
 * team) -- filtering happens here, once, rather than asking every caller
 * to pre-scope two different files consistently.
 */
function buildPlayerEventDates(team, matchResultsRows, matchPlayersRows) {
  const out = new Map()
  if (!matchResultsRows || !matchPlayersRows) return out

  const matchInfo = new Map() // matchId -> { date, eventId }
  for (const r of matchResultsRows) {
    if (r.team1 !== team && r.team2 !== team) continue
    matchInfo.set(r.id, { date: r.date, eventId: r.e })
  }

  for (const mp of matchPlayersRows) {
    if (mp.t !== team) continue
    const info = matchInfo.get(mp.m)
    if (!info) continue
    const key = `${info.eventId}:${mp.p}`
    const prev = out.get(key)
    if (!prev || info.date < prev) out.set(key, info.date)
  }
  return out
}

/**
 * Earliest match date per event id, read from match_results.json's own
 * `rows` (every match on the site, not just this team's -- only the
 * event->date mapping is needed, so there's no reason to filter first).
 * Event id order is NOT a safe chronology proxy on its own: EWC 2025's
 * three regional qualifiers are SYNTHETIC ids (90001-90003, assigned by
 * export_from_db.py's split_ewc_2025_qualifiers() -- see CLAUDE.md --
 * nowhere near any real id range) that sort dead last by plain numeric id
 * despite having happened in May 2025, confirmed live: "EWC Americas
 * Qualifier 2025" was rendering after the 2026 season entirely before
 * this was switched to real dates.
 */
function buildEventDateOrder(matchResultsRows) {
  const minDate = new Map()
  for (const r of matchResultsRows) {
    const prev = minDate.get(r.e)
    if (!prev || r.date < prev) minDate.set(r.e, r.date)
  }
  return minDate
}

/**
 * `playerBucketsData`: the raw { events, meta, buckets } shape from
 * player_buckets.json (NOT expandBuckets'd -- this only needs the raw
 * `p`/`e`/`t`/`maps` fields, which are cheap to read directly; see
 * expandBuckets's own `keep` predicate for the same "filter the raw
 * bucket before doing any real work" pattern used elsewhere on this site).
 * `team`: canonical team name, matching the bucket's own `t` field.
 * `matchResultsRows`: match_results.json's `rows` array, used both to
 * derive each event's real chronological position (see
 * buildEventDateOrder above) and, together with `matchPlayersRows`, to
 * order occupants within a split seat (see buildPlayerEventDates) --
 * already fetched on TeamProfile.jsx for Match History, so the first use
 * adds no new network cost.
 * `matchPlayersRows` (optional): match_players.json's `rows` array. Only
 * needed for the split-seat chronology fix above; omitting it leaves
 * split-seat occupants in maps-descending order same as before.
 *
 * Returns rows in chronological order:
 *   [{ eventId, event: { name, region, stage, competition, year },
 *      seats: [seatOrNull x NUM_SEATS] }]
 */
export function buildRosterEventTable(playerBucketsData, team, matchResultsRows, matchPlayersRows) {
  if (!playerBucketsData || !team) return []
  const { buckets, events } = playerBucketsData

  const perEvent = new Map() // eventId -> Map(player -> mapsPlayed)
  for (const b of buckets) {
    if (b.t !== team) continue
    if (!perEvent.has(b.e)) perEvent.set(b.e, new Map())
    const m = perEvent.get(b.e)
    m.set(b.p, (m.get(b.p) || 0) + (b.maps || 0))
  }

  const eventDate = buildEventDateOrder(matchResultsRows || [])
  // An event with no match_results row at all (shouldn't happen -- every
  // event a player has stats for has real matches) falls back to id order
  // rather than crashing or silently dropping the row.
  const eventIds = [...perEvent.keys()].sort((a, b) => {
    const da = eventDate.get(a)
    const db = eventDate.get(b)
    if (da && db) return da < db ? -1 : da > db ? 1 : 0
    return a - b
  })

  const playerDates = buildPlayerEventDates(team, matchResultsRows, matchPlayersRows)

  let columns = new Array(NUM_SEATS).fill(null) // current primary occupant per column
  const rows = []

  for (const eventId of eventIds) {
    const eventSeats = buildEventSeats(perEvent.get(eventId), eventId, playerDates)

    // Seat succession: a continuing player keeps their existing column;
    // anyone new (a fresh signing, or stepping into a just-vacated seat)
    // fills whichever column index is still open, in index order -- this
    // keeps the same left-to-right column identity stable run over run
    // without needing to model which specific person a newcomer
    // "replaced".
    const assigned = new Array(NUM_SEATS).fill(null)
    const unassigned = []
    for (const seat of eventSeats) {
      const idx = columns.indexOf(seat.primary)
      if (idx !== -1 && !assigned[idx]) assigned[idx] = seat
      else unassigned.push(seat)
    }
    for (const seat of unassigned) {
      const idx = assigned.findIndex((s) => !s)
      if (idx !== -1) assigned[idx] = seat
      // (more than NUM_SEATS distinct seats in one event is not expected --
      // overflow players are already folded into an existing seat above --
      // so a seat silently dropped here would only happen if a team fielded
      // more than 5 simultaneous seat-holders, which the model doesn't try
      // to represent.)
    }

    columns = assigned.map((s) => (s ? s.primary : null))
    rows.push({
      eventId,
      event: events[eventId],
      seats: assigned,
    })
  }

  return rows
}
