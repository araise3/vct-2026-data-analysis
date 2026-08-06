import { useMemo } from 'react'
import TeamLogo from './TeamLogo'
import { rating as fmtRating, vlrMatchUrl } from '../lib/format'

/**
 * Per-match performance bars -- the analogue of rft.gg's "Performances"
 * panel, where every match in scope is one bar whose height and colour
 * encode how the player actually played that series.
 *
 * This is deliberately NOT the same thing as the rating-over-time line
 * chart further down the profile. That chart plots one point per match
 * DAY (rounds-weighted within the day) to show a trend; this shows one
 * bar per MATCH, in order, with the opponent attached -- the question it
 * answers is "who did they do that against", which a date-axis trend line
 * can't show.
 */

// Rating 2.0 range the bars are drawn against. Ratings genuinely outside
// this get clamped rather than rescaling the whole strip, so bar heights
// stay comparable between two players' profiles instead of each being
// normalised to its own best game.
const MIN_RATING = 0.4
const MAX_RATING = 1.8
const BASELINE = 1.0

// A long career/season can run to 50+ matches, at which point each bar
// gets too thin to read (and the row just keeps growing sideways). Capped
// to the most recent MAX_BARS instead of shrinking bars indefinitely --
// recent form is the more useful default view, with a note (below) when
// something's actually been trimmed off.
const MAX_BARS = 30

function toneFor(r) {
  if (r == null) return 'bg-surface2'
  if (r >= 1.15) return 'bg-good'
  if (r >= 0.95) return 'bg-mid'
  return 'bg-bad'
}

function heightPct(r) {
  if (r == null) return 0
  const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, r))
  return ((clamped - MIN_RATING) / (MAX_RATING - MIN_RATING)) * 100
}

export default function PerformanceStrip({ matches, playersByMatch, playerName }) {
  // Oldest -> newest, left to right, so the strip reads like a timeline.
  // Trimmed to the most recent MAX_BARS afterward (slice(-MAX_BARS)) --
  // AFTER sorting, so "most recent" is by actual match date, not however
  // `matches` happened to be ordered coming in.
  const { bars, totalCount } = useMemo(() => {
    const out = []
    const ordered = [...matches].sort(
      (a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id
    )
    for (const m of ordered) {
      const scoreboard = playersByMatch?.get(m.id) || []
      const mine = scoreboard.find((r) => r.p === playerName)
      if (!mine) continue
      // The player's own team on THIS match, from their scoreboard row --
      // not a fixed meta.team, which would flip the opponent on every
      // match played before a mid-season transfer.
      const isTeam1 = m.team1 === mine.t
      const opponent = isTeam1 ? m.team2 : m.team1
      const myScore = isTeam1 ? m.s1 : m.s2
      const oppScore = isTeam1 ? m.s2 : m.s1
      out.push({
        id: m.id,
        date: m.date,
        opponent,
        won: myScore === oppScore ? null : myScore > oppScore,
        score: `${myScore}–${oppScore}`,
        r: mine.r ?? null,
        k: mine.k, d: mine.d, a: mine.a,
      })
    }
    const totalCount = out.length
    return { bars: totalCount > MAX_BARS ? out.slice(-MAX_BARS) : out, totalCount }
  }, [matches, playersByMatch, playerName])

  if (!bars.length) {
    return <p className="text-muted text-sm px-1">No matches in this scope.</p>
  }

  // The 1.00 baseline sits at whatever fraction of the plot height a
  // rating of exactly 1.0 falls on, so the dashed line and the bars are
  // drawn against the identical scale.
  const baselineBottom = heightPct(BASELINE)

  return (
    <div className="bg-surface border border-hairline rounded-2xl p-5">
      <div className="overflow-x-auto">
        <div className="relative flex items-end gap-1.5 min-h-[132px] h-[132px]">
          {/* 1.00 baseline */}
          <div
            className="absolute left-0 right-0 border-t border-dashed border-hairline pointer-events-none"
            style={{ bottom: `${baselineBottom}%` }}
          />
          {/* A real <a> rather than a button+navigate: these now leave the
              site for vlr.gg, and an anchor is what makes middle-click and
              "open in new tab" work on a bar. */}
          {bars.map((b) => (
            <a
              key={b.id}
              href={vlrMatchUrl(b.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={`${b.date} — vs ${b.opponent} ${b.score} — Rating ${fmtRating(b.r)} (${b.k}/${b.d}/${b.a}) — open on vlr.gg`}
              className="group relative flex-1 min-w-[10px] max-w-[36px] h-full flex items-end"
            >
              <span
                className={`w-full rounded-sm transition-opacity group-hover:opacity-80 ${toneFor(b.r)}`}
                style={{ height: `${Math.max(2, heightPct(b.r))}%` }}
              />
            </a>
          ))}
        </div>

        {/* Opponent logos, on the same flex geometry as the bars so each
            logo stays under its own bar as the strip scrolls. */}
        <div className="flex items-start gap-1.5 mt-2">
          {bars.map((b) => (
            <span
              key={b.id}
              className="flex-1 min-w-[10px] max-w-[36px] flex justify-center"
              title={`vs ${b.opponent}`}
            >
              <TeamLogo team={b.opponent} size={20} showName={false} />
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 mt-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-good inline-block" /> 1.15+
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-mid inline-block" /> 0.95–1.15
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-bad inline-block" /> under 0.95
        </span>
        <span className="ml-auto">
          Dashed line is 1.00
          {bars.length < totalCount && ` · showing the most recent ${bars.length} of ${totalCount} matches`}
          {' '}· click a bar for the match on vlr.gg
        </span>
      </div>
    </div>
  )
}
