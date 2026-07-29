import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import MatchScoreboard from './MatchScoreboard'
import { rating, pct, num, eventLabel, roundLabel } from '../lib/format'

/**
 * Chronological match log, shared by the player profile, the team profile
 * and the Tournaments page.
 *
 * `perspective` decides what a row is *about*:
 *   - { type: 'player', name } -> that player's own line in each match
 *     (their team, their opponent, their box-score numbers)
 *   - { type: 'team', name }   -> that team's result and map scores
 *   - null                     -> a neutral "team1 vs team2" row, which is
 *     what the Tournaments page wants since neither side is the subject
 *
 * Every row expands into the full both-teams MatchScoreboard. Scoreboards
 * mount only once expanded -- a team can have ~100 matches in scope and
 * rendering 100 hidden 10-row tables up front is real work for something
 * almost never looked at.
 */

/** Signed difference, colored like VLR's own +/- columns. */
function Diff({ value }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="text-muted">—</span>
  const cls = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-accent-bright' : 'text-muted'
  return <span className={cls}>{value > 0 ? `+${value}` : value}</span>
}

function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 16 16" width="13" height="13" fill="none"
      className={`shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const PLAYER_STAT_COLUMNS = [
  { key: 'r', label: 'R', render: (s) => rating(s.r) },
  { key: 'acs', label: 'ACS', render: (s) => num(s.acs, 0) },
  {
    key: 'kda', label: 'K / D / A',
    render: (s) => (
      <span className="whitespace-nowrap">
        <span className="text-ink">{num(s.k)}</span>
        <span className="text-muted/50"> / </span>
        <span className="text-muted">{num(s.d)}</span>
        <span className="text-muted/50"> / </span>
        <span className="text-ink/80">{num(s.a)}</span>
      </span>
    ),
  },
  { key: 'kdDiff', label: '+/−', render: (s) => <Diff value={s.k - s.d} /> },
  { key: 'kast', label: 'KAST', render: (s) => pct(s.kast, 0) },
  { key: 'adr', label: 'ADR', render: (s) => num(s.adr, 0) },
  { key: 'hs', label: 'HS%', render: (s) => pct(s.hs, 0) },
]

/** W/L pill. `won` may be null for a match with no decided winner. */
function ResultBadge({ won }) {
  if (won === null || won === undefined) return <span className="text-muted text-xs">—</span>
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-semibold ${
        won ? 'bg-emerald-500/20 text-emerald-400' : 'bg-accent/20 text-accent-bright'
      }`}
    >
      {won ? 'W' : 'L'}
    </span>
  )
}

export default function MatchHistory({
  matches, playersByMatch, meta, perspective = null, showEvent = true, emptyLabel,
}) {
  const [expanded, setExpanded] = useState(() => new Set())

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const isPlayer = perspective?.type === 'player'

  // Newest first. `date` is YYYY-MM-DD so lexicographic ordering is
  // chronological; match id breaks ties within a single day, since several
  // matches of the same round routinely share a date.
  const ordered = useMemo(
    () => [...matches].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || b.id - a.id
    ),
    [matches]
  )

  // Per match: which side is "ours", who we played, did we win. For a
  // player perspective the team comes from that player's own scoreboard
  // row (`t`), NOT a global meta.team -- a player who transferred
  // mid-season was genuinely on a different team for older matches, and
  // reading one fixed team would flip the opponent and the W/L on every
  // match from before the move.
  const rows = useMemo(() => {
    return ordered.map((m) => {
      const scoreboard = playersByMatch?.get(m.id) || []
      let myTeam = null
      if (perspective?.type === 'team') {
        myTeam = perspective.name
      } else if (isPlayer) {
        myTeam = scoreboard.find((r) => r.p === perspective.name)?.t ?? null
      }
      const isTeam1 = myTeam != null && m.team1 === myTeam
      const isTeam2 = myTeam != null && m.team2 === myTeam
      const opponent = isTeam1 ? m.team2 : isTeam2 ? m.team1 : null
      const myScore = isTeam1 ? m.s1 : isTeam2 ? m.s2 : null
      const oppScore = isTeam1 ? m.s2 : isTeam2 ? m.s1 : null
      const won = myScore == null || oppScore == null || myScore === oppScore
        ? null
        : myScore > oppScore
      return {
        match: m,
        scoreboard,
        myTeam, opponent, myScore, oppScore, won,
        playerStats: isPlayer ? scoreboard.find((r) => r.p === perspective.name) : null,
      }
    })
  }, [ordered, playersByMatch, perspective, isPlayer])

  if (rows.length === 0) {
    return (
      <p className="text-muted text-sm px-1">{emptyLabel || 'No matches in this scope.'}</p>
    )
  }

  const statColumns = isPlayer ? PLAYER_STAT_COLUMNS : []
  // date + event? + result + score + opponent/teams + stats + chevron
  const colSpan = 4 + (showEvent ? 1 : 0) + statColumns.length + 1

  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="bg-surface2">
            <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              Date
            </th>
            {showEvent && (
              <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline">
                Event
              </th>
            )}
            <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline">
              {perspective ? 'Round' : 'Match'}
            </th>
            <th className="px-2 py-3 text-center font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline">
              {perspective ? '' : 'Round'}
            </th>
            <th className="px-4 py-3 text-center font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              Score
            </th>
            {statColumns.map((c) => (
              <th
                key={c.key}
                className="px-3 py-3 text-right font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
            <th className="px-3 py-3 border-b border-hairline" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ match: m, scoreboard, myTeam, opponent, myScore, oppScore, won, playerStats }) => {
            const open = expanded.has(m.id)
            return [
              <tr
                key={m.id}
                onClick={() => toggle(m.id)}
                className={`cursor-pointer transition-colors ${open ? 'bg-surface2/50' : 'hover:bg-surface2/30'}`}
              >
                <td className="px-4 py-2.5 border-b border-hairline text-muted whitespace-nowrap">
                  {m.date || '—'}
                </td>
                {showEvent && (
                  <td className="px-4 py-2.5 border-b border-hairline text-ink/80">
                    <span className="truncate block max-w-[220px]">{eventLabel(m.event)}</span>
                  </td>
                )}
                <td className="px-4 py-2.5 border-b border-hairline">
                  {perspective ? (
                    <span className="text-muted text-xs">{roundLabel(m.w)}</span>
                  ) : (
                    // Neutral view (Tournaments): both teams, winner in
                    // full-strength ink so the result reads without
                    // parsing the score.
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Link
                        to={`/teams/${encodeURIComponent(m.team1)}`}
                        onClick={(e) => e.stopPropagation()}
                        className={`hover:text-accent-bright transition-colors ${
                          m.s1 > m.s2 ? 'text-ink font-medium' : 'text-muted'
                        }`}
                      >
                        <TeamLogo team={m.team1} size={18} />
                      </Link>
                      <span className="text-muted/50 text-xs">vs</span>
                      <Link
                        to={`/teams/${encodeURIComponent(m.team2)}`}
                        onClick={(e) => e.stopPropagation()}
                        className={`hover:text-accent-bright transition-colors ${
                          m.s2 > m.s1 ? 'text-ink font-medium' : 'text-muted'
                        }`}
                      >
                        <TeamLogo team={m.team2} size={18} />
                      </Link>
                    </div>
                  )}
                </td>
                <td className="px-2 py-2.5 border-b border-hairline text-center">
                  {perspective ? <ResultBadge won={won} /> : (
                    <span className="text-muted text-xs whitespace-nowrap">{roundLabel(m.w)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 border-b border-hairline text-center whitespace-nowrap">
                  {perspective ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className={won ? 'text-ink font-medium' : 'text-muted'}>
                        {myScore ?? '—'}
                      </span>
                      <span className="text-muted/50">–</span>
                      <span className={won === false ? 'text-ink font-medium' : 'text-muted'}>
                        {oppScore ?? '—'}
                      </span>
                      {opponent && (
                        <Link
                          to={`/teams/${encodeURIComponent(opponent)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-1 hover:text-accent-bright transition-colors"
                        >
                          <TeamLogo team={opponent} size={18} />
                        </Link>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink">
                      {m.s1} <span className="text-muted/50">–</span> {m.s2}
                    </span>
                  )}
                </td>
                {statColumns.map((c) => (
                  <td
                    key={c.key}
                    className="px-3 py-2.5 text-right border-b border-hairline whitespace-nowrap text-ink/90"
                  >
                    {playerStats ? c.render(playerStats) : <span className="text-muted">—</span>}
                  </td>
                ))}
                <td className="px-3 py-2.5 border-b border-hairline text-muted text-right">
                  <Chevron open={open} />
                </td>
              </tr>,
              open && (
                <tr key={`${m.id}-detail`}>
                  <td colSpan={colSpan} className="border-b border-hairline bg-base/40 px-4 py-4">
                    {/* Map scores for the series, above the box score --
                        the scoreboard itself is series-aggregate, so
                        without this there's nothing showing how the maps
                        actually went. */}
                    {m.maps?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {m.maps.map((mp, i) => (
                          <span
                            key={`${mp.map}-${i}`}
                            className="text-xs bg-surface2 border border-hairline rounded-lg px-2.5 py-1 text-muted"
                          >
                            <span className="text-ink/90">{mp.map}</span>{' '}
                            {mp.s1}<span className="text-muted/50">–</span>{mp.s2}
                            {mp.ot ? <span className="text-accent-bright ml-1">OT</span> : null}
                          </span>
                        ))}
                      </div>
                    )}
                    <MatchScoreboard
                      rows={scoreboard}
                      team1={m.team1}
                      team2={m.team2}
                      meta={meta}
                      highlightPlayer={isPlayer ? perspective.name : null}
                    />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
