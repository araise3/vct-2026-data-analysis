import { useEffect, useMemo, useRef, useState } from 'react'
import EventLogo from './EventLogo'
import { eventLabel } from '../lib/format'

/**
 * Multi-select event search. A plain text input backed by a fully custom
 * dropdown -- not the browser's native <input list>/<datalist> combo the
 * first version of this control used, which forces the input to lose its
 * rounded-full corners the moment the popup opens on Chromium, and gives
 * no way to render a logo next to each suggestion. Selecting an option
 * adds it as its own removable pill rather than replacing a single value,
 * so more than one event can be in scope at once -- the caller ORs them
 * together (see agentInScope in PlayerProfile.jsx).
 */
export default function EventPicker({ options, selected, onAdd, onRemove, disabled }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const selectedSet = new Set(selected)
  const q = input.trim().toLowerCase()
  const filtered = options
    .filter((evt) => !selectedSet.has(evt))
    .filter((evt) => !q || eventLabel(evt).toLowerCase().includes(q))
    .slice(0, 12)

  // Sized to the longest label in the full option set (not just the
  // currently-filtered subset -- otherwise the box would resize as you
  // type). `ch` approximates text width in this proportional font, an
  // overestimate for most glyphs (digits and most lowercase letters render
  // narrower than '0'), which is the safe direction to be wrong in. The
  // +65px covers what a dropdown ROW needs beyond the bare text -- the
  // icon (16px) + its gap (8px) + left/right row padding (12px each) --
  // plus a 17px scrollbar-width buffer (the largest common OS scrollbar)
  // so the longest label never sits underneath the dropdown's own
  // scrollbar once there are enough events to need one. The input and
  // dropdown share this one width (set on their common wrapper below)
  // rather than each computing their own, so they always match exactly.
  const maxChars = useMemo(
    () => options.reduce((max, evt) => Math.max(max, eventLabel(evt).length), 6),
    [options]
  )
  const pickerWidth = `calc(${maxChars}ch + 65px)`

  function pick(evt) {
    onAdd(evt)
    setInput('')
    // Deliberately left open (not closed here) -- picking one event is the
    // common case for adding several in a row without re-focusing.
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Pills render before the input (not after) so the search box stays
          the rightmost element as events are added, tag-input style,
          instead of sitting fixed on the left with pills piling up to its
          right. */}
      {selected.map((evt) => (
        <span
          key={evt}
          className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full bg-accent/15 text-accent-bright border border-accent/40 text-xs font-medium"
        >
          <EventLogo event={evt} size={14} />
          {eventLabel(evt)}
          <button
            type="button"
            onClick={() => onRemove(evt)}
            className="text-accent-bright/70 hover:text-accent-bright leading-none"
            title="Remove"
          >
            ✕
          </button>
        </span>
      ))}

      <div className="relative" ref={wrapRef} style={{ width: pickerWidth }}>
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (filtered[0]) pick(filtered[0]) }
            if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
          }}
          placeholder="Add an event…"
          disabled={disabled}
          className="w-full px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors border bg-surface text-muted border-hairline hover:text-ink hover:border-muted placeholder:text-muted focus:outline-none disabled:opacity-40 disabled:pointer-events-none"
        />
        {open && filtered.length > 0 && (
          <div className="absolute top-full left-0 w-full mt-1 z-20 bg-surface border border-hairline rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
            {filtered.map((evt) => (
              <button
                key={evt}
                type="button"
                onClick={() => pick(evt)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink hover:bg-surface2 transition-colors text-left"
              >
                <EventLogo event={evt} size={16} />
                <span className="truncate">{eventLabel(evt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
