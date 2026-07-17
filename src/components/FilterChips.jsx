export default function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              active
                ? 'bg-accent/15 text-accent-bright border-accent/40'
                : 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
