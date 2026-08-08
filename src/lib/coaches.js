// A coach page needs the same handle to resolve across every team they've
// ever worked for -- `liquipedia_rosters.json` only stores coaches nested
// under each team's own entry (see build_liquipedia_data.py), so there's no
// single "this coach" record anywhere in the data. buildCoachIndex flattens
// every team's `coaches` array into one map keyed by lowercased id, each
// value carrying every stint (team + role + join/leave date) that id was
// ever recorded under, across every team.
export function buildCoachIndex(liquipediaData) {
  const byId = new Map()
  if (!liquipediaData?.teams) return byId
  for (const [team, entry] of Object.entries(liquipediaData.teams)) {
    for (const c of entry.coaches || []) {
      if (!c?.id) continue
      const key = c.id.toLowerCase()
      if (!byId.has(key)) byId.set(key, { id: c.id, name: c.name, flag: c.flag, stints: [] })
      const rec = byId.get(key)
      rec.stints.push({ team, role: c.role, joinDate: c.joinDate, leaveDate: c.leaveDate, status: c.status })
    }
  }
  return byId
}

/**
 * Whichever of `coaches` (a team's own Head-Coach-role entries, both
 * active and former) covered a given date -- i.e. `date` falls inside
 * that entry's `[joinDate, leaveDate)` window, `leaveDate` absent/null
 * meaning "still in the role". Shared by RosterTimeline.jsx (per-event
 * succession chain in the timeline) and TeamProfile.jsx (which coach(es)
 * actually covered the currently selected Year/Event scope, for the
 * Coaching Staff card -- see that page's own comment on why the card used
 * to always show today's coach regardless of scope).
 *
 * Liquipedia dates can legitimately overlap by a day or two around a
 * handover (the outgoing coach's leaveDate and the incoming one's
 * joinDate aren't always perfectly adjacent) -- ties break toward
 * whichever tenure STARTED more recently, i.e. the incoming one, the
 * intuitively "current" answer for any date inside the overlap.
 */
export function coachAt(date, coaches) {
  if (!date) return null
  let match = null
  for (const c of coaches) {
    if (!c.joinDate || c.joinDate > date) continue
    if (c.leaveDate && date >= c.leaveDate) continue
    if (!match || c.joinDate > match.joinDate) match = c
  }
  return match
}

/**
 * Match win/loss record for `team` restricted to the window
 * [joinDate, leaveDate) -- one coaching stint, not a career total. Same
 * match-level (not map-level) convention RosterTable's coachRecordSince
 * already uses for the current head coach; this generalizes it to a
 * bounded window so a FORMER stint's record doesn't pick up matches played
 * after the coach actually left. Ties and unscored matches are skipped
 * rather than counted either way.
 */
export function coachStintRecord(matches, team, joinDate, leaveDate) {
  if (!joinDate || !matches) return null
  let wins = 0
  let losses = 0
  for (const m of matches) {
    if (!m.date || m.date < joinDate) continue
    if (leaveDate && m.date >= leaveDate) continue
    if (m.s1 == null || m.s2 == null || m.s1 === m.s2) continue
    const isTeam1 = m.team1 === team
    const isTeam2 = m.team2 === team
    if (!isTeam1 && !isTeam2) continue
    if (isTeam1 ? m.s1 > m.s2 : m.s2 > m.s1) wins++
    else losses++
  }
  const played = wins + losses
  return played ? { wins, losses, winPct: wins / played } : null
}
