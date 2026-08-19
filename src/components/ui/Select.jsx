import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'

/**
 * Custom single-select dropdown, replacing the native <select> wherever its
 * popup's own chrome matters visually -- a native select's option list is
 * rendered by the OS/browser itself, which CSS can't put a border-radius or
 * a floating shadow on. This instead renders its own panel, portaled into
 * document.body (see PlayerProfile.jsx's tracker-account menu for the same
 * pattern/rationale -- any ancestor with `overflow-hidden` between a
 * trigger and an absolutely-positioned popup silently clips it, which is
 * exactly what happened once this component started getting used inside
 * PlayerProfile's header card). Position is computed from the trigger's own
 * getBoundingClientRect() on open and the panel closes (rather than
 * re-tracks) on scroll/resize, same as that tracker menu.
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
 *
 * `variant="ghost"`: a borderless, transparent-background trigger (text +
 * chevron only, hover:bg-accent/5) instead of the default bordered/shadowed
 * box -- for a lightweight scope control that sits inline next to other
 * controls (e.g. a season/event picker next to a page's tab row) rather
 * than reading as its own form field. A literal copy of rft.gg's own real
 * `data-slot="select-trigger"` markup/classes (saved "Webpage, Complete"
 * copy of a player page, not a guess) -- `rounded-sm`, fixed `h-7`,
 * `px-2 lg:px-3`, `hover:bg-primary/4` (this site's `accent` token stands
 * in for their `primary`), and the real lucide chevron-down icon at
 * size-4/opacity-50. The dropdown PANEL uses this site's own floating-
 * surface styling either way (rft.gg's own panel markup isn't recoverable
 * from a saved page -- Radix unmounts a closed popup's content entirely,
 * so it's simply not present in the DOM to copy from), but each option row
 * now carries a left-aligned checkmark on the selected item instead of a
 * background tint, matching shadcn/ui's own default SelectItem -- rft.gg's
 * `data-slot="select-trigger"`/`select-value` naming is literally shadcn's,
 * so this is the correct default to assume for the part that couldn't be
 * captured directly.
 */
export default function Select({
  value, onChange, options, placeholder = 'Select…', renderIcon, searchable, className, disabled, variant = 'default',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
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
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScrollOrResize() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, showSearch])

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left, minWidth: rect.width })
    }
    setOpen((o) => !o)
  }

  function pick(v) {
    onChange(v)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={toggleOpen}
        aria-expanded={open}
        className={cx(
          variant === 'ghost'
            ? 'flex w-fit items-center gap-2 cursor-pointer bg-transparent border-0 rounded-sm h-7 px-2 lg:px-3 text-xs font-semibold text-ink whitespace-nowrap transition-colors hover:bg-accent/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-selected/20 disabled:opacity-40 disabled:pointer-events-none'
            : 'flex items-center justify-between gap-2 cursor-pointer bg-surface2 border border-hairline rounded-lg pl-3 pr-2.5 py-1.5 text-sm text-ink shadow-depth-xs transition-shadow duration-150 focus:outline-none focus:border-selected/50 focus:shadow-focus-ring disabled:opacity-40 disabled:pointer-events-none',
          className
        )}
      >
        <span className={cx('flex items-center gap-2 min-w-0 truncate', !current && 'text-muted')}>
          {current && renderIcon?.(current.value)}
          <span className="truncate">{current ? current.label : placeholder}</span>
        </span>
        {variant === 'ghost' ? (
          <svg
            viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={cx('shrink-0 opacity-50 transition-transform duration-150', open && 'rotate-180')}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 16 16" width="12" height="12" fill="none"
            className={cx('shrink-0 text-muted opacity-70 transition-transform duration-150', open && 'rotate-180')}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth }}
          className="w-max max-w-xs z-50 bg-surface border border-hairline rounded-xl shadow-depth-md overflow-hidden flex flex-col"
        >
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
              filtered.map((o) => {
                const selected = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o.value)}
                    className={cx(
                      'relative w-full flex items-center gap-2 py-1.5 pl-7 pr-3 text-sm text-left transition-colors duration-100',
                      selected ? 'text-ink font-medium' : 'text-ink hover:bg-surface2'
                    )}
                  >
                    {selected && (
                      <svg
                        viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round"
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-selected-bright shrink-0"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                    {renderIcon?.(o.value)}
                    <span className="truncate">{o.label}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
