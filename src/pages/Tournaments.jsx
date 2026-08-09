import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { expandMatchRows } from '../lib/entityBuckets'
import { buildEventList, splitByStatus, groupByMonth, currentCircuits } from '../lib/eventMeta'
import { normalizeUpcoming, defaultDayKey, recentResults } from '../lib/schedule'
import EventRow from '../components/EventRow'
import FilterChips from '../components/FilterChips'
import { UpcomingRail, ResultsRail } from '../components/MatchRail'
import CircuitList from '../components/CircuitList'
import PlayerOfMonthCard from '../components/PlayerOfMonthCard'
import ComparePlayersCard from '../components/ComparePlayersCard'
import { monthLabel, num } from '../lib/format'

/**
 * The Events index, rebuilt after rft.gg/events: a three-column page with
 * the circuit list on the left, the event list in the centre, and a calendar
 * of upcoming matches on the right.
 *
 * Route stays `/tournaments` (and rows still link to
 * `/tournaments/{name}` -> TournamentDetail.jsx). The page no longer renders
 * any match list of its own -- expanding a row inline was replaced by the
 * per-event page, matching rft.gg, whose event cards are plain links too.
 *
 * The one structural fix behind the visible change: this builds its list from
 * `match_results.json`'s own events LOOKUP rather than by grouping match
 * ROWS, so an event with no matches yet is no longer invisible (see
 * src/lib/eventMeta.js -- Valorant Champions 2026 was, and it's the single
 * most interesting row on the Scheduled tab).
 */

const TABS = ['Scheduled', 'Finished']

export default function Tournaments() {
  const { data: matchData, loading } = useData('match_results')
  const { data: eventMetaData } = useData('event_meta')
  const { data: upcomingData } = useData('upcoming_matches')
  const { data: playerMonthData } = useData('player_month')

  const records = useMemo(() => expandMatchRows(matchData), [matchData])

  const events = useMemo(
    () => buildEventList(matchData, records, eventMetaData, upcomingData),
    [matchData, records, eventMetaData, upcomingData]
  )

  const { scheduled, finished } = useMemo(() => splitByStatus(events), [events])

  // Scheduled leads, since a live season is what someone opening this page is
  // most likely after -- but never land on a blank tab, so an off-season with
  // nothing scheduled falls back to Finished.
  const [tab, setTab] = useState(null)
  const activeTab = tab ?? (scheduled.length > 0 ? 'Scheduled' : 'Finished')
  const isScheduled = activeTab === 'Scheduled'
  const shown = isScheduled ? scheduled : finished
  // Group on whichever date the tab is sorted by, or the same month reappears
  // further down the list (see groupByMonth's own note).
  const months = useMemo(
    () => groupByMonth(shown, isScheduled ? (e) => e.startDate : (e) => e.endDate),
    [shown, isScheduled]
  )

  const schedule = useMemo(
    () => normalizeUpcoming(upcomingData, records),
    [upcomingData, records]
  )
  const recent = useMemo(() => recentResults(records, 8), [records])
  const circuits = useMemo(() => currentCircuits(events), [events])

  // Deduped so the two Liquipedia files don't repeat the same licence line if
  // their wording ever converges.
  const attribution = useMemo(() => [...new Set(
    [eventMetaData?._meta?.attribution, upcomingData?._meta?.attribution].filter(Boolean)
  )], [eventMetaData, upcomingData])

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  return (
    // rft.gg's content wrapper is NOT a single fixed number -- it's
    // responsive: 1152px usable-1104 below Tailwind's `2xl` breakpoint
    // (1536px), jumping to 1250px usable-1202 at/above it. Confirmed by
    // binary-searching their live site: 1535px viewport -> 616px centre
    // column, 1536px -> 714px, holds through 2560px (no further tier). A
    // single static max-width (what this page shipped with initially)
    // matches rft.gg correctly below 1536px but is visibly narrower on any
    // normal desktop monitor at or above it -- exactly the gap a side-by-
    // side screenshot at ~1920px caught.
    //
    // `<main>`'s own `max-w-content` (1160px, shared by every other page) is
    // NOT itself responsive, so simply widening THIS page's own max-width at
    // 2xl doesn't work on its own -- <main> would still clamp it to 1112px
    // usable regardless (confirmed: adding `2xl:max-w-[1202px]` to the grid
    // alone measured 624px centre, not 714px, since the parent's static cap
    // wins first). Fixed with a NEGATIVE MARGIN active only at 2xl, sized to
    // exactly the gap between the two: main's own usable width at 2xl is
    // 1160 - 48 (its own px-4 md:px-6) = 1112px; the target is 1202px; the
    // difference (90px) split evenly is 45px per side. A block element's
    // rendered width with `width: auto` is containing-block-width minus its
    // own margins, so `-45px` margin on each side makes this wrapper render
    // at exactly 1112 + 90 = 1202px -- deliberately NOT the more common
    // `w-screen` + `left-1/2 -translate-x-1/2` full-bleed trick, which was
    // tried first and measured a real 5px horizontal-scroll bug (100vw
    // includes the scrollbar's own width in this engine, so `w-screen` is
    // reliably a few px wider than the actual visible viewport once a page
    // is tall enough to show one). This margin technique never references
    // the viewport at all, so it can't have that failure mode.
    <div className="2xl:-mx-[45px]">
      {/* rft.gg's own events-page grid, verbatim: one column on mobile, the
          circuit rail from lg, the match rail from xl. Both rails are direct
          grid children (not nested in the centre column) so bringing them
          back on mobile later is a CSS `order` swap rather than a second
          instance -- rendering either aside twice would fork the day-strip
          and compare-box state. */}
      <div className="mx-auto grid max-w-[1104px] grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px] 2xl:max-w-[1202px]">
        <aside className="hidden lg:flex lg:flex-col lg:gap-4">
          <CircuitList circuits={circuits} />
          <PlayerOfMonthCard data={playerMonthData} />
          <ComparePlayersCard />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink">Events</h1>
              <p className="mt-1 text-sm text-muted">
                {events.length} events · {num(records.length)} matches
              </p>
            </div>
            <FilterChips options={TABS} value={activeTab} onChange={setTab} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            {shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                No {activeTab.toLowerCase()} events.
              </p>
            ) : (
              months.map((g) => (
                <div key={g.key}>
                  <div className="border-b border-hairline bg-surface2/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {g.anchorDate ? monthLabel(g.anchorDate) : 'Dates TBD'}
                  </div>
                  <div className="divide-y divide-hairline/60 px-2 py-1">
                    {g.events.map((e) => (
                      <EventRow key={e.name} event={e} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* CC-BY-SA 3.0 requires attribution wherever Liquipedia content is
              displayed -- every scraper here asserts this in its docstring,
              but until now nothing in src/ actually rendered it. The dates,
              prize pools, locations and fixture list on this page are all
              Liquipedia's, so this is where the obligation lands. Reads the
              strings from the data itself rather than hardcoding them, so a
              licence change in the pipeline surfaces here automatically. */}
          {attribution.length > 0 && (
            <p className="px-1 text-[11px] leading-relaxed text-muted/60">
              {attribution.join(' ')}
            </p>
          )}
        </div>

        <aside className="hidden xl:flex xl:flex-col xl:gap-4">
          <UpcomingRail
            days={schedule.days}
            defaultDayKey={defaultDayKey()}
            fetchedAt={schedule.fetchedAt}
          />
          <ResultsRail matches={recent} />
        </aside>
      </div>
    </div>
  )
}
