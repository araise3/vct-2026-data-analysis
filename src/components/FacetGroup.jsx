/**
 * A single faceted filter dimension: a labelled group of multi-selectable
 * chips. Options that aren't reachable given the *other* active filters are
 * shown disabled rather than hidden, so the set of chips doesn't jump
 * around as you select things.
 */
export default function FacetGroup({ label, options, selected, onChange, renderLabel }) {
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
      <div className="flex flex-wrap gap-1.5">
        {options.map(({ value, available }) => {
          const active = selected.includes(value)
          return (
            <button
              key={value}
              onClick={() => toggle(value)}
              disabled={!available && !active}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                active
                  ? 'bg-accent/20 text-accent-bright border-accent/50'
                  : available
                    ? 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
                    : 'bg-surface/40 text-muted/30 border-hairline/40 cursor-not-allowed'
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
