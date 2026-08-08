/**
 * Turns `public/data/upcoming_matches.json` (Liquipedia's fixture feed) into
 * the day-bucketed shape the Events page's right rail renders, and picks the
 * recent-results list that sits under it.
 *
 * WHY THE FEED NEEDS FILTERING AT ALL
 * ------------------------------------
 * Liquipedia:Matches is not a pure "upcoming" list -- measured against the
 * real feed, 23 of 51 tracked fixtures were already in the past, and 22 of
 * those 23 carried a DECISIVE scoreline (someone had reached 2 in a Bo3).
 * Exactly one sat at 0:0, i.e. genuinely in progress.
 *
 * That measurement is why the finished/live split below keys off the SCORE
 * rather than a "drop anything more than N hours old" time heuristic: the
 * score is the authoritative signal Liquipedia actually publishes, and a
 * time rule would simultaneously drop a long-running series that hadn't
 * finished and keep a decided one that started recently. The age rule is
 * kept only as a backstop for the pathological case (an entry that started
 * and never received its final score).
 */

import { localDateKey, todayKey } from './format'

// Backstop only -- see the docstring. A Bo5 plus delays can legitimately run
// several hours, so this is deliberately generous; the score check is what
// actually removes finished matches.
const STALE_HOURS = 8

/** Maps needed to win a series, from its `bestOf` (Bo3 -> 2). Falls back to 2
 * when Liquipedia didn't publish a format, which is the VCT norm. */
function mapsToWin(bestOf) {
  return Math.floor((bestOf || 3) / 2) + 1
}

/** A decided series: one side reached the maps needed to win. */
export function isFinished(m) {
  const need = mapsToWin(m.bestOf)
  return (m.score1 ?? 0) >= need || (m.score2 ?? 0) >= need
}

/** Liquipedia is showing a scoreline but nobody has clinched it yet. */
export function isLive(m) {
  return !!m.started && !isFinished(m)
}

/** Unordered team-pair key, so "A vs B" and "B vs A" collide as they should. */
function pairKey(event, a, b) {
  return `${event}|${[a || '', b || ''].sort().join('|')}`
}

/**
 * Fixtures this site's OWN match data already knows the result of.
 *
 * This is the second safety net, and the one that matters most in practice:
 * the VLR export and the Liquipedia feed refresh on independent schedules, so
 * for a window of hours after a match ends one source can call it finished
 * while the other still lists it. Without this dedupe the same fixture
 * renders under both "Matches" and "Recent results" at once, which is the
 * obvious visible bug.
 *
 * Dates are compared with a +/- 1 day tolerance because the two sources
 * disagree about which calendar day a match belongs to: `match_results`
 * carries VLR's own date, while an upcoming fixture is bucketed by the
 * VIEWER's local day. A 01:00 CEST match is the previous day in the Americas.
 */
function playedKeys(matchRecords) {
  const keys = new Set()
  for (const r of matchRecords || []) {
    if (!r.date) continue
    keys.add(`${pairKey(r.event, r.team1, r.team2)}|${r.date}`)
  }
  return keys
}

function alreadyPlayed(m, keys) {
  const base = pairKey(m.event, m.team1, m.team2)
  const d = new Date(m.timestamp * 1000)
  for (const shift of [-1, 0, 1]) {
    const probe = new Date(d.getTime() + shift * 86400000)
    const key = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, '0')}-${String(probe.getDate()).padStart(2, '0')}`
    if (keys.has(`${base}|${key}`)) return true
  }
  return false
}

/**
 * `{ days: [{ dateKey, date, matches }], liveCount, fetchedAt }`, bucketed by
 * the VIEWER'S OWN local calendar day.
 *
 * Local, not UTC, on purpose: the scraper ships a bare unix timestamp
 * precisely so this decision is made here. Bucketing by UTC would file a
 * 17:00-PDT match under tomorrow for anyone in the Americas -- the exact
 * class of bug that makes a schedule widget quietly wrong for half its
 * readers.
 */
export function normalizeUpcoming(upcomingData, matchRecords, now = new Date()) {
  const fetchedAt = upcomingData?._meta?.fetchedAt ?? null
  const all = upcomingData?.matches ?? []
  if (all.length === 0) return { days: [], liveCount: 0, fetchedAt }

  const played = playedKeys(matchRecords)
  const nowSec = now.getTime() / 1000

  const kept = all.filter((m) => {
    if (isFinished(m)) return false
    if (alreadyPlayed(m, played)) return false
    // Started, undecided, and long past its slot -- treat as an entry that
    // never got its final score rather than a series still being played.
    if (m.started && nowSec - m.timestamp > STALE_HOURS * 3600) return false
    return true
  })

  const byDay = new Map()
  for (const m of kept) {
    const key = localDateKey(m.timestamp)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(m)
  }

  const days = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, matches]) => ({
      dateKey,
      date: new Date(matches[0].timestamp * 1000),
      matches: matches.sort((a, b) => a.timestamp - b.timestamp),
    }))

  return { days, liveCount: kept.filter(isLive).length, fetchedAt }
}

/** Always literally today -- matches rft.gg's own day strip, which
 * highlights today's tab regardless of whether it happens to have fixtures
 * (its own live feed showed AUG 8 bold/active in a 6-10 window with every
 * slot filled, but the tab itself is a fixed position, not a "nearest day
 * with something in it" search). */
export function defaultDayKey(now = new Date()) {
  return todayKey(now)
}

/**
 * A FIXED five-day window centered on today (today-2 .. today+2), not a
 * scrollable list of "however many days have fixtures".
 *
 * This is a direct copy of rft.gg's own strip, measured off its live DOM:
 * exactly 5 buttons, `flex justify-center space-x-0.5`, no overflow/scroll
 * container at all. The previous version rendered one tab per day that
 * actually had a match (up to 7 in the real feed) inside a horizontally
 * scrolling strip with no visible affordance that more existed -- which is
 * why the last tab rendered as a silently truncated "AU" at the edge of the
 * card. A fixed 5-slot window can never overflow its 220px column.
 *
 * Days with no fixtures still get a slot (empty `matches: []`) rather than
 * being skipped, so the strip's day positions never shift depending on
 * what's scheduled -- clicking "today" always lands in the middle slot.
 */
export function fiveDayWindow(days, now = new Date()) {
  const byKey = new Map((days || []).map((d) => [d.dateKey, d]))
  const out = []
  for (let offset = -2; offset <= 2; offset++) {
    const date = new Date(now.getTime() + offset * 86400000)
    const dateKey = localDateKey(date.getTime() / 1000)
    out.push(byKey.get(dateKey) ?? { dateKey, date, matches: [] })
  }
  return out
}

/** Most recently completed matches, newest first -- straight off this site's
 * own match data, which is richer and more reliable than the Liquipedia feed
 * for anything already played. */
export function recentResults(matchRecords, n = 8) {
  return [...(matchRecords || [])]
    .filter((m) => m.date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, n)
}
