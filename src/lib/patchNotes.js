import { todayKey } from './format'

/**
 * Joins/aggregates for the `/patches` page: patch releases (patch_notes.json)
 * against event date ranges (event_meta.json) and against agent pick/win
 * rates (player_agents.json, via expandBuckets(data, 'p')). Pure functions,
 * no React -- mirrors entityBuckets.js's own split between data shaping and
 * the components that render it.
 */

/**
 * Windows below this many team-maps are dropped from the trend chart (too
 * few samples to plot without looking like a real signal) but kept in the
 * table with `n` shown, nothing hidden. 20 team-maps is roughly what one
 * full best-of-3 series across a handful of teams produces -- enough to
 * damp single-map variance without discarding most of the season's
 * shorter (mid-week, low-competition) patch windows outright.
 */
export const MIN_WINDOW_TEAM_MAPS = 20

/**
 * Turns the flat, ascending `patches` array into windows: each patch's
 * `endDate` is the next patch's release date, and the last one stays open
 * until `to` (default today). This is the binning unit `aggregateAgentByWindow`
 * sums records into -- deliberately NOT calendar week/month, because the
 * 2026 competitive calendar has multi-week gaps between events (e.g.
 * Feb 16-27, Mar 16-29, Jun 22-28) that make a fixed calendar window land
 * "after a patch" on a week with no matches at all, diluting a real shift
 * into what looks like noise. Binning by patch window instead means every
 * window boundary is a window a balance change could actually be observed
 * in, however long or short the competitive calendar makes it.
 */
export function buildPatchWindows(patchNotesJson, { to = todayKey() } = {}) {
  const patches = patchNotesJson?.patches || []
  return patches.map((p, i) => ({
    ...p,
    endDate: i + 1 < patches.length ? patches[i + 1].date : to,
  }))
}

/**
 * Map<agent, [{version, date, ability, type, summary, url}]> -- every
 * agent-change entry across every patch, grouped by the agent it touched.
 * Used to place markers on that agent's trend chart and to answer "what
 * changed for Jett" without re-scanning the whole patch list per render.
 */
export function indexChangesByAgent(patches) {
  const out = new Map()
  for (const p of patches || []) {
    for (const change of p.agentChanges || []) {
      const entry = {
        version: p.version, date: p.date, ability: change.ability,
        type: change.type, summary: change.summary, url: p.url,
      }
      if (!out.has(change.agent)) out.set(change.agent, [])
      out.get(change.agent).push(entry)
    }
  }
  return out
}

/**
 * Which window (index into `windows`) a date falls in, or -1 if it's
 * before the first patch's release -- those records predate this dataset's
 * coverage and are excluded from the aggregation rather than guessed into
 * window 0, which would misattribute pre-patch data to a post-patch bin.
 */
export function windowIndexForDate(dateStr, windows) {
  if (!dateStr) return -1
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const isLast = i === windows.length - 1
    if (dateStr < w.date) continue
    // Last window's endDate is `to` (today, by default) and inclusive;
    // every earlier window's endDate is the NEXT patch's release date,
    // exclusive -- that record belongs to the window starting there instead.
    if (isLast ? dateStr <= w.endDate : dateStr < w.endDate) return i
  }
  return -1
}

/**
 * Sum-first aggregation (see CLAUDE.md's bucket-model note): one pass over
 * `records` (expandBuckets(playerAgentsData, 'p') output, already filtered
 * by the page's faceted filter) building per-window totals, THEN divide.
 * `slots` here is playerRows (maps * 1, since each record is one player's
 * one agent on one map) -- team-maps is slots/5, matching AgentOverview.jsx's
 * `teamSlots = totalRows / 5` convention exactly, so pick rates from this
 * view and from the Agents page mean the same thing.
 */
export function aggregateAgentByWindow(records, windows) {
  const out = windows.map((w) => ({ ...w, slots: 0, teamMaps: 0, byAgent: new Map() }))
  for (const r of records) {
    const idx = windowIndexForDate(r.date, windows)
    if (idx === -1) continue
    const bucket = out[idx]
    bucket.slots += r.maps || 0
    let a = bucket.byAgent.get(r.ag)
    if (!a) {
      a = { picks: 0, wins: 0 }
      bucket.byAgent.set(r.ag, a)
    }
    a.picks += r.maps || 0
    a.wins += r.wn || 0
  }
  for (const bucket of out) bucket.teamMaps = bucket.slots / 5
  return out
}

/**
 * `windowAggs` (aggregateAgentByWindow's output) -> a point series for
 * TrendChart, for one agent and one metric ('pick' | 'win').
 *
 * `n` is teamMaps for pick rate (the denominator size) and picks for win
 * rate (win rate's own denominator) -- what each metric's own sample size
 * actually is, so a thin window reads as thin regardless of which metric
 * is showing. `label` is `'v' + version`, matching TrendChart's existing
 * convention of a label overriding the date on axis ends/tooltips.
 *
 * Windows under `minTeamMaps` are dropped (spike risk from a handful of
 * maps), and for 'win' a window with zero picks is dropped too (no rate to
 * plot, not a real 0%).
 */
export function agentSeries(windowAggs, agent, metric, { minTeamMaps = MIN_WINDOW_TEAM_MAPS } = {}) {
  const points = []
  for (const w of windowAggs) {
    if (w.teamMaps < minTeamMaps) continue
    const a = w.byAgent.get(agent)
    const picks = a?.picks || 0
    if (metric === 'win' && picks === 0) continue
    const value = metric === 'pick' ? (w.teamMaps ? picks / w.teamMaps : 0) : picks ? a.wins / picks : null
    if (value === null) continue
    points.push({
      date: w.date,
      value,
      n: metric === 'pick' ? w.teamMaps : picks,
      label: `v${w.version}`,
    })
  }
  return points
}

/**
 * One row per 2026 event (Join 1: patch releases x event date ranges), for
 * PatchTimeline. `eventMetaEvents` is event_meta.json's `.events` map
 * (displayName -> {startDate, endDate, patchStart, patchEnd, ...});
 * `eventsLookup` is player_agents.json's `.events` map (numeric id ->
 * {name, region, stage, competition, year}), used here only to join
 * region/split onto each event by NAME -- event_meta.json's own keys are
 * the raw scraped names ("Vct 2026 Americas Kickoff"), which match
 * eventsLookup's `.name` field exactly (confirmed: all 16 event_meta keys
 * have a matching eventsLookup entry by name).
 *
 * `patchStart`/`patchEnd` are Liquipedia's own ground truth for which
 * patch(es) the event was actually played on (its Infobox league's
 * `|patch=`/`|epatch=` fields -- see liquipedia_schedule_scraper.py), NOT
 * inferred from which patch-release lines happen to cross the event's date
 * bar. Both are `null` for an event Liquipedia hasn't recorded a patch for
 * yet (an unplayed future event, or one whose page hasn't been updated
 * since it wrapped) -- PatchTimeline renders that as "TBD" rather than
 * guessing from dates, since a patch's release date falling inside an
 * event's date range is exactly the kind of coincidence that used to
 * produce a wrong answer (a patch can ship mid-event without the event
 * actually moving onto it until the next map/round).
 */
export function buildTimelineRows(eventMetaEvents, eventsLookup, patches) {
  const byName = new Map()
  for (const ev of Object.values(eventsLookup || {})) {
    if (!byName.has(ev.name)) byName.set(ev.name, ev)
  }

  const rows = Object.entries(eventMetaEvents || {})
    .map(([name, em]) => {
      const ev = byName.get(name)
      return {
        name,
        startDate: em.startDate,
        endDate: em.endDate,
        patchStart: em.patchStart ?? null,
        patchEnd: em.patchEnd ?? null,
        region: ev?.region ?? null,
        split: ev?.stage ?? null,
        competition: ev?.competition ?? null,
      }
    })
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || a.name.localeCompare(b.name))

  const dates = []
  for (const r of rows) {
    if (r.startDate) dates.push(r.startDate)
    if (r.endDate) dates.push(r.endDate)
  }
  for (const p of patches || []) dates.push(p.date)
  const domain = dates.length ? [dates.reduce((a, b) => (b < a ? b : a)), dates.reduce((a, b) => (b > a ? b : a))] : null

  return { rows, domain }
}
