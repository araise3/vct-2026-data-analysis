import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '../../lib/cx'

/**
 * Custom single-select dropdown, replacing the native <select> wherever its
 * popup's own chrome matters visually -- a native select's option list is
 * rendered by the OS/browser itself, which CSS can't put a border-radius or
 * a floating shadow on. This instead renders its own absolutely-positioned
 * panel (outside-click-to-close via a mousedown listener on a wrapper ref,
 * same construction as EventPicker's dropdown), so it can carry the same
 * rounded-xl + shadow-depth-md every other floating surface in the app
 * uses, plus an in-panel search box and an optional per-option icon (a
 * flag/agent-icon/team-logo next to the label) for long option lists --
 * neither of which a native <option> can render at all.
 *
 * `options`: array of strings, or `{ value, label }` objects -- normalized
 * to the latter internally so callers with plain string domains (team
 * names, country names) don't need to map them first.
 *
 * `renderIcon(value)`: optional, rendered left of each option's label (and
 * left of the trigger's own current-value label) -- e.g. `Flag` for a
 * country select, `AgentIcon` for an agent select, `TeamLogo` for a team
 * select.
 *
 * `searchable`: shows a search box pinned to the top of the panel,
 * defaulting on once there are enough options that scanning them beats
 * scrolling (matches EventPicker's own no-fixed-threshold judgment call,
 * just expressed as a count here since these lists are flat, not fuzzy-
 * matched against a event-name string).
 */
export default function Select({
  value, onChange, options, placeholder = 'Select…', renderIcon, searchable, className, disabled,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef(null)
  const searchRef = useRef(null)

  const normalized = useMemo(
    () => options.map((o) => (typeof o === 'object' && o !== null ? o : { value: o, label: o })),
    [options]
  )
  const current = normalized.find((o) => o.value === value)
  const showSearch = searchable ?? normalized.length > 8

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return normalized
    return normalized.filter((o) => o.label.toLowerCase().includes(q))
  }, [normalized, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    if (showSearch) searchRef.current?.focus()
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, showSearch])

  function pick(v) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          'flex items-center justify-between gap-2 cursor-pointer bg-surface2 border border-hairline rounded-lg pl-3 pr-2.5 py-1.5 text-sm text-ink shadow-depth-xs transition-shadow duration-150',
          'focus:outline-none focus:border-selected/50 focus:shadow-focus-ring disabled:opacity-40 disabled:pointer-events-none',
          className
        )}
      >
        <span className={cx('flex items-center gap-2 min-w-0 truncate', !current && 'text-muted')}>
          {current && renderIcon?.(current.value)}
          <span className="truncate">{current ? current.label : placeholder}</span>
        </span>
        <svg
          viewBox="0 0 16 16" width="12" height="12" fill="none"
          className={cx('shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 min-w-full w-max max-w-xs z-30 bg-surface border border-hairline rounded-xl shadow-depth-md overflow-hidden flex flex-col">
          {showSearch && (
            <div className="p-1.5 border-b border-hairline shrink-0">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); pick(filtered[0].value) }
                }}
                placeholder={`Search ${placeholder.replace(/^All /i, '').toLowerCase()}…`}
                className="w-full bg-surface2 border border-hairline rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-muted shadow-depth-xs transition-shadow duration-150 focus:outline-none focus:border-selected/50 focus:shadow-focus-ring"
              />
            </div>
          )}
          <div className="overflow-y-auto max-h-60 py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">No matches.</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  className={cx(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors duration-100',
                    o.value === value ? 'bg-selected/25 text-selected-bright font-medium' : 'text-ink hover:bg-surface2'
                  )}
                >
                  {renderIcon?.(o.value)}
                  <span className="truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
