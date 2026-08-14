import Chip from './ui/Chip'

export default function MultiFilterChips({ options, selected, onChange, renderLabel }) {
  function toggle(opt) {
    if (selected.includes(opt)) {
      onChange(selected.filter((o) => o !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Chip active={selected.length === 0} className="px-3.5" onClick={() => onChange([])}>
        All
      </Chip>
      {options.map((opt) => {
        const active = selected.includes(opt)
        return (
          <Chip key={opt} active={active} className="px-3.5" onClick={() => toggle(opt)}>
            {renderLabel ? renderLabel(opt) : opt}
          </Chip>
        )
      })}
    </div>
  )
}
