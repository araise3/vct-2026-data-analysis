import { useState } from 'react'
import FacetGroup from './FacetGroup'
import { unscopeValue } from '../lib/entityBuckets'

/**
 * `eventPhase` / `eventWeek` hold event-scoped values ("Vct 2026 Americas
 * Kickoff § Playoffs: Week 2") rather than bare week names, because a bare
 * "Week 2" exists in nearly every event and filtering on it used to select
 * that week across all of them at once. They're rendered as a sub-group per
 * selected event instead of one flat chip list.
 */
export const FACETS = ['competition', 'region', 'split', 'event', 'eventPhase', 'eventWeek']

/** Facets shown as flat chip groups, in order, above the per-event section. */
const TOP_FACETS = ['competition', 'region', 'split', 'event']

/** Facets scoped to a specific event, shown only once events are selected. */
const SCOPED_FACETS = ['eventPhase', 'eventWeek']

export const FACET_LABELS = {
  competition: 'Competition',
  region: 'Region',
  split: 'Split',
  event: 'Event',
  eventPhase: 'Phase',
  eventWeek: 'Week / Round',
}

// Explicit chip order for facets where alphabetical (the hook's default)
// reads wrong -- Split's season progression, not alphabetized, with
// Qualifier (an EWC-only concept, orthogonal to the VCT Kickoff/Stage 1/
// Stage 2 progression) pushed to the end rather than sorting ahead of
// "Stage" alphabetically. Values not listed here keep their place at the
// end, in whatever order the hook already sorted them.
const FACET_ORDER = {
  split: ['Kickoff', 'Stage 1', 'Stage 2', 'Qualifier'],
}

function orderOptions(facet, opts) {
  const order = FACET_ORDER[facet]
  if (!order) return opts
  return [...opts].sort((a, b) => {
    const ai = order.indexOf(a.value)
    const bi = order.indexOf(b.value)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

const eventLabel = (e) => e.replace(/^Vct\b/, 'VCT')

// Week values carry their phase as a prefix ("Group Stage: Week 2") to be
// unique within an event; the phase is its own chip group, so strip it.
const bareWeek = (w) => (w.includes(': ') ? w.split(': ').slice(1).join(': ') : w)

// Scoped values render as "EVENT — Week 2" outside the per-event section
// (e.g. in the collapsed summary), where the event context isn't implied.
const scopedLabel = (fmt) => (scoped) => {
  const { event, value } = unscopeValue(scoped)
  return `${eventLabel(event)} — ${fmt(value)}`
}

export const FACET_RENDERERS = {
  event: eventLabel,
  eventPhase: scopedLabel((v) => v),
  eventWeek: scopedLabel(bareWeek),
}

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
  dateRange, setDateRange, dateBounds,
  defaultOpen = false,
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

  const selectedEvents = selections.event || []

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
  if (dateRange?.from || dateRange?.to) {
    activeBits.push(`${dateRange.from || '…'} → ${dateRange.to || '…'}`)
  }

  const renderFlatFacet = (f) => {
    const sel = selections[f] || []
    const opts = orderOptions(f, options[f] || [])
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
  }

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
          {TOP_FACETS.map(renderFlatFacet)}

          {setDateRange && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wide font-medium text-muted">
                Date range
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={dateRange?.from || ''}
                  min={dateBounds?.min || undefined}
                  max={dateBounds?.max || undefined}
                  onChange={(e) => setDateRange({ from: e.target.value })}
                  className="bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-muted w-[150px] shrink-0"
                />
                <span className="text-muted text-xs">to</span>
                <input
                  type="date"
                  value={dateRange?.to || ''}
                  min={dateBounds?.min || undefined}
                  max={dateBounds?.max || undefined}
                  onChange={(e) => setDateRange({ to: e.target.value })}
                  className="bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-muted w-[150px] shrink-0"
                />
                {(dateRange?.from || dateRange?.to) && (
                  <button
                    onClick={() => setDateRange({ from: '', to: '' })}
                    className="text-[11px] text-accent-bright hover:underline"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Phase / week, scoped to each selected event. Hidden until an
              event is picked -- unscoped these lists run to hundreds of
              near-identically-named chips. */}
          {selectedEvents.length === 0 ? (
            <p className="text-muted text-xs">
              Select an event above to filter by its phases and weeks.
            </p>
          ) : (
            selectedEvents.map((evName) => (
              <div
                key={evName}
                className="flex flex-col gap-3 border-l-2 border-hairline pl-3"
              >
                <span className="text-[11px] uppercase tracking-wide font-semibold text-ink">
                  {eventLabel(evName)}
                </span>
                {SCOPED_FACETS.map((f) => {
                  const sel = selections[f] || []
                  const opts = (options[f] || []).filter(
                    (o) => unscopeValue(o.value).event === evName
                  )
                  if (opts.length === 0) return null
                  const fmt = f === 'eventWeek' ? bareWeek : (v) => v
                  return (
                    <div key={f} className="flex flex-col gap-1.5">
                      <span className="text-[11px] uppercase tracking-wide font-medium text-muted">
                        {FACET_LABELS[f]}
                      </span>
                      <FacetGroup
                        options={opts}
                        selected={sel}
                        onChange={(vals) => {
                          // Preserve selections belonging to other events --
                          // FacetGroup only knows about this event's subset.
                          const others = sel.filter(
                            (v) => unscopeValue(v).event !== evName
                          )
                          setFacet(f, [...others, ...vals])
                        }}
                        renderLabel={(v) => fmt(unscopeValue(v).value)}
                        hideLabel
                      />
                    </div>
                  )
                })}
              </div>
            ))
          )}

          {children}
        </div>
      )}
    </div>
  )
}
