export default function MultiFilterChips({ options, selected, onChange }) {
  function toggle(opt) {
    if (selected.includes(opt)) {
      onChange(selected.filter((o) => o !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange([])}
        className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors border ${
          selected.length === 0
            ? 'bg-accent/15 text-accent-bright border-accent/40'
            : 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
        }`}
      >
        All
      </button>
      {options.map((opt) => {
        const active = selected.includes(opt)
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
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
