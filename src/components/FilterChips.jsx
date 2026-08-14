// renderLabel is optional (mirrors MultiFilterChips.jsx's own prop of the
// same name) -- lets a caller swap in an icon+text label for a chip (e.g.
// AgentCompositions.jsx's Map selector) without every other caller (plain
// string options) needing to change.
export default function FilterChips({ options, value, onChange, renderLabel }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-3.5 py-1.5 rounded-2xl text-xs font-medium transition-colors border ${
              active
                ? 'bg-accent/15 text-accent-bright border-accent/40'
                : 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
            }`}
          >
            {renderLabel ? renderLabel(opt) : opt}
          </button>
        )
      })}
    </div>
  )
}
