export function teamBreakdownUrl(team) {
  return `/teams?tab=breakdown&team=${encodeURIComponent(team)}`
}
