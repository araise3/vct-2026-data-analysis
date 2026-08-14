import { Fragment, useMemo, useState } from 'react'
import { scaleColor, scaleDivergingColor } from '../lib/format'

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
 * noPadding drops the cell's default padding -- for a column whose
 * format() wants to size/pad its own content (e.g. an icon meant to fill
 * the cell) rather than sit inside the standard text padding.
 *
 * Cell typography/horizontal padding is vlr.gg/stats's own, read directly
 * off its live computed styles rather than approximated: header cells are
 * 10px/700-weight uppercase (15px left / 10px right on a left-aligned
 * column, 3px left / 10px right on a right-aligned one -- vlr gives
 * right-aligned numeric columns less left-side padding since their content
 * is already pushed away from the border by the right alignment); body
 * cells are 12px/18px line-height. Vertical padding (py-2 header, py-1.5
 * body) stays this site's own rather than vlr's -- vlr uses zero vertical
 * padding and leans on whatever its tallest column (28px agent icons) sets
 * the row height to, which reads as too cramped once translated onto a
 * table without an equivalently tall column.
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
 * diverging (paired with colorScale: true) switches a column to
 * scaleDivergingColor instead -- a fixed green-above/red-below-50% scale
 * for stats with a real, absolute neutral point (a win rate), rather than
 * scaleColor's view-relative min/max. No domain is computed for it here.
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
 *
 * renderExpanded (optional): when given, every row gets a trailing chevron
 * toggle (after every column, not before); clicking it inserts a second
 * <tr> right below that row, spanning every column, containing whatever
 * renderExpanded(row) returns -- for showing a nested breakdown (e.g.
 * TeamProfile's Compositions table, where
 * each composition row expands into its own player-by-player table) without
 * a separate control elsewhere on the page driving a second, disconnected
 * table. expandKey(row) supplies the identity used to track which rows are
 * open (defaults to the row's index, which is fine as long as `rows` isn't
 * re-ordered out from under an open row -- pass a real stable key, e.g. the
 * row's own `key` field, whenever the caller's rows can be re-sorted while
 * a row is expanded, so the same LOGICAL row stays open across the sort).
 */
export default function DataTable({
  columns, rows, defaultSortKey, defaultSortDir = 'desc', summaryRow, renderExpanded, expandKey,
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState(defaultSortDir)
  const [expanded, setExpanded] = useState(() => new Set())

  function toggleExpanded(key) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const colorRanges = useMemo(() => {
    const ranges = {}
    columns.forEach((col) => {
      // diverging columns are colored against a fixed 50% midpoint (see
      // scaleDivergingColor), not the current view's own min/max, so they
      // don't need a domain computed here at all.
      if (col.colorScale && !col.diverging) {
        // Single pass, no intermediate arrays and no Math.min(...values):
        // spreading a row set into an argument list is O(rows) stack slots
        // per column, which is both slower than a loop and a real (if
        // distant) blow-up risk on a table with enough rows.
        let min = Infinity
        let max = -Infinity
        for (const r of rows) {
          const v = r[col.key]
          if (v === null || v === undefined || Number.isNaN(v)) continue
          if (v < min) min = v
          if (v > max) max = v
        }
        ranges[col.key] = min === Infinity ? [0, 1] : [min, max]
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

  const colSpan = columns.length + (renderExpanded ? 1 : 0)

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
                className={`${
                  col.noPadding ? 'px-1.5 py-2' : col.align === 'right' ? 'pl-[3px] pr-[10px] py-2' : 'pl-[15px] pr-[10px] py-2'
                } font-bold text-[10px] uppercase cursor-pointer select-none whitespace-normal transition-colors align-middle border-r border-b border-hairline ${
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
            {renderExpanded && (
              <th
                aria-hidden="true"
                className="w-8 px-1.5 py-2 border-r border-b border-hairline"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {summaryRow && (
            <tr className="bg-surface2/60 font-semibold">
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                  className={`${
                    col.noPadding ? '' : col.align === 'right' ? 'pr-[10px]' : 'pl-[15px]'
                  } py-1.5 font-body text-[12px] leading-[18px] whitespace-nowrap align-middle border-r border-b-2 border-hairline ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } text-ink`}
                >
                  {col.format ? col.format(summaryRow[col.key], summaryRow) : summaryRow[col.key] ?? '—'}
                </td>
              ))}
              {renderExpanded && <td className="border-r border-b-2 border-hairline" />}
            </tr>
          )}
          {sorted.map((row, i) => {
            const key = expandKey ? expandKey(row) : i
            const isOpen = renderExpanded && expanded.has(key)
            return (
              <Fragment key={key}>
                <tr className="hover:bg-surface/60 transition-colors">
                  {columns.map((col) => {
                    const value = row[col.key]
                    const range = col.colorScale && colorRanges[col.key]
                    const bg = col.diverging
                      ? scaleDivergingColor(value)
                      : range
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
                        className={`${
                          col.noPadding ? '' : col.align === 'right' ? 'pr-[10px]' : 'pl-[15px]'
                        } py-1.5 font-body text-[12px] leading-[18px] whitespace-nowrap align-middle border-r border-b border-hairline ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        } ${col.key === columns[0].key ? 'text-ink' : 'text-ink/90'}`}
                      >
                        {col.format ? col.format(value, row) : value ?? '—'}
                      </td>
                    )
                  })}
                  {renderExpanded && (
                    <td className="p-0 align-middle border-r border-b border-hairline text-center">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(key)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                        className="w-8 h-full py-1.5 flex items-center justify-center text-muted hover:text-accent-bright transition-colors cursor-pointer"
                      >
                        <span
                          className={`inline-block text-[9px] leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        >
                          ▶
                        </span>
                      </button>
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={colSpan} className="p-3 bg-surface2/40 border-r border-b border-hairline">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
