import RailMatch from './RailMatch'
import { shortDate, vlrMatchUrl } from '../lib/format'

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
      <div className="flex flex-col gap-1.5 p-2">
        {matches.map((m) => (
          <RailMatch
            key={m.id}
            href={vlrMatchUrl(m.id)}
            external
            time={shortDate(m.date)}
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
