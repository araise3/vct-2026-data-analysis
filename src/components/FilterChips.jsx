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
import Chip from './ui/Chip'

export default function FilterChips({ options, value, onChange, renderLabel, getBg }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt
        const bg = getBg?.(opt)
        if (bg) {
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              style={{
                backgroundImage: `linear-gradient(${active ? 'rgba(47,128,237,0.5)' : 'rgba(19,22,25,0.55)'}, ${active ? 'rgba(47,128,237,0.5)' : 'rgba(19,22,25,0.55)'}), url(${bg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              className={`px-3.5 py-1.5 rounded-2xl text-xs font-medium transition-all duration-150 border text-ink shadow-depth-xs hover:-translate-y-px hover:shadow-depth-sm ${
                active ? 'border-accent/60' : 'border-hairline hover:border-muted'
              }`}
            >
              {renderLabel ? renderLabel(opt) : opt}
            </button>
          )
        }
        return (
          <Chip key={opt} active={active} className="px-3.5" onClick={() => onChange(opt)}>
            {renderLabel ? renderLabel(opt) : opt}
          </Chip>
        )
      })}
    </div>
  )
}
