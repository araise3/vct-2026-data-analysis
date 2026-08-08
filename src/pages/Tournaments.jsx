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
    // rft.gg's own events-page grid, verbatim: one column on mobile, the
    // circuit rail from lg, the match rail from xl. Both rails are direct
    // grid children (not nested in the centre column) so bringing them back
    // on mobile later is a CSS `order` swap rather than a second instance --
    // rendering either aside twice would fork the day-strip and compare-box
    // state.
    //
    // `max-w-[1104px] mx-auto` makes THIS page pixel-width-identical to
    // rft.gg's own events page (measured live off their DOM: their content
    // wrapper is 1152px minus 24px padding each side = 1104px usable, which
    // is where their 220/616/220 column split with a 24px gap comes from).
    // Deliberately scoped to this page rather than changing the site-wide
    // `max-w-content` token (1160px) that <main>/TopNav/the footer all
    // share -- that number is a considered match to vlr.gg's own width
    // (see tailwind.config.js's own comment), unrelated to this page's
    // rft.gg clone and not something this fix should quietly move for
    // every other page.
    <div className="mx-auto grid max-w-[1104px] grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px]">
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
            displayed -- every scraper here asserts this in its docstring, but
            until now nothing in src/ actually rendered it. The dates, prize
            pools, locations and fixture list on this page are all Liquipedia's,
            so this is where the obligation lands. Reads the strings from the
            data itself rather than hardcoding them, so a licence change in the
            pipeline surfaces here automatically. */}
        {attribution.length > 0 && (
          <p className="px-1 text-[11px] leading-relaxed text-muted/60">
            {attribution.join(' ')}
          </p>
        )}
      </div>

      {/* Sticky, but capped and scrollable: the rail is taller than the
          viewport once both cards are in, and a plain `sticky top-6` would
          pin its top and strand the bottom rows permanently out of reach. */}
      <aside className="hidden xl:flex xl:flex-col xl:gap-4">
        <UpcomingRail
          days={schedule.days}
          defaultDayKey={defaultDayKey()}
          fetchedAt={schedule.fetchedAt}
        />
        <ResultsRail matches={recent} />
      </aside>
    </div>
  )
}
