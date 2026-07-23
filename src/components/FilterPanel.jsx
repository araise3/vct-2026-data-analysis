import { useState } from 'react'
import FacetGroup from './FacetGroup'

export const FACETS = ['competition', 'region', 'event', 'stage', 'phase', 'week']

export const FACET_LABELS = {
  competition: 'Competition',
  region: 'Region',
  event: 'Event',
  stage: 'Stage',
  phase: 'Phase',
  week: 'Week / Round',
}

// Week values carry their phase as a prefix ("Group Stage: Week 2") because
// that's what makes them unique season-wide, but phase is already its own
// chip group -- so strip it for display.
const weekLabel = (w) => (w.includes(': ') ? w.split(': ').slice(1).join(': ') : w)
const eventLabel = (e) => e.replace(/^Vct\b/, 'VCT')

export const FACET_RENDERERS = { week: weekLabel, event: eventLabel }

function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 16 16" width="14" height="14" fill="none"
      className={`shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The single filter panel every page uses. Adding a facet here (or a new
 * page that renders this) requires no per-page filtering logic -- options
 * and availability are derived from whatever bucket records get passed to
 * useFacetedFilter.
 *
 * Collapsing is two-level: the whole panel contracts to a single summary
 * row, and each facet group folds independently. A facet with an active
 * selection is never folded away, so collapsing can't hide a filter that's
 * actually doing something.
 */
export default function FilterPanel({
  selections, setFacet, clearAll, options, activeCount, children, summary,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [collapsed, setCollapsed] = useState(() => new Set())

  const toggleFacet = (f) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })

  // Compact description of what's active, shown when contracted so the
  // current scope is never hidden behind a collapsed panel.
  const activeBits = FACETS.flatMap((f) => {
    const sel = selections[f] || []
    if (!sel.length) return []
    const render = FACET_RENDERERS[f] || ((x) => x)
    return [
      sel.length <= 2
        ? sel.map(render).join(', ')
        : `${sel.length} ${FACET_LABELS[f].toLowerCase()}`,
    ]
  })

  return (
    <div className="bg-surface border border-hairline rounded-2xl">
      <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-ink hover:text-accent-bright transition-colors"
          aria-expanded={open}
        >
          <Chevron open={open} />
          <span className="font-display text-sm font-semibold">Filters</span>
          {activeCount > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent-bright">
              {activeCount}
            </span>
          )}
        </button>

        <div className="flex items-center gap-3 min-w-0">
          {!open && activeBits.length > 0 && (
            <span className="text-xs text-muted truncate max-w-md">{activeBits.join(' · ')}</span>
          )}
          {summary && <span className="text-xs text-muted whitespace-nowrap">{summary}</span>}
          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-accent-bright hover:underline whitespace-nowrap"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-5 pb-5 flex flex-col gap-4 border-t border-hairline pt-4">
          {FACETS.map((f) => {
            const sel = selections[f] || []
            const opts = options[f] || []
            if (opts.length === 0) return null
            const isCollapsed = collapsed.has(f) && sel.length === 0
            return (
              <div key={f} className="flex flex-col gap-1.5">
                <button
                  onClick={() => toggleFacet(f)}
                  className="flex items-center gap-1.5 w-fit text-muted hover:text-ink transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  <Chevron open={!isCollapsed} />
                  <span className="text-[11px] uppercase tracking-wide font-medium">
                    {FACET_LABELS[f]}
                  </span>
                  <span className="text-[11px] text-muted/60">
                    {sel.length > 0 ? `${sel.length} selected` : opts.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <FacetGroup
                    options={opts}
                    selected={sel}
                    onChange={(vals) => setFacet(f, vals)}
                    renderLabel={FACET_RENDERERS[f]}
                    hideLabel
                  />
                )}
              </div>
            )
          })}

          {children}
        </div>
      )}
    </div>
  )
}
