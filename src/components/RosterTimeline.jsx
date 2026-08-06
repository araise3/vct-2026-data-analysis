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

// Per-PLAYER color, not per-column -- a column is a seat succession
// chain, not a fixed identity, so tying color to column index made the
// same color mean a different person team to team (and row-run to
// row-run within one team). Hashing the player's own handle instead
// gives every player a fixed, consistent color wherever they appear on
// this table. A simple string hash -> hue keeps this deterministic
// (same player always renders the same color, including across reloads)
// rather than truly random, which would repaint on every render and
// make color meaningless as an identity cue. Saturation/lightness are
// fixed so every hue stays legible under the white label text this site
// already uses on colored cells; only the hue varies per player.
function hashHue(name) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

function playerColor(name) {
  return `hsl(${hashHue(name)}, 65%, 42%)`
}

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

// Row height for a single (non-spanned) event row -- only needed as an
// explicit PIXEL value for the split-seat case below, where two occupants
// must divide one row proportionally. A percentage height only resolves
// against a DEFINITE ancestor height, and a <td>'s own height is "auto"
// (derived from its content), so nesting percentage-height children
// directly under it silently computes to 0 -- fine by coincidence for a
// single full-color occupant (nothing to divide), but exactly what broke
// the split case until this was pinned to a real pixel value.
const ROW_HEIGHT = 36

function SeatCell({ seat }) {
  if (!seat) return null

  if (seat.occupants.length === 1) {
    const o = seat.occupants[0]
    // Background lives on the <td> itself (see the caller), not here --
    // a <td>'s background always covers its full rendered box, including
    // every row a rowSpan merges in, which is exactly the property a
    // percentage-height child can't reliably reproduce (see the multi-
    // event bug this replaced: a 16-event tenure rendered as one row's
    // worth of color with the remaining 15 rows visually blank, even
    // though the rowSpan attribute itself was already correct). This
    // element only needs to center the label -- vertical-align on the
    // <td> (native table layout, not a flex/percentage hack) does that
    // correctly across however many rows are spanned.
    return (
      <Link
        to={`/players/${encodeURIComponent(o.player)}`}
        className="flex items-center justify-center text-ink text-[11px] font-semibold truncate px-1.5 py-1.5 hover:brightness-110 transition-[filter]"
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
  // 50/50 split). Always a single (rowSpan=1) row -- see computeSpans --
  // so a fixed-pixel wrapper height is safe and gives the percentage
  // children below a real number to resolve against.
  const total = seat.occupants.reduce((s, o) => s + o.maps, 0)
  return (
    <div className="flex flex-col" style={{ height: ROW_HEIGHT }}>
      {seat.occupants.map((o) => (
        <Link
          key={o.player}
          to={`/players/${encodeURIComponent(o.player)}`}
          className="flex items-center justify-center text-ink text-[9px] font-semibold truncate px-1 hover:brightness-110 transition-[filter]"
          style={{ background: playerColor(o.player), height: `${(o.maps / total) * 100}%` }}
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
                // Background goes on the <td> itself for a single-occupant
                // seat -- see SeatCell's own comment for why that's the
                // part of this that actually had to change. A split seat
                // colors its own two sub-divs instead (each occupant gets
                // its own player color), and an empty seat gets a plain
                // placeholder fill rather than the table's bare background
                // showing through unstyled.
                const bg = !seat
                  ? undefined
                  : seat.occupants.length === 1
                    ? playerColor(seat.occupants[0].player)
                    : undefined
                return (
                  <td
                    key={c}
                    rowSpan={cell.span}
                    className={`p-0 align-middle border-b border-hairline/60 border-l border-hairline/30 ${!seat ? 'bg-surface2/40' : ''}`}
                    style={bg ? { background: bg } : undefined}
                  >
                    <SeatCell seat={seat} />
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
