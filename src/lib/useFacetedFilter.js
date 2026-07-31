import { useMemo, useState, useCallback } from 'react'
import { SCOPE_SEP } from './entityBuckets'

/**
 * Faceted (multi-select) filtering over a list of records.
 *
 * Every dimension is independent and multi-selectable. An empty selection
 * for a dimension means "no filter on this dimension" (i.e. all values),
 * which is what makes combinations like
 * "Americas + EMEA, Playoffs only, any week" expressible -- something the
 * old cascading single-select model couldn't represent at all.
 *
 * `options` is deliberately just the full value list per dimension, with
 * no per-value "is this still reachable given the other dimensions"
 * availability flag. It used to carry one, computed the standard
 * faceted-search way, but FacetGroup stopped reading it when chip
 * dimming/disabling was removed (see that component's own comment on why
 * dimming read as a bug), leaving the computation with no consumer at all.
 * It was not free: it re-ran matchesFilters for every record x every facet
 * on every selection change -- 11.5ms per filter click over
 * player_buckets' 10,894 records, measured, against 2.8ms for the plain
 * value list. Dropping it also takes `selections`/`dateRange` out of this
 * memo's dependencies entirely, so the list is now computed once per
 * dataset instead of once per interaction. Restoring availability means
 * restoring the matchesExcept pass, not just re-adding a flag.
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

/** The event a scoped value ("Santiago § Swiss Stage") belongs to, or null
 *  if the value isn't scoped at all (plain facets like region/competition). */
function scopedEventOf(value) {
  if (typeof value !== 'string') return null
  const i = value.indexOf(SCOPE_SEP)
  return i === -1 ? null : value.slice(0, i)
}

/**
 * Does `record` satisfy one facet's selection?
 *
 * Scoped facets (eventPhase/eventWeek -- detected by the § separator
 * rather than hardcoded by name, so this keeps working if more scoped
 * facets get added later) need different logic than a plain facet: a
 * selection like "Santiago § Swiss Stage" must only constrain records
 * that actually belong to Santiago. A record from a different event has
 * no opinion expressed for it at all and should pass through untouched --
 * treating the selection as global (the naive `sel.includes(record[f])`)
 * meant picking a phase for one event silently filtered out every other
 * event's data, and made every other event's chip look unselectable.
 */
function matchesOneFacet(record, sel, recordValue) {
  if (!sel || sel.length === 0) return true
  const recordEvent = scopedEventOf(recordValue)
  if (recordEvent !== null) {
    const relevant = sel.filter((s) => scopedEventOf(s) === recordEvent)
    return relevant.length === 0 || relevant.includes(recordValue)
  }
  return sel.includes(recordValue)
}

/**
 * Standalone version of the hook's matching logic, for pages that filter a
 * second, differently-shaped record set (match-level series/map rows,
 * player rows on a team-driven page) against the same active selections.
 * Keeping it here means the date range can't be forgotten at a call site.
 *
 * This used to take an `exceptFacet` argument (skip one dimension), which
 * existed solely for the chip-availability pass the hook no longer runs --
 * see the note at the top of this file. Nothing else ever passed it, so it
 * went with that pass rather than staying as a dead branch inside a loop
 * that runs once per record per facet.
 */
export function matchesFilters(record, facets, selections, dateRange = EMPTY_RANGE) {
  if (!inDateRange(record, dateRange)) return false
  return facets.every((f) => matchesOneFacet(record, selections[f], record[f]))
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

  const filtered = useMemo(
    () => records.filter((r) => matchesFilters(r, facets, selections, dateRange)),
    [records, facets, selections, dateRange]
  )

  // For each dimension: every value that exists in the data at all.
  // Depends only on the records, NOT on the current selections -- see the
  // note on availability at the top of this file.
  const options = useMemo(() => {
    const out = {}
    for (const facet of facets) {
      const allValues = new Set()
      for (const r of records) {
        const v = r[facet]
        if (v === undefined || v === null) continue
        allValues.add(v)
      }
      out[facet] = [...allValues]
        .sort((a, b) => String(a).localeCompare(String(b)))
        .map((value) => ({ value }))
    }
    return out
  }, [records, facets])

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
