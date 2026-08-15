import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import { eventLabel, roundLabel, vlrMatchUrl } from '../lib/format'

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
 * `playersByMatch` (from groupMatchPlayers) is ONLY needed for a player
 * perspective -- it resolves which team that player was on for each match,
 * which a fixed meta.team can't do across a mid-season transfer. A team or
 * neutral perspective already knows whose row it is, so those callers should
 * not load match_players.json at all: it's the site's second-largest data
 * file (3.9MB / 10,974 rows) and two pages were fetching it purely to hand
 * over a Map that this component never read.
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

  // Newest first. Sorts by `ts` (full "YYYY-MM-DD HH:MM:SS" kickoff time)
  // when present -- match id is NOT a safe same-day tiebreak across
  // different concurrent events (VLR assigns ids at match-page-creation
  // time, not kickoff time, so two regions' matches from the same day can
  // come back in an order that doesn't match when either was actually
  // played; see recentResults() in schedule.js, which had the identical
  // bug on the home page's Recent Results rail). Falls back to `date` +
  // match id for matches that predate the `ts` field.
  const ordered = useMemo(
    () => [...matches].sort((a, b) =>
      (b.ts || b.date || '').localeCompare(a.ts || a.date || '') || b.id - a.id
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
        // Whether "ours" is team2 -- used below to flip the per-map pills
        // (m.maps[].s1/s2 are stored match-absolute, team1's score first,
        // straight off the scraper's team1_score/team2_score columns) onto
        // the same my-score-first convention the Result column next to them
        // already uses. Without this, a perspective row could read "W 2–0"
        // in Result while its own map pills showed "8–13 / 10–13" -- correct
        // numbers, but silently relative to the OTHER team.
        flipped: isTeam2,
        myTeam, opponent, myScore, oppScore, won,
      }
    })
  }, [ordered, playersByMatch, perspective, isPlayer])

  if (rows.length === 0) {
    return (
      <p className="text-muted text-sm px-1">{emptyLabel || 'No matches in this scope.'}</p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline">
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr className="bg-surface2">
            <th className="px-4 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              Date
            </th>
            {showEvent && (
              <th className="px-4 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-muted border-b border-hairline">
                Event
              </th>
            )}
            {/* whitespace-nowrap here (and on the matching data cell below)
                is load-bearing, not decorative -- without it, round labels
                longer than one short word ("Grand Final", "Upper
                Semifinals") wrap onto 2 lines while every other column
                in the row stays single-line, which grew that one row to
                60px against the table's normal 41px and made the whole
                table read as misaligned row-to-row rather than just one
                wide column. */}
            <th className="px-4 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              {perspective ? 'Round' : 'Match'}
            </th>
            <th className="px-4 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              {perspective ? 'Opponent' : 'Round'}
            </th>
            <th className="px-4 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              {perspective ? 'Result' : 'Score'}
            </th>
            <th className="px-3 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              Maps
            </th>
            <th className="px-3 py-2 border-b border-hairline" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ match: m, opponent, myScore, oppScore, won, flipped }) => {
            return (
              <tr
                key={m.id}
                onClick={() => window.open(vlrMatchUrl(m.id), '_blank', 'noopener,noreferrer')}
                className="cursor-pointer transition-colors hover:bg-surface2/30"
              >
                <td className="px-4 py-1.5 border-b border-hairline text-muted whitespace-nowrap">
                  {m.date || '—'}
                </td>
                {showEvent && (
                  <td className="px-4 py-1.5 border-b border-hairline text-ink/80">
                    <span className="truncate block max-w-[220px]">{eventLabel(m.event)}</span>
                  </td>
                )}
                <td className="px-4 py-1.5 border-b border-hairline whitespace-nowrap">
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
                {/* Opponent gets its own column now -- it used to be crammed
                    into the same cell as the score itself (logo/name right
                    next to the digits), which read as one cluttered,
                    ambiguous "Score" column doing two unrelated jobs at
                    once (who we played AND what happened). Splitting them
                    also reads in the natural order: who, then what happened. */}
                <td className="px-4 py-1.5 border-b border-hairline whitespace-nowrap">
                  {perspective ? (
                    opponent && (
                      <Link
                        to={`/teams/${encodeURIComponent(opponent)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center hover:text-accent-bright transition-colors"
                      >
                        <TeamLogo team={opponent} size={18} />
                      </Link>
                    )
                  ) : (
                    <span className="text-muted text-xs whitespace-nowrap">{roundLabel(m.w)}</span>
                  )}
                </td>
                <td className="px-4 py-1.5 border-b border-hairline whitespace-nowrap">
                  {perspective ? (
                    // The W/L badge and the score are one "Result" now,
                    // instead of the badge living all the way back in the
                    // Round column, disconnected from the number it
                    // actually describes. myScore/oppScore each keep their
                    // own fixed-width slot (not the cluster as a whole) so
                    // "1" -- narrower than "0"/"2" in this font -- can't
                    // shift the dash's position row to row.
                    <span className="flex items-center gap-1.5">
                      <ResultBadge won={won} />
                      <span className="flex items-center gap-1">
                        <span className={`w-4 text-right ${won ? 'text-ink font-medium' : 'text-muted'}`}>
                          {myScore ?? '—'}
                        </span>
                        <span className="text-muted/50">–</span>
                        <span className={`w-4 text-left ${won === false ? 'text-ink font-medium' : 'text-muted'}`}>
                          {oppScore ?? '—'}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink">
                      {m.s1} <span className="text-muted/50">–</span> {m.s2}
                    </span>
                  )}
                </td>
                {/* Map scores inline -- the row leaves the site entirely
                    now, so this is the only place the series shape (2-0 vs
                    2-1, which maps) shows without a round trip to VLR.
                    Each pill is a fixed width (rather than sized to its own
                    "7–13" vs "13–5" text), so the 2nd/3rd map's pill lines
                    up at the same x position row to row instead of drifting
                    with whatever digit count that particular score has. */}
                <td className="px-3 py-1.5 border-b border-hairline whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    {/* mp.s1/s2 are stored match-absolute (team1's score
                        first), but a perspective row's Result column is
                        my-score-first -- flip the pair here too when "ours"
                        is team2, so a pill never disagrees with the Result
                        badge sitting right next to it in the same row. The
                        neutral Tournaments view (perspective === null) has
                        no "ours" to be relative to, so it's left as-is,
                        matching that view's own team1-first Score column. */}
                    {m.maps?.map((mp, i) => {
                      const first = flipped ? mp.s2 : mp.s1
                      const second = flipped ? mp.s1 : mp.s2
                      return (
                        <span
                          key={`${mp.map}-${i}`}
                          className="text-[11px] text-muted/80 bg-surface2 rounded-2xl px-1.5 py-0.5 leading-none whitespace-nowrap w-11 text-center"
                          title={`${mp.map} ${first}–${second}${mp.ot ? ' (OT)' : ''}`}
                        >
                          {first}<span className="text-muted/40">–</span>{second}
                        </span>
                      )
                    })}
                  </span>
                </td>
                <td className="px-3 py-1.5 border-b border-hairline text-right">
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
