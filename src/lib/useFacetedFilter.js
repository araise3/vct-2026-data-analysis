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
 * `options` is a one-directional HIERARCHY, not the symmetric "is this
 * value still reachable given every other facet" availability flag that
 * used to live here and was removed (see FacetGroup's own comment): that
 * version dimmed a chip based on ANY other active facet regardless of
 * direction -- e.g. picking a specific VCT-only Event dimmed the EWC chip
 * under Competition, which reads backwards (Competition is conceptually
 * the parent of Event, not the other way round) and is exactly the
 * "feels like a bug" case that got it deleted.
 *
 * This version only ever narrows DOWNWARD: a facet's value list is built
 * from records that already match every facet BEFORE it in the `facets`
 * array (its "ancestors"), never facets after it. `facets` is passed in
 * pre-ordered top-down (year -> competition -> region -> split -> event ->
 * eventPhase -> eventWeek, see FilterPanel's FACETS/TOP_FACETS), matching
 * the order the chips actually render in, so picking Year narrows Event's
 * option list but picking Event never narrows Year's. A facet's own
 * CURRENTLY SELECTED values are always kept in its option list even if an
 * ancestor change since they were picked would otherwise exclude them --
 * a chip should never vanish purely as a side effect of touching a
 * different facet; the user can still see it and deliberately deselect it
 * (matching this codebase's existing rule that an active selection is
 * never hidden, e.g. FilterPanel's collapsed-facet handling).
 *
 * This does re-add `selections` to the memo's dependencies (the old,
 * removed version dropped it specifically to avoid recomputing on every
 * click), but it's a much cheaper computation than what was removed: only
 * ancestor facets are tested per record (not every facet x every value),
 * the same order of work the un-narrowed value-list pass already did.
 */
const EMPTY_RANGE = { from: '', to: '' }

function initialStateFromUrl(facets, initial) {
  const selections = Object.fromEntries(facets.map((facet) => [facet, initial[facet] ?? []]))
  const dateRange = { ...EMPTY_RANGE }
  if (typeof window === 'undefined') return { selections, dateRange }

  const params = new URLSearchParams(window.location.search)
  for (const facet of facets) {
    if (!params.has(facet)) continue
    const values = params.getAll(facet)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
    selections[facet] = facet === 'year'
      ? values.map(Number).filter(Number.isFinite)
      : values
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('from') || '')) dateRange.from = params.get('from')
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('to') || '')) dateRange.to = params.get('to')
  return { selections, dateRange }
}

/**
 * Events left out of every page's scope by default, regardless of Year/
 * Event facet selections, with a checkbox (rendered by FilterPanel) to
 * bring them back. Champions Tour 2023 Champions China Qualifier: a
 * scrappy regional qualifier bracket (obscure amateur teams like "Douyu
 * Gaming", "Gank Gaming", "Kingzone" -- see project-history's team-logo
 * backfill entry) that otherwise slips back into scope the moment a page's
 * Year facet includes 2023, alongside every legitimate 2023 event (Masters
 * Tokyo, Champions, the real regional Leagues). A dedicated exclusion
 * rather than something expressible via the Year/Event facets alone --
 * those are OR'd inclusion lists, so leaving this out by default while
 * keeping every OTHER 2023 event in requires either re-selecting all of
 * them individually (fragile: a future 2023 event addition wouldn't be
 * picked up automatically) or a separate default-off toggle, which is
 * what this is. Direct request, not a data-quality judgment call made
 * unilaterally.
 */
export const HIDDEN_BY_DEFAULT_EVENTS = new Set([
  'Champions Tour 2023 Champions China Qualifier',
])

/**
 * Is a record's date inside the selected range?
 *
 * Most records -- bucket or match-level row -- carry exactly one date,
 * since buckets are keyed per calendar day upstream, making this an exact
 * filter. Dates are YYYY-MM-DD so lexicographic comparison is chronological.
 *
 * player_buckets.json is the one exception: it's keyed only by
 * (player, event, week), with no day dimension at all (see expandBuckets'
 * own comment -- its `d` field is deaths, not a date), so a player_buckets
 * record never carries `date` and this used to silently pass every such
 * record through regardless of the selected range -- the DATE RANGE control
 * looked live but filtered nothing on any page whose rows are built from
 * player_buckets (Players.jsx, most visibly). `attachDateSpans` in
 * entityBuckets.js can attach an approximate `dateMin`/`dateMax` span
 * instead (the real min/max day its maps were played on, joined from
 * player_agents.json, which shares the same key at a finer per-agent grain
 * with a genuine per-day date) -- when present, this checks SPAN OVERLAP
 * against the selected range rather than an exact match, since a week-
 * grained bucket may span several real days.
 *
 * Records with no date info at all (neither `date` nor a span) pass
 * through rather than being filtered out, so a future export missing dates
 * degrades to "no date filter" instead of silently emptying every page.
 */
function inDateRange(record, { from, to }) {
  if (!from && !to) return true
  if (record.date) {
    const d = record.date
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  }
  if (record.dateMin && record.dateMax) {
    if (to && record.dateMin > to) return false
    if (from && record.dateMax < from) return false
    return true
  }
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
export function matchesFilters(record, facets, selections, dateRange = EMPTY_RANGE, includeHiddenEvents = false) {
  if (!includeHiddenEvents && HIDDEN_BY_DEFAULT_EVENTS.has(record.event)) return false
  if (!inDateRange(record, dateRange)) return false
  return facets.every((f) => matchesOneFacet(record, selections[f], record[f]))
}

export function useFacetedFilter(records, facets, initial = {}) {
  const [urlInitial] = useState(() => initialStateFromUrl(facets, initial))
  const [selections, setSelections] = useState(urlInitial.selections)
  const [dateRange, setDateRangeState] = useState(urlInitial.dateRange)
  const [includeHiddenEvents, setIncludeHiddenEvents] = useState(false)

  const setFacet = useCallback((facet, values) => {
    setSelections((prev) => ({ ...prev, [facet]: values }))
  }, [])

  const setDateRange = useCallback((next) => {
    setDateRangeState((prev) => ({ ...prev, ...next }))
  }, [])

  const clearAll = useCallback(() => {
    setSelections(Object.fromEntries(facets.map((f) => [f, initial[f] ?? []])))
    setDateRangeState(EMPTY_RANGE)
    setIncludeHiddenEvents(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets])

  const filtered = useMemo(
    () => records.filter((r) => matchesFilters(r, facets, selections, dateRange, includeHiddenEvents)),
    [records, facets, selections, dateRange, includeHiddenEvents]
  )

  // For each dimension: every value reachable given its ANCESTORS' current
  // selections (see the note on hierarchy at the top of this file), plus
  // whatever's already selected on this facet itself. Also depends on
  // includeHiddenEvents, so a hidden event's own Event/Phase/Week chips
  // disappear from the pickable options while it's excluded, rather than
  // offering a chip that would filter down to nothing.
  const options = useMemo(() => {
    const out = {}
    for (let i = 0; i < facets.length; i++) {
      const facet = facets[i]
      const ancestors = facets.slice(0, i)
      const allValues = new Set()
      for (const r of records) {
        if (!includeHiddenEvents && HIDDEN_BY_DEFAULT_EVENTS.has(r.event)) continue
        if (!ancestors.every((af) => matchesOneFacet(r, selections[af], r[af]))) continue
        const v = r[facet]
        if (v === undefined || v === null) continue
        allValues.add(v)
      }
      for (const v of selections[facet] || []) allValues.add(v)
      out[facet] = [...allValues]
        .sort((a, b) => String(a).localeCompare(String(b)))
        .map((value) => ({ value }))
    }
    return out
  }, [records, facets, selections, includeHiddenEvents])

  const activeCount =
    facets.reduce((n, f) => n + (selections[f]?.length || 0), 0) +
    (dateRange.from || dateRange.to ? 1 : 0)

  // Earliest/latest date present, to bound the date inputs -- same
  // date-or-span reasoning as inDateRange above, so a span-only dataset
  // (player_buckets + attachDateSpans) still gets real bounds instead of
  // an unrestricted picker.
  const dateBounds = useMemo(() => {
    let min = null
    let max = null
    for (const r of records) {
      const lo = r.date || r.dateMin
      const hi = r.date || r.dateMax
      if (!lo || !hi) continue
      if (min === null || lo < min) min = lo
      if (max === null || hi > max) max = hi
    }
    return { min, max }
  }, [records])

  return {
    selections, setFacet, clearAll, filtered, options, activeCount,
    dateRange, setDateRange, dateBounds,
    includeHiddenEvents, setIncludeHiddenEvents,
  }
}
