/**
 * Trophy-case data: which events award a real trophy, and who won it.
 *
 * There is no "winner" field anywhere in the exported data -- every event
 * this derives a champion for is found by locating that event's own real
 * Grand Final match in match_results.json and reading s1 > s2, the same
 * winner convention every other match-winner check in this codebase already
 * uses. Nothing here is hand-curated or guessed; a re-export of the data
 * pipeline picks up new winners automatically as new events complete.
 */

// Every event stage EXCEPT 'China Qualifier' -- the one-off Champions Tour
// 2023 Champions China Qualifier, excluded per direct product decision (it
// was a feeder bracket for Champions from a region not yet on the League/
// LCQ system that season, not treated as its own trophy). Every other
// stage -- League/LCQ/Kickoff/Stage 1/Stage 2/Masters/Champions/Main Event/
// Qualifier/LOCK//IN -- genuinely crowns a regional or international
// champion in real VCT, so all of them are in scope; buildTrophyWinners
// below still only emits one where the real match data actually supports
// identifying who that champion was.
const EXCLUDED_STAGES = new Set(['China Qualifier'])

/** Round-label "phase" -- the part before the first ": ", or the whole
 * label if there's none (e.g. "Grand Final" on its own). Round labels
 * within one event share a common phase prefix ("Playoffs: ...",
 * "Main Event: ...", "Stage 1: ...", "Stage 2: ..."), and later phases
 * always sort after earlier ones by date. */
function phaseOf(w) {
  const i = (w || '').indexOf(': ')
  return i === -1 ? (w || '').trim() : w.slice(0, i).trim()
}

// A round label counts as a real decider match if it's a Grand Final, an
// exact "Final" (no other word before it), or an Upper Final -- the last
// one specifically because VCT 2026's Kickoffs and some EWC Qualifiers
// switched to an Upper/Middle/Lower bracket with no Grand Final label at
// all (verified directly against the real data); per direct product
// decision, that bracket's Upper Final IS the champion (1st place),
// distinct from its Middle/Lower Finals (placement matches for other
// seeds, not the title). This regex deliberately does NOT match "Middle
// Final" or "Lower Final" -- neither ends in ": final" nor contains
// "grand"/"upper".
function isFinalCandidate(w) {
  return /grand final/i.test(w || '') || /upper final/i.test(w || '') || /(^|: )final$/i.test((w || '').trim())
}

/**
 * Derives every trophy-awarding event's champion straight from
 * match_results.json's own rows -- nothing hand-curated, a re-export picks
 * up new champions automatically as events complete.
 *
 * Naively taking the FIRST "Grand Final"-labeled match in an event is
 * wrong for a real case in this data: EWC's regional Qualifiers run TWO
 * separate bracket stages ("Stage 1", a small seeding bracket that itself
 * has its own "Grand Final", followed by "Stage 2", the real 8-team
 * qualifying bracket) -- so the naive approach would crown Stage 1's
 * winner (a seeding-round result) as the whole Qualifier's champion,
 * instead of whoever actually won Stage 2. Fixed by grouping an event's
 * matches by phaseOf() first, finding whichever phase's matches run
 * latest by date, and only looking for a final-type candidate WITHIN that
 * latest phase -- for a single-phase event (the overwhelming majority)
 * this is a no-op, but for the two-stage EWC Qualifiers it correctly
 * looks at Stage 2 only. If that latest phase has no identifiable final
 * (a real, confirmed gap for 3 of the 4 2026 EWC regional Qualifiers --
 * their Stage 2 Upper Final specifically isn't in the scraped data), the
 * event is skipped outright rather than crowning Stage 1's winner as a
 * guess. Same reasoning covers VCT 2026's still-in-progress Stage 2s and
 * the not-yet-played Champions 2026 -- no identifiable final, no trophy.
 */
export function buildTrophyWinners(matchResultsData) {
  if (!matchResultsData) return []
  const { events, rows } = matchResultsData
  const byEvent = new Map()
  for (const r of rows) {
    const ev = events[r.e]
    if (!ev || EXCLUDED_STAGES.has(ev.stage)) continue
    if (!byEvent.has(r.e)) byEvent.set(r.e, [])
    byEvent.get(r.e).push(r)
  }
  const out = []
  for (const [eventId, matches] of byEvent) {
    const ev = events[eventId]

    const byPhase = new Map()
    for (const m of matches) {
      const p = phaseOf(m.w)
      if (!byPhase.has(p)) byPhase.set(p, [])
      byPhase.get(p).push(m)
    }
    let latestPhase = null
    let latestPhaseDate = ''
    for (const [p, ms] of byPhase) {
      const maxDate = ms.reduce((max, m) => ((m.date || '') > max ? m.date || '' : max), '')
      if (maxDate > latestPhaseDate) { latestPhaseDate = maxDate; latestPhase = p }
    }

    const candidates = (byPhase.get(latestPhase) || []).filter((m) => isFinalCandidate(m.w))
    if (!candidates.length) continue
    candidates.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const final = candidates[candidates.length - 1]
    if (final.s1 == null || final.s2 == null || final.s1 === final.s2) continue

    out.push({
      eventId: Number(eventId),
      eventName: ev.name,
      stage: ev.stage,
      region: ev.region,
      year: ev.year,
      team: final.s1 > final.s2 ? final.team1 : final.team2,
      date: final.date,
    })
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

/**
 * Narrows the full trophy list (buildTrophyWinners' output) down to the
 * ones a specific player actually has -- they need a real player_buckets
 * record for the CHAMPION team at that exact event (i.e. they played at
 * least one map for the winning team during that event), not just "was on
 * the roster at some point". `records` should be this player's own raw,
 * career-wide buckets (every year, unfiltered by the page's active scope --
 * see PlayerProfile.jsx's `records`), each still carrying its raw `e`
 * (event id) and `t` (team) fields the way expandBuckets leaves them.
 *
 * Sorted newest-first for display (most recent trophy first).
 */
export function playerTrophies(records, trophies) {
  const won = new Set(records.map((r) => `${r.e}|${r.t}`))
  return trophies
    .filter((t) => won.has(`${t.eventId}|${t.team}`))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}
