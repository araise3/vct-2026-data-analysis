import { useMemo, useState } from 'react'
import { scaleColor } from '../lib/format'

/**
 * columns: [{ key, label, format(v), colorScale?: true, align?: 'left'|'right' }]
 *
 * The color domain for each colorScale column is the min/max of whatever
 * rows are currently displayed -- confirmed against two real vlr.gg
 * screenshots that this must be relative to the current filtered view,
 * not a fixed global constant: a player with Rating 1.33 hit the maximum
 * hue (270°) on one page, while a player with a *higher* Rating (1.42) on
 * a different, broader page only reached 259.6° -- impossible if both
 * were being measured against the same fixed scale. Each view's own
 * min/max is what's actually being used.
 */
/**
 * columns: [{ key, label, format(v), colorScale?: true, align?: 'left'|'right' }]
 *
 * Deliberately no per-column width/table-layout:fixed: that mode forces
 * every column to split whatever space is left after the sized ones,
 * which kept shrinking (and truncating headers) every time a new column
 * got added -- this has recurred several times as columns were added
 * over time. Default table-layout:auto instead, so every column sizes
 * itself to its own content and can never truncate; the wrapping
 * overflow-auto div handles horizontal scroll if the whole table is
 * wider than the viewport, which is normal for a many-column stats table.
 */
export default function DataTable({ columns, rows, defaultSortKey, defaultSortDir = 'desc' }) {
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState(defaultSortDir)

  const colorRanges = useMemo(() => {
    const ranges = {}
    columns.forEach((col) => {
      if (col.colorScale) {
        const values = rows.map((r) => r[col.key]).filter((v) => v !== null && v !== undefined && !Number.isNaN(v))
        ranges[col.key] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1]
      }
    })
    return ranges
  }, [columns, rows])

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="overflow-auto rounded-2xl border border-hairline">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface2 sticky top-0 z-10">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className={`px-4 py-3 font-medium text-xs uppercase tracking-wide text-muted cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors align-middle border border-hairline ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
                {sortKey === col.key && <span className="ml-1 text-accent">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="hover:bg-surface/60 transition-colors">
              {columns.map((col) => {
                const value = row[col.key]
                const bg = col.colorScale && colorRanges[col.key]
                  ? scaleColor(value, colorRanges[col.key][0], colorRanges[col.key][1])
                  : undefined
                return (
                  <td
                    key={col.key}
                    style={bg ? { backgroundColor: bg } : undefined}
                    className={`px-4 py-2.5 font-body text-[13px] whitespace-nowrap align-middle border border-hairline ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${col.key === columns[0].key ? 'text-ink' : 'text-ink/90'}`}
                  >
                    {col.format ? col.format(value, row) : value ?? '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
