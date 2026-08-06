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

// Height of one occupant's own slot within a split cell -- every occupant
// gets this same fixed height regardless of how many maps they played
// that event, per direct instruction ("drop the how many maps played =
// height logic"): the earlier proportional-to-maps split squeezed a
// lopsided share (e.g. a 1-map stand-in against a 15-map incumbent) down
// to an illegibly thin sliver, even though the whole point of showing the
// split at all is to make that stand-in's name readable.
const ROW_HEIGHT = 36

// A row's rendered height needs to grow to fit whichever of its seats has
// the most occupants that event (a row can be split in more than one
// column at once), not just this one column's own occupant count --
// table rows share one height across every cell in the row regardless of
// column, so this has to be computed globally, once, up front.
function computeRowHeights(rows) {
  return rows.map((row) => {
    const maxOccupants = row.seats.reduce((m, s) => Math.max(m, s ? s.occupants.length : 1), 1)
    return maxOccupants * ROW_HEIGHT
  })
}

function SeatCell({ seat, colors, height }) {
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

  // Mid-event seat split -- stack occupants, each given the same fixed
  // ROW_HEIGHT slot (see above) rather than a maps-proportional share,
  // ordered top-to-bottom by who actually played first (see
  // buildEventSeats in rosterTimeline.js -- this is the chronology fix).
  // Same text size and bordered-stripe treatment as BlockSeatCell's split
  // regions below -- these used to render smaller (9px, no border) back
  // when they were squeezed into a fraction of one row; now that a split
  // gets a full ROW_HEIGHT slot per occupant, there's no reason for it to
  // read any different from a normal single-occupant cell. `height` (from
  // computeRowHeights) is this row's actual rendered height, which can
  // exceed occupants.length * ROW_HEIGHT when some OTHER column is split
  // further in this same event row -- justify-center absorbs that slack
  // instead of stretching individual occupant rows.
  //
  // Only a border-BOTTOM between consecutive occupants, not border-y on
  // every one of them -- giving each its own top+bottom doubled up at
  // every internal seam (two occupants' borders stacked back to back read
  // as one visibly thicker line, user-reported on Natus Vincere's
  // Kolosha/ComeBack pair) AND was redundant at the two outer edges, which
  // are already bordered by the surrounding <td>s' own border-b (this cell
  // sits in a `border-separate` table, so adjacent cell borders already
  // touch with no gap).
  return (
    <div className="flex flex-col justify-center" style={{ height }}>
      {seat.occupants.map((o, i) => (
        <Link
          key={o.player}
          to={`/players/${encodeURIComponent(o.player)}`}
          className={`flex items-center justify-center text-ink text-[11px] font-semibold truncate px-1.5 hover:brightness-110 transition-[filter] shrink-0${i < seat.occupants.length - 1 ? ' border-b border-hairline/60' : ''}`}
          style={{ background: colors.get(o.player), height: ROW_HEIGHT }}
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
 * rather than a clean event-to-event boundary.
 *
 * Built around VISUALLY CONTIGUOUS COLOUR REGIONS, which is the unit the
 * eye actually reads here -- not table rows, and not "runs of un-split
 * rows". Two earlier attempts both got the label placement wrong by
 * grouping on the wrong thing:
 *   - One label for the whole span: a ~750px column showed its single name
 *     dead center, leaving most of the colour anonymous.
 *   - One label per run of SOLID (single-occupant) rows, with the primary's
 *     own slice of a split row left as unlabeled filler: the filler slice is
 *     the same colour as the solid run touching it, so the eye sees ONE
 *     stripe while the label was centered on only the solid part of it.
 *     User-reported and directly visible on Team Liquid: below the GSR notch
 *     the yellow is 72px tall (nAts's half of the split row + the final
 *     event row) but "nAts" was centered in only that last 36px row, so it
 *     sat flush against the bottom edge; the middle stripe was off by half
 *     a row the same way.
 *
 * So the span is first flattened into vertical SLOTS in visual top-to-bottom
 * order (a solid row contributes one primary-owned slot of that row's full
 * height; a split row contributes one ROW_HEIGHT slot per occupant, walked
 * in `occupants` order so the chronological stacking from buildEventSeats is
 * preserved -- the previous code always drew the non-primary occupant on top
 * regardless of who actually played first). Consecutive slots owned by the
 * same player then merge into one region, and each region renders as exactly
 * ONE box with ONE centered label. That makes label placement correct by
 * construction: a region IS the contiguous block of colour, so centering in
 * it is centering in what the user sees.
 *
 * A split row that is taller than its own occupant count (because a DIFFERENT
 * column split further in that same event row -- see computeRowHeights) hands
 * the leftover height to the primary's slot rather than leaving a gap, so the
 * extra space stays part of the primary's contiguous region instead of
 * breaking it in two.
 */
function BlockSeatCell({ blockSeats, primary, colors, rowHeights, startIndex }) {
  const slots = []
  blockSeats.forEach((seat, idx) => {
    const rowHeight = rowHeights[startIndex + idx]
    if (seat.occupants.length === 1) {
      slots.push({ player: primary, height: rowHeight, maps: seat.occupants[0].maps, split: false })
      return
    }
    const otherCount = seat.occupants.filter((o) => o.player !== primary).length
    for (const o of seat.occupants) {
      const isPrimary = o.player === primary
      slots.push({
        player: o.player,
        // The primary absorbs whatever the row has beyond one slot per
        // non-primary occupant (normally just its own ROW_HEIGHT).
        height: isPrimary ? rowHeight - otherCount * ROW_HEIGHT : ROW_HEIGHT,
        maps: o.maps,
        split: !isPrimary,
      })
    }
  })

  const regions = []
  for (const s of slots) {
    const last = regions[regions.length - 1]
    if (last && last.player === s.player) {
      last.height += s.height
      last.maps += s.maps
    } else {
      regions.push({ ...s })
    }
  }

  return (
    <div className="flex flex-col">
      {regions.map((r, ri) => {
        // Each split region borders itself top+bottom to separate it from a
        // solid primary stripe -- but two split regions can sit directly
        // back to back (e.g. Kolosha then ComeBack, no solid row between
        // them), and giving BOTH their own full border-y stacks one
        // region's bottom edge directly against the next one's top edge,
        // rendering as a visibly thicker (doubled) line at exactly that one
        // seam. Only draw the side that actually faces a non-split (or
        // absent) neighbor, so any two adjacent split regions share a
        // single hairline instead of each contributing their own.
        const prev = regions[ri - 1]
        const next = regions[ri + 1]
        const borderTop = r.split && !prev?.split
        const borderBottom = r.split && !next?.split
        return (
          <Link
            key={ri}
            to={`/players/${encodeURIComponent(r.player)}`}
            // Only a non-primary notch needs its own background and border --
            // the primary's regions sit on the <td>'s own background (see the
            // caller) and are separated from each other by those notches.
            className={`flex items-center justify-center text-ink text-[11px] font-semibold truncate px-1.5 hover:brightness-110 transition-[filter] shrink-0${r.split ? ` border-hairline/60${borderTop ? ' border-t' : ''}${borderBottom ? ' border-b' : ''}` : ''}`}
            style={{ height: r.height, background: r.split ? colors.get(r.player) : undefined }}
            title={`${r.player} — ${r.maps} map${r.maps === 1 ? '' : 's'}`}
          >
            {r.player}
          </Link>
        )
      })}
    </div>
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
  const rowHeights = computeRowHeights(rows)

  return (
    <div className="bg-surface border border-hairline rounded-2xl overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs" style={{ tableLayout: 'fixed' }}>
        {/* table-layout:fixed + an explicit per-seat <col> width is what makes every seat
            column a fixed 131px regardless of occupant name length. The label <col> is the
            ONE column left without a width, so with `w-full` on the table it's the one that
            absorbs whatever space the container has beyond 5*131px for the seat grid --
            direct instruction: push the table flush against the right edge and give the
            leftover room to the event-name column, rather than leaving it as blank space to
            the table's right (which is what a fixed-total-width table narrower than its
            container would otherwise do, sitting flush left by default). */}
        <colgroup>
          <col />
          {Array.from({ length: numSeats }).map((_, idx) => (
            <col key={idx} style={{ width: 131 }} />
          ))}
        </colgroup>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.eventId}>
              {/* This cell is never consumed by a rowSpan (fresh every row), which is
                  exactly why it's the one place an explicit height reliably drives this
                  <tr>'s real rendered height -- a rowSpan'd seat cell further right can
                  span OVER a split row without ever placing a cell directly in it, so
                  setting height there wouldn't grow that specific row at all. Forcing it
                  here keeps every row's actual height in sync with `rowHeights`, which
                  BlockSeatCell's own per-stripe box heights are summed from. */}
              <td
                className="pr-3 pl-4 py-1.5 text-right text-muted whitespace-nowrap align-middle border-b border-hairline/60"
                style={{ height: rowHeights[i] }}
              >
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
                    className={`p-0 align-middle border-b border-hairline/60 border-l border-hairline/30 ${!seat ? 'bg-surface2/40' : ''}`}
                    style={bg ? { background: bg } : undefined}
                  >
                    {hasEmbeddedSplit
                      ? <BlockSeatCell blockSeats={blockSeats} primary={seat.primary} colors={colors} rowHeights={rowHeights} startIndex={i} />
                      : <SeatCell seat={seat} colors={colors} height={rowHeights[i]} />}
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
