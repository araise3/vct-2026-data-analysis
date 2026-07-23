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

/**
 * The single filter panel every page uses. Adding a facet here (or a new
 * page that renders this) requires no per-page filtering logic -- the
 * options and availability are derived from whatever bucket records are
 * passed to useFacetedFilter.
 */
export default function FilterPanel({
  selections, setFacet, clearAll, options, activeCount, children, summary,
}) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <span className="font-display text-sm font-semibold text-ink">Filters</span>
        <div className="flex items-center gap-3">
          {summary && <span className="text-xs text-muted">{summary}</span>}
          {activeCount > 0 && (
            <button onClick={clearAll} className="text-xs text-accent-bright hover:underline">
              Clear all ({activeCount})
            </button>
          )}
        </div>
      </div>

      {FACETS.map((f) => (
        <FacetGroup
          key={f}
          label={FACET_LABELS[f]}
          options={options[f] || []}
          selected={selections[f] || []}
          onChange={(vals) => setFacet(f, vals)}
          renderLabel={FACET_RENDERERS[f]}
        />
      ))}

      {children}
    </div>
  )
}
