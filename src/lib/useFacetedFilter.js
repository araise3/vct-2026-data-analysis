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
export function useFacetedFilter(records, facets) {
  const [selections, setSelections] = useState(() =>
    Object.fromEntries(facets.map((f) => [f, []]))
  )

  const setFacet = useCallback((facet, values) => {
    setSelections((prev) => ({ ...prev, [facet]: values }))
  }, [])

  const clearAll = useCallback(() => {
    setSelections(Object.fromEntries(facets.map((f) => [f, []])))
  }, [facets])

  const matchesExcept = useCallback(
    (record, exceptFacet) =>
      facets.every((f) => {
        if (f === exceptFacet) return true
        const sel = selections[f]
        return !sel || sel.length === 0 || sel.includes(record[f])
      }),
    [facets, selections]
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

  const activeCount = facets.reduce((n, f) => n + (selections[f]?.length || 0), 0)

  return { selections, setFacet, clearAll, filtered, options, activeCount }
}
