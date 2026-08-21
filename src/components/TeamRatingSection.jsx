import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  buildRatings, buildTeamPoints, rankMovementFor, PROVISIONAL_RD,
} from '../lib/teamRatings'
import RatingChart from './RatingChart'
import { RC, PANEL_STYLE } from '../lib/ratingTheme'
import { num, shortDate } from '../lib/format'

/**
 * A team's Glicko-2 season on its profile page: where it finished, how it
 * got there, and how sure the system is about it.
 *
 * Kept out of TeamProfile.jsx (already ~800 lines) and fed the page's
 * already-fetched `match_results` rather than fetching anything itself, so
 * this costs the profile one memoised 23ms build and no extra network.
 *
 * Deliberately NOT tied to the page's event picker, only to its year. A
 * Glicko-2 rating is path-dependent -- the end state of a sequence of
 * updates over every game in order -- so there is no meaningful "this
 * team's rating at Masters only": excluding the rest of the season doesn't
 * filter the number, it invents a different one from a different history.
 * The footer states that, so it can't be misread as obeying a narrower
 * scope.
 */

/**
 * Rank movement since the last week the team played. Renders nothing at all
 * when there's no earlier period to compare against -- a grey zero would
 * imply "held station" when the truth is "no comparison exists yet".
 */
function Movement({ delta }) {
  if (delta == null || delta === 0) return null
  const up = delta > 0
  return (
    <span
      className="text-[11px] font-semibold tabular-nums"
      style={{ color: up ? RC.positive : RC.accent }}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(delta)} since last played`}
    >
      {up ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  )
}

function Stat({ label, value, sub, big, tone, movement }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className="text-[10px] font-medium tracking-wide uppercase"
        style={{ color: RC.textDim }}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-2 min-w-0">
        <span
          className="font-display font-semibold tabular-nums leading-none"
          style={{ fontSize: big ? 32 : 20, color: tone || RC.text }}
        >
          {value}
        </span>
        {movement !== undefined && <Movement delta={movement} />}
      </span>
      {sub && (
        <span className="text-[11px] truncate" style={{ color: RC.textDim }}>{sub}</span>
      )}
    </div>
  )
}

function SummaryItem({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: RC.textDim }}>
        {label}
      </span>
      <span className="text-xs font-semibold tabular-nums truncate" style={{ color: RC.text }}>
        {value}
      </span>
    </div>
  )
}

export default function TeamRatingSection({ matchData, team, year }) {
  const runs = useMemo(() => (matchData ? buildRatings(matchData) : new Map()), [matchData])

  // The page's scope chip can be "All", and a rating run is per-year by
  // construction -- fall back to the most recent year this team actually
  // appears in rather than to a hardcoded current season, since a team that
  // folded still has its own last season to show.
  const resolvedYear = useMemo(() => {
    if (typeof year === 'number' && runs.get(year)?.history.has(team)) return year
    const years = [...runs.keys()].sort((a, b) => b - a)
    return years.find((y) => runs.get(y).history.has(team)) ?? null
  }, [runs, team, year])

  const view = useMemo(() => {
    if (resolvedYear == null) return null
    const run = runs.get(resolvedYear)
    const row = run.table.find((t) => t.team === team)
    if (!row) return null

    // Ranks are among settled ratings only. A provisional team sitting third
    // on raw rating after a 3-0 start would otherwise push everyone below it
    // down a place on their own profile pages.
    const settled = run.table.filter((t) => !t.provisional)
    const overall = settled.findIndex((t) => t.team === team)
    const regional = settled.filter((t) => t.region === row.region)
    const regionRank = regional.findIndex((t) => t.team === team)

    return {
      row,
      points: buildTeamPoints(run, team, matchData?.events),
      movement: rankMovementFor(run, team, row.region),
      overallRank: overall === -1 ? null : overall + 1,
      overallOf: settled.length,
      regionRank: regionRank === -1 ? null : regionRank + 1,
      regionOf: regional.length,
    }
  }, [runs, team, resolvedYear, matchData])

  if (!view) return null
  const { row, points, movement, overallRank, overallOf, regionRank, regionOf } = view

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="font-display text-sm font-semibold text-ink">
          Glicko-2 rating — {resolvedYear} season
        </h2>
        <Link
          to={`/ratings?year=${resolvedYear}&teams=${encodeURIComponent(team)}`}
          className="text-xs transition-colors hover:text-accent-bright"
          style={{ color: RC.textDim }}
        >
          Full {resolvedYear} ratings →
        </Link>
      </div>

      <div style={PANEL_STYLE} className="flex flex-col gap-6">
        {/* Rating is the headline at 32px; everything beside it sits at 20
            so the eye lands on the number the page is actually about. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <Stat
            label="Rating"
            value={num(row.rating)}
            sub={`95% range ${num(row.low)}–${num(row.high)}`}
            big
            tone={RC.accent}
          />
          <Stat
            label="Deviation"
            value={`±${num(2 * row.rd)}`}
            sub={row.provisional ? `Provisional — RD above ${PROVISIONAL_RD}` : `RD ${num(row.rd)}`}
            tone={row.provisional ? RC.warning : RC.text}
          />
          <Stat
            label={`Rank in ${row.region}`}
            value={regionRank ? `#${regionRank}` : '—'}
            sub={regionRank ? `of ${regionOf} settled ratings` : 'Not yet settled'}
            movement={movement?.region}
          />
          <Stat
            label="Rank overall"
            value={overallRank ? `#${overallRank}` : '—'}
            sub={overallRank ? `of ${overallOf} settled ratings` : 'Not yet settled'}
            movement={movement?.overall}
          />
        </div>

        {points.length > 1 ? (
          <RatingChart
            series={[{ key: team, label: team, points }]}
            height={300}
            title="Rating trajectory"
            subtitle="One point per week the team played. Flat stretches are weeks off — the rating holds, but its deviation widens."
            showAnnotations={false}
            showSidePanel={false}
          />
        ) : (
          <p className="text-xs" style={{ color: RC.textDim }}>
            Only one rating period in {resolvedYear} — nothing to plot yet.
          </p>
        )}

        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4"
          style={{ borderTop: `1px solid ${RC.border}` }}
        >
          <SummaryItem label="Series" value={`${row.seriesWins}–${row.seriesLosses}`} />
          <SummaryItem label="Maps" value={`${row.mapWins}–${row.mapLosses}`} />
          <SummaryItem
            label="Peak"
            value={row.peak == null ? '—' : `${num(row.peak)}${row.peakDate ? ` · ${shortDate(row.peakDate)}` : ''}`}
          />
          <SummaryItem
            label="Last played"
            value={row.lastPlayed ? shortDate(row.lastPlayed) : '—'}
          />
        </div>

        <p className="text-[11px] -mt-2" style={{ color: RC.textDim, opacity: 0.8 }}>
          Rated on series results across the whole {resolvedYear} season — not affected by the scope
          above.
        </p>
      </div>
    </div>
  )
}
