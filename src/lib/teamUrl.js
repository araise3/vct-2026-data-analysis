export function teamBreakdownUrl(team) {
  return `/teams?tab=breakdown&team=${encodeURIComponent(team)}`
}

export function teamHistoryUrl(team) {
  return team ? `/team-history?team=${encodeURIComponent(team)}` : '/team-history'
}
