import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TeamLogo from './TeamLogo'
import { num } from '../lib/format'

/**
 * Full modal picker for adding teams to the ratings chart comparison --
 * replaces the earlier single-select "+" dropdown (a flat alphabetical
 * list, one pick closed it). Built as a real modal rather than a floating
 * panel specifically so it can stay OPEN across several picks: click a
 * team, it's added immediately and the list is still right there for the
 * next one, instead of reopening the trigger per team. Closes only on the
 * backdrop, Escape, or its own close button.
 *
 * `teams` is expected to already exclude whatever's currently in the
 * comparison (the same `addTeamOptions` filter the old dropdown used) --
 * so a pick just needs to disappear from the list on the next render
 * rather than this component tracking an "added" state of its own. That
 * also means `selectedCount` is a plain number, not a set: nothing here
 * needs to know WHICH teams are already in, only how many, to know when
 * the comparison is full.
 *
 * `teams` shape: `{ value, label, region, rating }` -- straight off
 * `run.table` (Ratings.jsx), the same per-team row the main leaderboard
 * renders from, not a second lookup.
 *
 * Grouped by region (the same four leagues the "By region" tables below
 * use, `REGION_GROUP_ORDER`) with an "International" catch-all appended
 * for the EWC-only entrants `teamRatings.js`'s own `regionsByTeam` falls
 * back to that name for -- without it those teams would have no group to
 * render under at all and would silently vanish from the picker. Within a
 * region, sorted by rating descending (unranked/alphabetical would bury a
 * genuinely comparison-worthy team behind whoever happens to sort first).
 */
const REGION_GROUP_ORDER = ['Americas', 'EMEA', 'Pacific', 'China', 'International']

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export default function TeamPickerModal({
  open, onClose, teams, onAdd, selectedCount, maxSeries, title = 'Add teams',
}) {
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  const atCap = selectedCount >= maxSeries

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    // Autofocus needs a beat -- the input isn't in the DOM yet on the same
    // tick `open` flips true.
    const id = requestAnimationFrame(() => searchRef.current?.focus())
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? teams.filter((t) => t.label.toLowerCase().includes(q)) : teams
    const byRegion = new Map()
    for (const t of filtered) {
      const region = REGION_GROUP_ORDER.includes(t.region) ? t.region : 'International'
      if (!byRegion.has(region)) byRegion.set(region, [])
      byRegion.get(region).push(t)
    }
    for (const list of byRegion.values()) list.sort((a, b) => b.rating - a.rating)
    return REGION_GROUP_ORDER
      .map((region) => ({ region, teams: byRegion.get(region) || [] }))
      .filter((g) => g.teams.length > 0)
  }, [teams, query])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[min(32rem,80vh)] flex flex-col bg-surface border border-hairline rounded-2xl shadow-depth-md overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-hairline shrink-0">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
            <p className="text-[11px] text-muted">
              {atCap
                ? `Comparison is full (${maxSeries} of ${maxSeries})`
                : `${selectedCount} of ${maxSeries} teams in this comparison`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected/20"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="p-3 border-b border-hairline shrink-0">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams…"
            // Subtle focus tell -- a one-step background lighten (the same
            // surface2 -> surface3 step already used for a hover state
            // elsewhere) rather than the earlier glow/border-color ring,
            // which read as too loud for a box that's focused by default
            // the instant the modal opens.
            className="w-full bg-surface2 border border-hairline rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted shadow-depth-xs transition-colors duration-150 focus:outline-none focus:bg-surface3"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {atCap ? (
            <p className="px-4 py-6 text-xs text-muted text-center">
              Remove a team (Reset, or drop to one for detail view) to add another.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted text-center">No teams match "{query}".</p>
          ) : (
            groups.map(({ region, teams: regionTeams }) => (
              <div key={region}>
                <div className="sticky top-0 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted bg-surface/95">
                  {region}
                </div>
                {regionTeams.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => onAdd(t.value)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors hover:bg-surface2"
                  >
                    <TeamLogo team={t.value} size={20} showName={false} />
                    <span className="flex-1 min-w-0 truncate text-ink">{t.label}</span>
                    <span className="text-[11px] tabular-nums text-muted shrink-0">{num(t.rating)}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
