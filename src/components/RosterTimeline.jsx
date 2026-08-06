import { Link } from 'react-router-dom'
import { buildRosterEventTable } from '../lib/rosterTimeline'
import { eventLabel } from '../lib/format'

/**
 * Event-based "who held which seat" roster table -- replaces the earlier
 * calendar Gantt chart entirely, per direct request. One row per event
 * this team has data for (chronological), one column per starting seat.
 * A seat is a succession chain (see rosterTimeline.js's own docstring for
 * the full column-assignment rule), not a fixed role or a single
 * player's own lane -- a departed starter's column is simply inherited by
 * whoever takes over that seat next.
 *
 * Coaches are deliberately out of scope for this view (dropped along with
 * the old chart, which used to plot players and coaches on the same
 * axis) -- this component only ever receives player_buckets data, which
 * has no coach rows in it at all, so there was nothing to filter here.
 *
 * Consecutive events where one column's PRIMARY occupant didn't change
 * are merged into a single spanning cell (via a plain HTML `rowSpan`,
 * computed in computeSpans below) so a multi-event tenure reads as one
 * continuous block, matching the reference layout this was modelled on.
 * A row where a seat was split mid-event (two occupants -- see
 * buildEventSeats in rosterTimeline.js) is never merged into a
 * neighboring span, on either side: it's a one-event anomaly, not the
 * start or continuation of a stable run.
 */

const SEAT_COLORS = ['#22D3EE', '#E040FB', '#A78BFA', '#FB923C', '#FDE047']

function computeSpans(rows, numSeats) {
  const grid = rows.map(() => new Array(numSeats).fill(null))
  for (let c = 0; c < numSeats; c++) {
    let i = 0
    while (i < rows.length) {
      const seat = rows[i].seats[c]
      const isSplit = seat && seat.occupants.length > 1
      if (!seat || isSplit) {
        grid[i][c] = { span: 1, skip: false }
        i += 1
        continue
      }
      let j = i + 1
      while (j < rows.length) {
        const next = rows[j].seats[c]
        if (!next || next.occupants.length > 1 || next.primary !== seat.primary) break
        j += 1
      }
      grid[i][c] = { span: j - i, skip: false }
      for (let k = i + 1; k < j; k += 1) grid[k][c] = { span: 0, skip: true }
      i = j
    }
  }
  return grid
}

function SeatCell({ seat, color }) {
  if (!seat) return <div className="h-9 bg-surface2/40" />

  if (seat.occupants.length === 1) {
    const o = seat.occupants[0]
    return (
      <Link
        to={`/players/${encodeURIComponent(o.player)}`}
        className="flex items-center justify-center h-full min-h-9 text-ink text-[11px] font-semibold truncate px-1.5 py-1 hover:brightness-110 transition-[filter]"
        style={{ background: color }}
        title={`${o.player} — ${o.maps} map${o.maps === 1 ? '' : 's'}`}
      >
        {o.player}
      </Link>
    )
  }

  // Mid-event seat split -- stack occupants, each sized to its own share
  // of the seat's total maps played that event (direct instruction: "give
  // the column half of the row ... depending on how many matches they
  // played", i.e. proportional height within this one row, not a fixed
  // 50/50 split).
  const total = seat.occupants.reduce((s, o) => s + o.maps, 0)
  return (
    <div className="flex flex-col h-full min-h-9">
      {seat.occupants.map((o, i) => (
        <Link
          key={o.player}
          to={`/players/${encodeURIComponent(o.player)}`}
          className="flex items-center justify-center text-ink text-[9px] font-semibold truncate px-1 hover:brightness-110 transition-[filter]"
          style={{ background: color, opacity: i === 0 ? 1 : 0.65, height: `${(o.maps / total) * 100}%` }}
          title={`${o.player} — ${o.maps} map${o.maps === 1 ? '' : 's'} this event`}
        >
          {o.player}
        </Link>
      ))}
    </div>
  )
}

export default function RosterTimeline({ playerBuckets, team, matchResultsRows }) {
  const rows = buildRosterEventTable(playerBuckets, team, matchResultsRows)

  if (rows.length === 0) {
    return <p className="text-muted text-sm">Not enough roster history to plot a timeline.</p>
  }

  const numSeats = rows[0].seats.length
  const spans = computeSpans(rows, numSeats)

  return (
    <div className="bg-surface border border-hairline rounded-2xl overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.eventId}>
              <td className="pr-3 pl-4 py-1.5 text-right text-muted whitespace-nowrap align-middle border-b border-hairline/60">
                {eventLabel(row.event?.name)}
              </td>
              {row.seats.map((seat, c) => {
                const cell = spans[i][c]
                if (cell.skip) return null
                return (
                  <td
                    key={c}
                    rowSpan={cell.span}
                    className="p-0 align-middle border-b border-hairline/60 border-l border-hairline/30"
                  >
                    <SeatCell seat={seat} color={SEAT_COLORS[c % SEAT_COLORS.length]} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
