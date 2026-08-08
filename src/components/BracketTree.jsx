/**
 * Hand-rolled bracket tree (no charting/bracket library exists anywhere in
 * this codebase -- matches the established "hand-rolled inline SVG/CSS"
 * convention RadarChart.jsx/RosterTimeline.jsx already use). Renders one
 * of tournament_structure.json's `brackets.playIns`/`brackets.playoffs`
 * skeletons: a flat `{round, match, opponent1, opponent2}` list, grouped
 * into CSS-flex columns per round.
 *
 * Opponent slots show Liquipedia's own literal seed placeholder text
 * ("Alpha #3", "Play-Ins #1-2") or "TBD" for an empty slot -- resolving a
 * slot to the REAL team once known (from this site's own completed
 * match_results.json rows) is deliberately out of scope for this pass, see
 * TournamentDetail.jsx's own comment on why.
 */
export default function BracketTree({ title, rounds }) {
  if (!rounds || rounds.length === 0) return null

  const byRound = new Map()
  for (const m of rounds) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round).push(m)
  }
  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-2">
      {title && <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {roundNumbers.map((rn) => (
          <div key={rn} className="flex flex-col gap-3 min-w-[180px] shrink-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted text-center">
              Round {rn}
            </div>
            <div className="flex flex-col gap-3 justify-around flex-1">
              {byRound.get(rn).map((m) => (
                <div
                  key={m.match}
                  className="bg-surface border border-hairline rounded-lg overflow-hidden text-xs"
                >
                  <BracketSlot label={m.opponent1} />
                  <div className="border-t border-hairline" />
                  <BracketSlot label={m.opponent2} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BracketSlot({ label }) {
  return (
    <div className={`px-2.5 py-1.5 truncate ${label ? 'text-ink' : 'text-muted/60 italic'}`}>
      {label || 'TBD'}
    </div>
  )
}
