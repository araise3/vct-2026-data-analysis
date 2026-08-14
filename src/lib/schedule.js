/** Most recently completed matches, newest first -- straight off this site's
 * own match data, which is richer and more reliable than the Liquipedia feed
 * for anything already played. */
export function recentResults(matchRecords, n = 8) {
  return [...(matchRecords || [])]
    .filter((m) => m.date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, n)
}
