/** Sort a leaderboard by its requested primary metric, then apply an optional result cap. */
export function rankRows(rows, key, direction = 'desc', limit = 0) {
  if (!limit) return rows
  return [...rows]
    .sort((left, right) => {
      const a = left[key]
      const b = right[key]
      const aMissing = a == null || (typeof a === 'number' && !Number.isFinite(a))
      const bMissing = b == null || (typeof b === 'number' && !Number.isFinite(b))
      if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1
      const compared = typeof a === 'string' ? a.localeCompare(b) : a - b
      if (compared) return direction === 'asc' ? compared : -compared
      return String(left.name || left.matchup || left.id || '').localeCompare(String(right.name || right.matchup || right.id || ''))
    })
    .slice(0, limit)
}
