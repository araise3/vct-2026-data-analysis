/** Most recently completed matches, newest first -- straight off this site's
 * own match data, which is richer and more reliable than the Liquipedia feed
 * for anything already played.
 *
 * Sorts by `ts` (full "YYYY-MM-DD HH:MM:SS" kickoff time) when present,
 * falling back to `date` + match id for older matches predating that field.
 * Plain `date` (day only) can't order same-day matches by itself, and match
 * id is NOT a safe stand-in the way it is within one event's own match
 * list: VLR assigns ids at match-page-creation time, so two different
 * events running concurrently (e.g. two regions' Stage 2 the same week)
 * create their pages in unrelated batches -- a later-id match from one can
 * easily have kicked off before an earlier-id match from the other. This
 * is what put a match at the top of the rail despite being the first game
 * of its day: every match that day shared the same `date`, so the id
 * tiebreak decided the order, and id doesn't track actual kickoff time
 * across events. `ts` does, since it's the real per-match timestamp. */
export function recentResults(matchRecords, n = 8) {
  return [...(matchRecords || [])]
    .filter((m) => m.date)
    .sort((a, b) =>
      (b.ts || b.date).localeCompare(a.ts || a.date) || b.id - a.id
    )
    .slice(0, n)
}
