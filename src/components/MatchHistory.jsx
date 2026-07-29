import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import { rating, pct, num, eventLabel, roundLabel, vlrMatchUrl } from '../lib/format'

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
 * Rows open the match on vlr.gg in a new tab. This site used to render its
 * own /matches/:id page instead, which cost 525 per-match JSON files (9.5MB,
 * 45% of all site data) to reproduce a view VLR already serves, keeps live,
 * and shows more of (VODs, comments, pick/ban). Series shape stays visible
 * here in the Maps column so the common question ("2-0 or 2-1, which maps?")
 * still answers without leaving.
 *
 * The row is clickable AND the trailing cell is a real <a>: the anchor is
 * what gives link semantics -- middle-click, "open in new tab", a visible
 * target URL on hover -- none of which a bare onClick handler provides. It
 * stops propagation so clicking it doesn't also fire the row handler and
 * open two tabs.
 */

/** Signed difference, colored like VLR's own +/- columns. */
function Diff({ value }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="text-muted">—</span>
  const cls = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-accent-bright' : 'text-muted'
  return <span className={cls}>{value > 0 ? `+${value}` : value}</span>
}

/** Box-with-arrow glyph, marking a row as leaving the site for vlr.gg. */
function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" className="shrink-0 inline-block">
      <path d="M9 3h4v4M12.5 3.5L7 9" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10v2.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const PLAYER_STAT_COLUMNS = [
  { key: 'r', label: 'R', render: (s) => rating(s.r) },
  { key: 'acs', label: 'ACS', render: (s) => num(s.acs, 0) },
  { key: 'k', label: 'K', render: (s) => num(s.k) },
  { key: 'd', label: 'D', render: (s) => num(s.d) },
  { key: 'a', label: 'A', render: (s) => num(s.a) },
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
  matches, playersByMatch, perspective = null, showEvent = true, emptyLabel,
}) {
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
            <th className="px-3 py-3 text-left font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              Maps
            </th>
            <th className="px-3 py-3 border-b border-hairline" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ match: m, opponent, myScore, oppScore, won, playerStats }) => {
            return (
              <tr
                key={m.id}
                onClick={() => window.open(vlrMatchUrl(m.id), '_blank', 'noopener,noreferrer')}
                className="cursor-pointer transition-colors hover:bg-surface2/30"
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
                {/* Map scores inline -- the row leaves the site entirely
                    now, so this is the only place the series shape (2-0 vs
                    2-1, which maps) shows without a round trip to VLR. */}
                <td className="px-3 py-2.5 border-b border-hairline whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    {m.maps?.map((mp, i) => (
                      <span
                        key={`${mp.map}-${i}`}
                        className="text-[11px] text-muted/70"
                        title={`${mp.map} ${mp.s1}–${mp.s2}${mp.ot ? ' (OT)' : ''}`}
                      >
                        {mp.s1}<span className="text-muted/40">–</span>{mp.s2}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2.5 border-b border-hairline text-right">
                  <a
                    href={vlrMatchUrl(m.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="View this match on vlr.gg"
                    className="text-muted hover:text-accent-bright transition-colors inline-flex"
                  >
                    <ExternalIcon />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
