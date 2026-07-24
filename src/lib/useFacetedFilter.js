import { useMemo, useState, useCallback } from 'react'

/**
 * Faceted (multi-select) filtering over a list of records.
 *
 * Every dimension is independent and multi-selectable. An empty selection
 * for a dimension means "no filter on this dimension" (i.e. all values),
 * which is what makes combinations like
 * "Americas + EMEA, Playoffs only, any week" expressible -- something the
 * old cascading single-select model couldn't represent at all.
 *
 * Option availability per dimension is computed against the *other*
 * dimensions' active filters (standard faceted-search behaviour), so a
 * chip is only greyed out if picking it would genuinely yield nothing
 * given everything else currently selected -- selecting a value never
 * makes its own siblings disappear.
 */
const EMPTY_RANGE = { from: '', to: '' }

/**
 * Is a record's date inside the selected range?
 *
 * Every record -- bucket or match-level row -- carries exactly one date,
 * since buckets are keyed per calendar day upstream. That makes this an
 * exact filter rather than a span-overlap approximation. Dates are
 * YYYY-MM-DD so lexicographic comparison is chronological.
 *
 * Records with no date pass through rather than being filtered out, so a
 * future export missing dates degrades to "no date filter" instead of
 * silently emptying every page.
 */
function inDateRange(record, { from, to }) {
  if (!from && !to) return true
  const d = record.date
  if (!d) return true
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

/**
 * Standalone version of the hook's matching logic, for pages that filter a
 * second, differently-shaped record set (match-level series/map rows,
 * player rows on a team-driven page) against the same active selections.
 * Keeping it here means the date range can't be forgotten at a call site.
 */
export function matchesFilters(record, facets, selections, dateRange = EMPTY_RANGE) {
  if (!inDateRange(record, dateRange)) return false
  return facets.every((f) => {
    const sel = selections[f]
    return !sel || sel.length === 0 || sel.includes(record[f])
  })
}

export function useFacetedFilter(records, facets, initial = {}) {
  const [selections, setSelections] = useState(() =>
    Object.fromEntries(facets.map((f) => [f, initial[f] ?? []]))
  )
  const [dateRange, setDateRangeState] = useState(EMPTY_RANGE)

  const setFacet = useCallback((facet, values) => {
    setSelections((prev) => ({ ...prev, [facet]: values }))
  }, [])

  const setDateRange = useCallback((next) => {
    setDateRangeState((prev) => ({ ...prev, ...next }))
  }, [])

  const clearAll = useCallback(() => {
    setSelections(Object.fromEntries(facets.map((f) => [f, initial[f] ?? []])))
    setDateRangeState(EMPTY_RANGE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets])

  const matchesExcept = useCallback(
    (record, exceptFacet) =>
      inDateRange(record, dateRange) &&
      facets.every((f) => {
        if (f === exceptFacet) return true
        const sel = selections[f]
        return !sel || sel.length === 0 || sel.includes(record[f])
      }),
    [facets, selections, dateRange]
  )

  const filtered = useMemo(
    () => records.filter((r) => matchesExcept(r, null)),
    [records, matchesExcept]
  )

  // For each dimension: every value that exists at all, flagged with
  // whether it's still reachable given the other dimensions' filters.
  const options = useMemo(() => {
    const out = {}
    for (const facet of facets) {
      const allValues = new Set()
      const availableValues = new Set()
      for (const r of records) {
        const v = r[facet]
        if (v === undefined || v === null) continue
        allValues.add(v)
        if (matchesExcept(r, facet)) availableValues.add(v)
      }
      out[facet] = [...allValues]
        .sort((a, b) => String(a).localeCompare(String(b)))
        .map((value) => ({ value, available: availableValues.has(value) }))
    }
    return out
  }, [records, facets, matchesExcept])

  const activeCount =
    facets.reduce((n, f) => n + (selections[f]?.length || 0), 0) +
    (dateRange.from || dateRange.to ? 1 : 0)

  // Earliest/latest date present, to bound the date inputs.
  const dateBounds = useMemo(() => {
    let min = null
    let max = null
    for (const r of records) {
      const d = r.date
      if (!d) continue
      if (min === null || d < min) min = d
      if (max === null || d > max) max = d
    }
    return { min, max }
  }, [records])

  return {
    selections, setFacet, clearAll, filtered, options, activeCount,
    dateRange, setDateRange, dateBounds,
  }
}
