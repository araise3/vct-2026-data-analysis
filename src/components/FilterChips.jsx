// renderLabel is optional (mirrors MultiFilterChips.jsx's own prop of the
// same name) -- lets a caller swap in a custom label for a chip (e.g.
// AgentCompositions.jsx's Map selector) without every other caller (plain
// string options) needing to change.
//
// getBg is likewise optional -- lets a caller paint a chip's own background
// image (e.g. a map thumbnail) instead of adding a separate icon inside the
// label. A dark gradient is layered under the image so the label text stays
// readable regardless of the thumbnail's own contrast; the active tint
// switches to the accent color so selection state is still visible over art.
export default function FilterChips({ options, value, onChange, renderLabel, getBg }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt
        const bg = getBg?.(opt)
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={bg ? {
              backgroundImage: `linear-gradient(${active ? 'rgba(255,70,85,0.5)' : 'rgba(19,22,25,0.55)'}, ${active ? 'rgba(255,70,85,0.5)' : 'rgba(19,22,25,0.55)'}), url(${bg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : undefined}
            className={`px-3.5 py-1.5 rounded-2xl text-xs font-medium transition-colors border ${
              bg
                ? `text-ink ${active ? 'border-accent/60' : 'border-hairline hover:border-muted'}`
                : active
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
