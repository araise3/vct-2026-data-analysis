import { Link } from 'react-router-dom'
import EventLogo from './EventLogo'
import { RailCard } from './MatchRail'
import { eventLabel, countdown } from '../lib/format'

/**
 * The left rail's "EVENTS" card -- rft.gg's own top-left panel, where each
 * row is a circuit with a countdown badge ("now" / "in 46d").
 *
 * rft.gg lists LEAGUES (LCK, LPL, LEC...) because its circuits are
 * long-running seasons. VCT's equivalent unit is the per-region split, so
 * rows are this season's events, ordered live -> upcoming -> most recently
 * finished (see currentCircuits in src/lib/eventMeta.js). That ordering is
 * the point of the card: whatever is running now sits at the top.
 */
export default function CircuitList({ circuits }) {
  if (!circuits || circuits.length === 0) return null

  return (
    <RailCard title="Events">
      <div>
        {circuits.map((e) => {
          const cd = countdown(e.startDate, e.endDate)
          return (
            <Link
              key={e.name}
              to={`/tournaments/${encodeURIComponent(e.name)}`}
              className="flex items-center gap-2 border-b border-hairline/40 px-3 py-1.5 transition-colors last:border-b-0 hover:bg-surface2/60"
            >
              <EventLogo event={e.name} size={18} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                {eventLabel(e.name)}
              </span>
              {cd && (
                <span
                  className={`shrink-0 text-[10px] font-bold ${
                    cd.tone === 'live' ? 'text-good' : 'text-muted/70'
                  }`}
                >
                  {cd.text}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </RailCard>
  )
}
