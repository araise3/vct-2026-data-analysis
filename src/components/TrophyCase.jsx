import { resolveTrophyArt } from './TrophyArt'
import { eventLabel } from '../lib/format'

/**
 * A player's honours, laid out as an HLTV-style achievement bar: a compact
 * strip of trophy icons, each captioned with the two-digit year it was
 * won, preceded by a summary badge per marquee title.
 *
 * Every entry comes from trophies.js's playerTrophies, i.e. from real
 * Grand Final results joined against the player's own buckets -- nothing
 * here is hand-maintained, and a re-export picks up new titles on its own.
 * Renders nothing at all for a player with no titles, rather than leaving
 * an empty frame in the header.
 */

// Stages that earn their own summary badge. Regional league/stage titles
// deliberately don't -- a player with eight of them would push the real
// headline (an international title) off the row entirely.
const BADGED = [
  { stage: 'Champions', label: 'Champion', tone: 'bg-mid/20 text-mid border-mid/40' },
  { stage: 'Masters', label: 'Masters', tone: 'bg-accent/15 text-accent-bright border-accent/35' },
  { stage: 'LOCK//IN', label: 'LOCK//IN', tone: 'bg-good/15 text-good border-good/35' },
]

function summarize(trophies) {
  return BADGED.map(({ stage, label, tone }) => {
    const n = trophies.filter((t) => t.stage === stage).length
    return n ? { key: stage, text: `${n}× ${label}`, tone } : null
  }).filter(Boolean)
}

export default function TrophyCase({ trophies, size = 38 }) {
  if (!trophies.length) return null
  const badges = summarize(trophies)

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {badges.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {badges.map((b) => (
            <span
              key={b.key}
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-2xl border ${b.tone}`}
            >
              {b.text}
            </span>
          ))}
        </div>
      )}

      {/* w-fit so a player with two titles gets a bar that hugs them
          rather than an mostly-empty full-width strip; max-w-full plus
          horizontal scroll keeps a long career from widening the card. */}
      <div className="flex items-stretch gap-px rounded-2xl border border-hairline bg-surface2/40 px-1.5 py-1 w-fit max-w-full overflow-x-auto">
        {trophies.map((t) => {
          const { Component, props, exact } = resolveTrophyArt(t)
          const year = String(t.year ?? '').slice(-2)
          return (
            <div
              key={t.eventId}
              // The generic regional icon is a stand-in (see TrophyArt.jsx),
              // so it says so on hover rather than passing itself off as a
              // drawing of that event's actual trophy.
              title={`${eventLabel(t.eventName)} — winner${exact ? '' : ' (representative trophy art)'}`}
              className="flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-xl hover:bg-surface2 transition-colors shrink-0"
            >
              <Component uid={`t${t.eventId}`} size={size} {...props} />
              {year && (
                <span className="text-[9px] leading-none text-muted tabular-nums">'{year}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
