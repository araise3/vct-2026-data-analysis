import { useMemo, useState } from 'react'
import { scaleColor } from '../lib/format'

// Browsers treat "/" as a soft line-break opportunity even with no
// surrounding whitespace (it's in Unicode's "break after" class per
// UAX#14), so a short label like "K/D" can wrap into "K/" + "D" once
// wrapping headers made column widths hug their data rather than their
// header text. Word-joiners (U+2060) on both sides of the slash forbid a
// break there specifically, while leaving genuine word-break opportunities
// (spaces, e.g. "Match Win%") untouched.
const WORD_JOINER = '⁠'
function noBreakSlash(label) {
  return typeof label === 'string' ? label.replace(/\//g, `${WORD_JOINER}/${WORD_JOINER}`) : label
}

/**
 * columns: [{ key, label, format(v), colorScale?: true, colorInvert?: true, align?: 'left'|'right', noPadding?: true }]
 *
 * summaryRow: an optional extra row (e.g. "Overall"/"All Maps" totals)
 * pinned above the sortable body -- rendered from the same columns/format
 * functions but never included in the sort or in a colorScale column's
 * min/max, since a totals row isn't a value to rank alongside the ones
 * it's summarizing.
 *
 * noPadding drops the cell's default px-4 py-1.5 -- for a column whose
 * format() wants to size/pad its own content (e.g. an icon meant to fill
 * the cell) rather than sit inside the standard text padding.
 *
 * width (px number) pins a column to a fixed width via inline style on
 * both th and td, applied uniformly rather than through table-layout:fixed
 * (see the note below on why that mode is avoided globally) -- for a
 * handful of columns that are known to hold short, similarly-shaped
 * content (e.g. one map name per column, repeated identically across two
 * separate <table> elements) and need to line up with each other rather
 * than each auto-sizing independently to its own table's content.
 *
 * colorInvert flips the scale for stats where lower is better (rating
 * consistency, first deaths) so "good" still reads as the high end of the
 * hue range rather than the value literally being large.
 *
 * The color domain for each colorScale column is the min/max of whatever
 * rows are currently displayed -- confirmed against two real vlr.gg
 * screenshots that this must be relative to the current filtered view,
 * not a fixed global constant: a player with Rating 1.33 hit the maximum
 * hue (270°) on one page, while a player with a *higher* Rating (1.42) on
 * a different, broader page only reached 259.6° -- impossible if both
 * were being measured against the same fixed scale. Each view's own
 * min/max is what's actually being used.
 *
 * Deliberately no per-column width/table-layout:fixed: that mode forces
 * every column to split whatever space is left after the sized ones,
 * which kept shrinking (and truncating headers) every time a new column
 * got added -- this has recurred several times as columns were added
 * over time. Default table-layout:auto instead, so every column sizes
 * itself to its own content and can never truncate; the wrapping
 * overflow-auto div handles horizontal scroll if the whole table is
 * wider than the viewport, which is normal for a many-column stats table.
 *
 * Header cells wrap (`whitespace-normal`, not `-nowrap`) while data cells
 * stay `whitespace-nowrap` -- a header label like "MATCH WIN%" or "PISTOL
 * WIN%" is routinely wider than the data underneath it ("75.0%"), and
 * under table-layout:auto an unbreakable header was what forced the whole
 * column that wide, not the data. Letting the header wrap onto two lines
 * means the column settles to whatever the (non-wrapping) data actually
 * needs, which is what makes a table like Teams or Players fit inside
 * rft.gg's 1152px content column instead of needing its own horizontal
 * scrollbar. The label span itself needs `min-w-0` -- flex items default
 * to `min-width: auto`, which refuses to shrink below the text's own
 * unwrapped width and would silently cancel the wrap (see App.jsx's
 * comment on the same flex/min-width gotcha).
 *
 * border-separate (not border-collapse) on the table: border-collapse
 * doesn't reliably merge borders across a position:sticky boundary in
 * most browsers, which left a gap where the grid lines should have
 * continued from the body up into the sticky header. border-separate
 * with 0 spacing avoids that, at the cost of each cell owning its own
 * border rather than sharing one with its neighbor -- so cells only set
 * border on the right/bottom (border-hairline provides left/top via the
 * previous cell's right/bottom edge, and the outer wrapper's border
 * covers the table's own left/top edge).
 */
export default function DataTable({ columns, rows, defaultSortKey, defaultSortDir = 'desc', summaryRow }) {
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
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-surface2 sticky top-0 z-10">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                className={`${col.noPadding ? 'px-1.5' : 'px-4'} py-2 font-medium text-[11px] uppercase tracking-wide cursor-pointer select-none whitespace-normal transition-colors align-middle border-r border-b border-hairline ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                } ${sortKey === col.key ? 'text-accent' : 'text-muted hover:text-ink'}`}
              >
                {/*
                  The arrow slot is a fixed-width inline-flex span that's
                  ALWAYS rendered -- just toggling visibility, never
                  mounted/unmounted -- so every header reserves the exact
                  same width for it from the very first render, whether
                  that column is the active sort or not. That's what
                  keeps a column's width constant when you click to sort
                  it: nothing about the header's own content size changes,
                  only which glyph is visible inside a slot that was
                  always there. (A previous attempt reserved this space
                  only on the active column, which grew that column on
                  click; reserving it on every column from the start,
                  uniformly, is what avoids that.)

                  justify-end, combined with flex-row-reverse: this span is
                  `w-full` (needed so the label has a bounded width to wrap
                  against, see the wrapping note above), so its own
                  positioning within that full-width box no longer follows
                  the th's text-align the way a shrink-wrapped inline-flex
                  used to -- it has to be placed explicitly. flex-end packs
                  the label+arrow group at the main-end, and flex-row-reverse
                  itself flips which physical edge "main-end" is: for a
                  normal row that's the right edge (correct for a
                  right-aligned numeric column), and for row-reverse it's
                  the left edge (correct for a left-aligned column like
                  Player/Team) -- so the same justify-end works for both
                  branches below.
                */}
                <span className={`flex w-full items-center justify-end gap-1 align-middle ${col.align === 'right' ? '' : 'flex-row-reverse'}`}>
                  <span
                    className={`inline-block w-2.5 shrink-0 text-[10px] leading-none text-accent ${
                      sortKey === col.key ? '' : 'invisible'
                    }`}
                  >
                    {sortDir === 'asc' ? '▲' : '▼'}
                  </span>
                  <span className="min-w-0 leading-tight">{noBreakSlash(col.label)}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaryRow && (
            <tr className="bg-surface2/60 font-semibold">
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                  className={`${col.noPadding ? '' : 'px-4 py-1.5'} font-body text-[12px] whitespace-nowrap align-middle border-r border-b-2 border-hairline ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } text-ink`}
                >
                  {col.format ? col.format(summaryRow[col.key], summaryRow) : summaryRow[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          )}
          {sorted.map((row, i) => (
            <tr key={i} className="hover:bg-surface/60 transition-colors">
              {columns.map((col) => {
                const value = row[col.key]
                const range = col.colorScale && colorRanges[col.key]
                const bg = range
                  ? scaleColor(
                      value,
                      col.colorInvert ? range[1] : range[0],
                      col.colorInvert ? range[0] : range[1]
                    )
                  : undefined
                const style = {}
                if (bg) style.backgroundColor = bg
                if (col.width) { style.width = col.width; style.minWidth = col.width }
                return (
                  <td
                    key={col.key}
                    style={Object.keys(style).length ? style : undefined}
                    className={`${col.noPadding ? '' : 'px-4 py-1.5'} font-body text-[12px] whitespace-nowrap align-middle border-r border-b border-hairline ${
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
