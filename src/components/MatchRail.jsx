import { useState } from 'react'
import RailMatch from './RailMatch'
import { dayStripParts, matchTime, shortDate, vlrMatchUrl } from '../lib/format'
import { fiveDayWindow, isLive } from '../lib/schedule'

/** Shared shell so both rail cards (and the left rail's) look identical. */
export function RailCard({ title, children, footer }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
      <h2 className="border-b border-hairline px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
      {footer && (
        <div className="border-t border-hairline px-3 py-1.5 text-[10px] text-muted/60">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * "MATCHES" -- upcoming fixtures from Liquipedia, behind a FIXED five-day
 * strip (today-2 .. today+2), copied off rft.gg's own live markup: exactly
 * 5 buttons, centered, no scroll container, two-line month/day labels.
 *
 * The strip is a local segmented control rather than the shared StageTabs
 * because StageTabs opens on its LAST tab (it was written for tournament
 * stages, where the most advanced stage is the interesting one); here the
 * right default is always literally today.
 *
 * Times are rendered from each fixture's unix timestamp in the viewer's own
 * timezone -- see src/lib/schedule.js for why the scraper ships a timestamp
 * and never a pre-formatted date.
 */
export function UpcomingRail({ days, defaultDayKey, fetchedAt }) {
  // Tracks only an explicit user pick, resolving to defaultDayKey otherwise.
  // NOT `useState(defaultDayKey)`: this card first renders while the fixture
  // fetch is still in flight, so the initial value would be captured as null
  // and never revisited -- which showed up as the strip opening on yesterday
  // instead of today once the data landed.
  const [picked, setPicked] = useState(null)
  const active = picked ?? defaultDayKey

  const window_ = fiveDayWindow(days, new Date())
  const day = window_.find((d) => d.dateKey === active) ?? window_[2]

  return (
    <RailCard
      title="Matches"
      footer={fetchedAt ? `Schedule from Liquipedia · ${shortDate(fetchedAt.slice(0, 10))}` : null}
    >
      {/* rft.gg's own row: `flex justify-center space-x-0.5 pb-2`, exactly
          5 fixed buttons -- deliberately no overflow-x-auto here, since a
          fixed-length row can never need to scroll. */}
      <div className="flex justify-center gap-0.5 px-2 pt-2 pb-2">
        {window_.map((d) => {
          const on = d.dateKey === day.dateKey
          const { month, day: dayNum } = dayStripParts(d.date)
          return (
            <button
              key={d.dateKey}
              onClick={() => setPicked(d.dateKey)}
              className={`flex flex-col items-center gap-0 rounded-sm px-3 py-1 transition-colors ${
                on
                  ? 'border border-accent/16 bg-accent/12 font-bold text-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <span className="text-[8px] font-bold">{month}</span>
              <span className="text-xs font-medium">{dayNum}</span>
            </button>
          )
        })}
      </div>
      {day.matches.length === 0 ? (
        <p className="px-3 py-4 text-center text-[11px] text-muted">No matches this day.</p>
      ) : (
        <div>
          {day.matches.map((m) => (
            <RailMatch
              key={m.key}
              href={`/tournaments/${encodeURIComponent(m.event)}`}
              time={matchTime(m.timestamp)}
              format={m.bestOf ? `Bo${m.bestOf}` : null}
              live={isLive(m)}
              eventName={m.event}
              team1={m.team1}
              team2={m.team2}
              score1={m.score1}
              score2={m.score2}
            />
          ))}
        </div>
      )}
    </RailCard>
  )
}

/**
 * "RECENT RESULTS" -- straight off this site's own match data, which is
 * richer and more reliable than the Liquipedia feed for anything already
 * played. Rows open the match on vlr.gg, the same destination
 * MatchHistory.jsx sends people to since the site's own match pages were
 * removed.
 */
export function ResultsRail({ matches }) {
  if (!matches || matches.length === 0) return null
  return (
    <RailCard title="Recent results">
      <div>
        {matches.map((m) => (
          <RailMatch
            key={m.id}
            href={vlrMatchUrl(m.id)}
            external
            time={shortDate(m.date)}
            format={null}
            eventName={m.event}
            team1={m.team1}
            team2={m.team2}
            score1={m.s1}
            score2={m.s2}
          />
        ))}
      </div>
    </RailCard>
  )
}
