/**
 * A single faceted filter dimension: a labelled group of multi-selectable
 * chips. Every option renders identically regardless of whether it's
 * currently "reachable" given other active filters -- no dimming, no
 * disabling: dimming a chip based on other facets read as a bug (e.g.
 * picking a specific VCT-only event dimmed the EWC chip in Competition,
 * which is multi-select/OR'd -- clicking EWC there doesn't replace VCT, it
 * adds to it, so it was never actually unreachable). Every chip just stays
 * clickable and lets the result set speak for itself.
 *
 * `options` used to carry a per-value `available` flag that this component
 * ignored; it was removed from useFacetedFilter for being both expensive
 * and, worse, symmetric (any facet could dim any other, including
 * "backwards" cases like Event dimming Competition). `options` now instead
 * arrives PRE-NARROWED by a one-directional parent -> child hierarchy
 * (Year -> Competition -> Region -> Split -> Event -> Phase/Week) computed
 * in useFacetedFilter -- this component still renders every value it's
 * handed identically either way, it just receives a shorter list once an
 * ancestor facet is picked. See that file's own comment for the hierarchy.
 */
export default function FacetGroup({ label, options, selected, onChange, renderLabel, hideLabel = false }) {
  function toggle(value) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const allActive = selected.length === 0

  return (
    <div className="flex flex-col gap-1.5">
      {!hideLabel && (
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted font-medium">{label}</span>
        {!allActive && (
          <button
            onClick={() => onChange([])}
            className="text-[11px] text-accent-bright hover:underline"
          >
            clear
          </button>
        )}
      </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map(({ value }) => {
          const active = selected.includes(value)
          return (
            <button
              key={value}
              onClick={() => toggle(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                active
                  ? 'bg-accent/20 text-accent-bright border-accent/50'
                  : 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
              }`}
            >
              {renderLabel ? renderLabel(value) : value}
            </button>
          )
        })}
      </div>
    </div>
  )
}
