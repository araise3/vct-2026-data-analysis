import { Link } from 'react-router-dom'
import EventLogo from './EventLogo'
import Flag from './Flag'
import { eventLabel, dateRangeLabel, countdown, compact } from '../lib/format'

/**
 * One row of the Events list, mirroring rft.gg's own event row: a countdown
 * gutter, then logo + name + date range, then the Teams / Prize / Location
 * trio as value-over-label stacks.
 *
 * Two things deliberately differ from a literal copy of rft.gg's markup:
 *
 *  - Their hover is `hover:bg-muted/50`, which is WRONG against this
 *    codebase's tokens: rft.gg's `muted` is a surface colour, but here
 *    `muted` (#9b9c9e) is the *text* colour and `surface2` is the surface.
 *    Copying the class verbatim paints a light grey wash over the row.
 *  - Prize and Location collapse away below sm/md. They're the least
 *    important columns and the first things worth sacrificing when the
 *    centre column narrows -- which it does at `xl`, where the third rail
 *    appears and takes 220px back off it.
 *
 * A missing value renders an em dash rather than being hidden, so the
 * columns stay aligned down the list. Prize is genuinely absent for 8 of the
 * 16 events Liquipedia covers (it publishes no pool for Kickoff or Stage 1),
 * so this is the common case, not an edge case.
 */
export default function EventRow({ event }) {
  const cd = countdown(event.startDate, event.endDate)
  const isLive = event.status === 'live'

  return (
    <Link
      to={`/tournaments/${encodeURIComponent(event.name)}`}
      className="group flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface2/60"
    >
      <div className="hidden w-12 shrink-0 text-center sm:block">
        {cd && (
          <span
            className={`text-[11px] font-bold ${
              cd.tone === 'live' ? 'text-good' : 'text-muted'
            }`}
          >
            {cd.text}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <EventLogo event={event.name} size={28} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-[13px] font-semibold text-ink transition-colors group-hover:text-accent-bright">
              {eventLabel(event.name)}
            </span>
            {isLive && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" title="Running now" />
            )}
          </div>
          <div className="truncate text-[11px] text-muted">
            {dateRangeLabel(event.startDate, event.endDate) || 'Dates TBD'}
          </div>
        </div>
      </div>

      <Stat value={event.teamCount || null} label="Teams" className="w-10" />
      <Stat
        value={event.prizePoolUsd ? `$${compact(event.prizePoolUsd)}` : null}
        label="Prize"
        className="hidden w-16 sm:block"
      />
      <div className="hidden w-24 shrink-0 md:block">
        <div className="flex items-center justify-center gap-1.5">
          {event.countryCode && (
            <Flag countryCode={event.countryCode} countryName={event.country} size={11} />
          )}
          <span className="truncate text-[11px] text-ink">{event.city || '—'}</span>
        </div>
        <div className="text-center text-[10px] text-muted/70">Location</div>
      </div>
    </Link>
  )
}

function Stat({ value, label, className = '' }) {
  return (
    <div className={`shrink-0 text-center ${className}`}>
      <div className="text-[11px] text-ink">{value ?? '—'}</div>
      <div className="text-[10px] text-muted/70">{label}</div>
    </div>
  )
}
