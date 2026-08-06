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
 * buildEventSeats in rosterTimeline.js) merges into a neighboring run on
 * either side too, as long as the PRIMARY occupant matches -- e.g. a
 * player who takes over mid-event and then holds the seat through the
 * following events reads as one continuous block with a small notch for
 * the outgoing player, not as two separate back-to-back entries for the
 * same name (see BlockSeatCell below; this was a real user-reported bug).
 * A split row only stays isolated (its own one-row cell, the original
 * proportional two-occupant layout) when its primary doesn't match
 * either neighbor -- a genuine one-event anomaly.
 */

// Per-PLAYER color, not per-column -- a column is a seat succession
// chain, not a fixed identity, so tying color to column index made the
// same color mean a different person team to team (and row-run to
// row-run within one team).
//
// Colors only need to be distinct WITHIN one team's table -- a color NRG
// uses is free to also appear on FNATIC's page, nobody compares the two
// side by side. A per-player hash (tried first) doesn't guarantee that:
// two unrelated players can hash to the same or a visually-close hue
// purely by coincidence (confirmed live -- crashies/mada and skuba/brawk
// landed on near-identical colors on the same NRG table). Evenly
// spacing hues across exactly this team's own distinct-player count
// fixed that specific collision, but introduced a subtler version of the
// same problem: naive linear spacing (i/n * 360) puts CONSECUTIVE roster
// arrivals at NUMERICALLY adjacent hues too, and two hues barely 20-30
// apart can still read as near-identical to the eye -- confirmed live
// again, this time by the user (Verno and mada, two players who joined
// close together in NRG's own history, landed at 222 and 249 degrees,
// both squarely in the blue/purple band where human hue discrimination
// is already weaker than elsewhere on the wheel).
//
// Fixed with the golden-angle technique (~137.508 degrees per step) used
// wherever a sequence of items needs no-two-ever-cluster spacing around
// a circle (phyllotaxis/sunflower-seed spacing is the classic example) --
// unlike i/n spacing, consecutive indices land far apart, so roster
// neighbors in TIME are no longer roster neighbors in HUE. Verified
// directly (a small script against realistic team sizes) that this holds
// up as team size grows: minimum pairwise hue gap is ~52 degrees at 5
// players, ~20 at 13 (NRG's real count), narrowing to ~7 at FURIA's real
// 32-player historical max -- tight enough at that extreme that hue
// alone stops being reliable, hence the lightness alternation below
// giving every other player a brightness offset too, so two players that
// do end up hue-close still separate on a second visual channel.
const GOLDEN_ANGLE = 137.508

function buildPlayerColors(rows) {
  const order = []
  const seen = new Set()
  for (const row of rows) {
    for (const seat of row.seats) {
      if (!seat) continue
      for (const o of seat.occupants) {
        if (!seen.has(o.player)) {
          seen.add(o.player)
          order.push(o.player)
        }
      }
    }
  }
  const colors = new Map()
  order.forEach((player, i) => {
    const hue = Math.round((i * GOLDEN_ANGLE) % 360)
    const lightness = i % 2 === 0 ? 40 : 50
    colors.set(player, `hsl(${hue}, 65%, ${lightness}%)`)
  })
  return colors
}

// Merges purely on PRIMARY equality between consecutive rows -- a split
// row (two occupants) is no longer a forced break. This is what lets a
// hand-off event (e.g. a split seat where the incoming player already
// has more maps that event, becoming primary) merge forward into that
// player's following solid-tenure rows, instead of printing their name
// once inside the split cell and then AGAIN as a new run right below it
// for what is really one continuous stretch. A span this produces may
// therefore contain zero, one, or more embedded split rows anywhere in
// it -- the renderer (see hasEmbeddedSplit / BlockSeatCell below) handles
// that by overlaying the non-primary occupant's slice on top of the
// primary's own background rather than assuming every row in a span is
// single-occupant.
function computeSpans(rows, numSeats) {
  const grid = rows.map(() => new Array(numSeats).fill(null))
  for (let c = 0; c < numSeats; c++) {
    let i = 0
    while (i < rows.length) {
      const seat = rows[i].seats[c]
      if (!seat) {
        grid[i][c] = { span: 1, skip: false }
        i += 1
        continue
      }
      let j = i + 1
      while (j < rows.length) {
        const next = rows[j].seats[c]
        if (!next || next.primary !== seat.primary) break
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

function SeatCell({ seat, colors }) {
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
  // 50/50 split), ordered top-to-bottom by who actually played first (see
  // buildEventSeats in rosterTimeline.js -- this is the chronology fix).
  // Always a single (rowSpan=1) row -- see computeSpans -- so a
  // fixed-pixel wrapper height is safe and gives the percentage children
  // below a real number to resolve against.
  const total = seat.occupants.reduce((s, o) => s + o.maps, 0)
  return (
    <div className="flex flex-col" style={{ height: ROW_HEIGHT }}>
      {seat.occupants.map((o) => (
        <Link
          key={o.player}
          to={`/players/${encodeURIComponent(o.player)}`}
          className="flex items-center justify-center text-ink text-[9px] font-semibold truncate px-1 hover:brightness-110 transition-[filter]"
          style={{ background: colors.get(o.player), height: `${(o.maps / total) * 100}%` }}
          title={`${o.player} — ${o.maps} map${o.maps === 1 ? '' : 's'} this event`}
        >
          {o.player}
        </Link>
      ))}
    </div>
  )
}

/**
 * Renders a merged span (multiple rows, one shared `primary`) that has one
 * or more embedded split rows inside it -- i.e. the primary took over (or
 * handed off) mid-event at some point within an otherwise-continuous run,
 * rather than a clean event-to-event boundary. Used instead of the plain
 * per-row SeatCell above specifically to avoid printing the SAME primary's
 * name twice back-to-back: once inside the split row, once more as the
 * start of what the old logic treated as a brand-new run right below it.
 *
 * `primary`'s name/background covers the WHOLE span (same as a plain
 * multi-event tenure) since it's genuinely one continuous identity; each
 * embedded split row's non-primary occupant is drawn as a small strip
 * absolutely positioned at that row's own slice of the span (top offset
 * `rowIndex * ROW_HEIGHT`, sized by their share of maps in that one row --
 * same proportional-height math SeatCell's own split branch uses, just
 * pixel-based here since the span's total height is already known exactly
 * from its row count, rather than needing a percentage of an ambiguous
 * parent height).
 *
 * Absolute positioning (not a fixed-height wrapper div) is deliberate: the
 * <td> itself doesn't need an explicit height for this to work -- `top`/
 * `height` in pixels resolve against the nearest positioned ancestor
 * regardless of that ancestor's own height, and the <td>'s rendered box is
 * already the right size via native `rowSpan` table layout (the same
 * mechanism the plain multi-event tenure path already relies on). This
 * keeps the primary's own label using the exact same "TD background +
 * vertical-align middle" centering as every other multi-row cell, with the
 * strips simply painted on top (later in DOM order = on top by default
 * stacking, no z-index needed).
 */
function BlockSeatCell({ blockSeats, primary, colors }) {
  const primaryMaps = blockSeats.reduce((sum, seat) => {
    if (!seat) return sum
    const occ = seat.occupants.find((o) => o.player === primary)
    return sum + (occ ? occ.maps : 0)
  }, 0)

  const strips = []
  blockSeats.forEach((seat, idx) => {
    if (!seat || seat.occupants.length <= 1) return
    const rowTop = idx * ROW_HEIGHT
    const totalRowMaps = seat.occupants.reduce((s, o) => s + o.maps, 0)
    let offset = 0
    for (const o of seat.occupants) {
      const h = (o.maps / totalRowMaps) * ROW_HEIGHT
      if (o.player !== primary) {
        strips.push({ key: `${idx}-${o.player}`, top: rowTop + offset, height: h, player: o.player, maps: o.maps })
      }
      offset += h
    }
  })

  return (
    <>
      <Link
        to={`/players/${encodeURIComponent(primary)}`}
        className="flex items-center justify-center text-ink text-[11px] font-semibold truncate px-1.5 py-1.5 hover:brightness-110 transition-[filter]"
        title={`${primary} — ${primaryMaps} map${primaryMaps === 1 ? '' : 's'}`}
      >
        {primary}
      </Link>
      {strips.map((s) => (
        <Link
          key={s.key}
          to={`/players/${encodeURIComponent(s.player)}`}
          className="absolute left-0 right-0 flex items-center justify-center text-ink text-[9px] font-semibold truncate px-1 hover:brightness-110 transition-[filter]"
          style={{ top: s.top, height: s.height, background: colors.get(s.player) }}
          title={`${s.player} — ${s.maps} map${s.maps === 1 ? '' : 's'} this event`}
        >
          {s.player}
        </Link>
      ))}
    </>
  )
}

export default function RosterTimeline({ playerBuckets, team, matchResultsRows, matchPlayersRows }) {
  const rows = buildRosterEventTable(playerBuckets, team, matchResultsRows, matchPlayersRows)

  if (rows.length === 0) {
    return <p className="text-muted text-sm">Not enough roster history to plot a timeline.</p>
  }

  const numSeats = rows[0].seats.length
  const spans = computeSpans(rows, numSeats)
  const colors = buildPlayerColors(rows)

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
                const span = cell.span
                // An ISOLATED split row (one event, span 1, no matching
                // neighbor to merge with) still colors its own two
                // sub-divs via SeatCell rather than the <td> -- there's no
                // single "whole span" identity yet to hand the <td>. Any
                // span > 1 has one (its shared `primary`, on every row in
                // the run by construction -- see computeSpans), even when
                // one of those rows happens to be split; BlockSeatCell
                // handles that case, painting the primary across the
                // whole span with the split row's other occupant overlaid
                // as a small strip (see its own comment for why).
                const isIsolatedSplit = span === 1 && seat && seat.occupants.length > 1
                const blockSeats = span > 1 ? rows.slice(i, i + span).map((r) => r.seats[c]) : null
                const hasEmbeddedSplit = blockSeats ? blockSeats.some((s) => s && s.occupants.length > 1) : false
                // Background goes on the <td> itself for anything with a
                // single whole-span identity (plain tenure OR a merged
                // span with an embedded split) -- see SeatCell's own
                // comment for why that's the part of this that actually
                // had to change. An empty seat gets a plain placeholder
                // fill rather than the table's bare background showing
                // through unstyled.
                const bg = !seat ? undefined : isIsolatedSplit ? undefined : colors.get(seat.primary)
                return (
                  <td
                    key={c}
                    rowSpan={span}
                    className={`p-0 align-middle border-b border-hairline/60 border-l border-hairline/30 ${!seat ? 'bg-surface2/40' : ''} ${hasEmbeddedSplit ? 'relative' : ''}`}
                    style={bg ? { background: bg } : undefined}
                  >
                    {hasEmbeddedSplit
                      ? <BlockSeatCell blockSeats={blockSeats} primary={seat.primary} colors={colors} />
                      : <SeatCell seat={seat} colors={colors} />}
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
