/**
 * Builds the Events page's centre list: one row per event, joining this
 * site's own match data to Liquipedia's event metadata
 * (`public/data/event_meta.json` -- dates, prize pool, host city).
 *
 * ITERATES THE EVENTS TABLE, NOT THE MATCH ROWS
 * ----------------------------------------------
 * The previous Tournaments page built its list by grouping
 * `expandMatchRows()` output by event, which silently hides any event with
 * zero matches. That is not hypothetical: `Valorant Champions 2026` is the
 * one event in the dataset with no rows yet (verified -- 63 of the 64 events
 * in `match_results.json`'s own lookup have rows), so the single most
 * interesting entry for a "Scheduled" tab was invisible. This reads the
 * `events` lookup instead and left-joins match aggregates onto it.
 *
 * WHY `match_results.json`'s LOOKUP AND NOT `events.json`
 * -------------------------------------------------------
 * `events.json` holds only the 55 VCT events; the embedded lookup holds 64.
 * The 9 EWC events (Esports World Cup 2026 + its regional qualifiers, plus
 * the 2025 set) exist ONLY in the lookup -- they have no `events.json` row,
 * and therefore no `slug`. Building from `events.json` would drop every EWC
 * event from the page. The lookup is the complete index; `events.json` is
 * not, despite the name.
 *
 * That is also why `event_meta.json` is keyed by event NAME rather than by
 * slug the way `tournament_structure.json` is: `name` is the only identifier
 * both sources carry for every event, and it is already this page's route
 * param (`/tournaments/{name}`).
 */

import { todayKey } from './format'

/** Aggregates computed per event from its own matches, in one pass. */
function aggregateMatches(records) {
  const byEvent = new Map()
  for (const m of records || []) {
    let agg = byEvent.get(m.event)
    if (!agg) {
      agg = { matchCount: 0, teams: new Set(), phases: new Set(), first: null, last: null }
      byEvent.set(m.event, agg)
    }
    agg.matchCount += 1
    if (m.team1) agg.teams.add(m.team1)
    if (m.team2) agg.teams.add(m.team2)
    if (m.w) agg.phases.add(m.w.includes(':') ? m.w.split(':')[0].trim() : m.w)
    if (m.date) {
      if (!agg.first || m.date < agg.first) agg.first = m.date
      if (!agg.last || m.date > agg.last) agg.last = m.date
    }
  }
  return byEvent
}

/**
 * `live` / `upcoming` / `finished`.
 *
 * Liquipedia's own start/end dates are the primary signal -- they are the
 * only thing that can classify an event with no matches at all (Champions
 * 2026), and they correctly keep a league "live" through a mid-split gap
 * where a naive last-match-date rule would call it finished. Real scheduled
 * fixtures override, so an event that overruns its published end date
 * doesn't flip to finished while matches are still on the calendar.
 */
function deriveStatus({ startDate, endDate, hasUpcoming, today }) {
  if (startDate && today < startDate) return 'upcoming'
  if (hasUpcoming) return 'live'
  if (endDate && today <= endDate) return 'live'
  if (!startDate && !endDate && !hasUpcoming) return 'finished'
  return 'finished'
}

/**
 * One row per event, newest activity first.
 *
 * `matchData` is the raw `match_results.json` (needed for its `events`
 * lookup, which `expandMatchRows` discards); `records` is the already-expanded
 * row list the page also uses elsewhere, passed in rather than re-expanded.
 */
export function buildEventList(matchData, records, eventMetaData, upcomingData, now = new Date()) {
  const lookup = matchData?.events
  if (!lookup) return []

  const today = todayKey(now)
  const meta = eventMetaData?.events ?? {}
  const aggs = aggregateMatches(records)

  const upcomingByEvent = new Map()
  for (const m of upcomingData?.matches ?? []) {
    upcomingByEvent.set(m.event, (upcomingByEvent.get(m.event) ?? 0) + 1)
  }

  const out = []
  for (const ev of Object.values(lookup)) {
    const agg = aggs.get(ev.name)
    const em = meta[ev.name] ?? null

    // Liquipedia's dates when known, else the event's own first/last match --
    // the degraded path that keeps every pre-2026 event (which this scraper
    // deliberately doesn't cover) sorting and grouping correctly.
    const startDate = em?.startDate ?? agg?.first ?? null
    const endDate = em?.endDate ?? agg?.last ?? null
    const hasUpcoming = (upcomingByEvent.get(ev.name) ?? 0) > 0

    out.push({
      name: ev.name,
      region: ev.region,
      split: ev.stage,
      competition: ev.competition,
      year: ev.year,
      startDate,
      endDate,
      // Only true when Liquipedia actually supplied dates -- lets the UI show
      // a real range rather than implying a scraped one it doesn't have.
      hasMeta: !!em,
      prizePoolUsd: em?.prizePoolUsd ?? null,
      city: em?.city ?? null,
      country: em?.country ?? null,
      countryCode: em?.countryCode ?? null,
      venue: em?.venue ?? null,
      tier: em?.tier ?? null,
      matchCount: agg?.matchCount ?? 0,
      teamCount: agg?.teams.size ?? 0,
      phaseCount: agg?.phases.size ?? 0,
      upcomingCount: upcomingByEvent.get(ev.name) ?? 0,
      status: deriveStatus({ startDate, endDate, hasUpcoming, today }),
    })
  }
  return out
}

/**
 * Splits into the page's two tabs and orders each the way its tab implies:
 * Scheduled ascending (soonest first -- what a schedule is for), Finished
 * descending (most recent first).
 *
 * An event with no dates at all sorts to the TOP of Scheduled rather than
 * being dropped, so a newly-added event with no metadata yet is visible
 * instead of silently missing.
 */
export function splitByStatus(events) {
  const scheduled = events
    .filter((e) => e.status !== 'finished')
    .sort((a, b) => {
      if (!a.startDate && !b.startDate) return a.name.localeCompare(b.name)
      if (!a.startDate) return -1
      if (!b.startDate) return 1
      return a.startDate.localeCompare(b.startDate)
    })
  const finished = events
    .filter((e) => e.status === 'finished')
    .sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))
  return { scheduled, finished }
}

/**
 * Groups an ordered event list under month headers, preserving the order it
 * was given (so Scheduled reads forwards and Finished backwards) rather than
 * imposing one. Undated events collect under a "TBD" bucket.
 *
 * `pick` MUST return whichever date the caller sorted by. Grouping on a
 * different date than the sort produces non-consecutive repeats of the same
 * month -- caught live rather than reasoned about: the Finished tab is sorted
 * by end date, and grouping it by START date rendered "MAY 2026" and "APRIL
 * 2026" twice each (an event running Apr->May sorts among the May-enders but
 * opens an April group), which React also flagged as duplicate keys.
 */
export function groupByMonth(events, pick = (e) => e.startDate) {
  const groups = []
  let current = null
  for (const e of events) {
    const date = pick(e)
    const key = date ? date.slice(0, 7) : 'tbd'
    if (!current || current.key !== key) {
      current = { key, anchorDate: date, events: [] }
      groups.push(current)
    }
    current.events.push(e)
  }
  return groups
}

/**
 * The left rail's circuit list: the current season's events, soonest-relevant
 * first. Live events lead (they're the reason to look), then upcoming by
 * start date, then the most recently finished.
 */
export function currentCircuits(events, limit = 9) {
  const year = Math.max(...events.map((e) => e.year ?? 0))
  const rank = { live: 0, upcoming: 1, finished: 2 }
  return events
    .filter((e) => e.year === year)
    .sort((a, b) => {
      const r = rank[a.status] - rank[b.status]
      if (r !== 0) return r
      return a.status === 'finished'
        ? (b.endDate || '').localeCompare(a.endDate || '')
        : (a.startDate || '').localeCompare(b.startDate || '')
    })
    .slice(0, limit)
}
