import { Link } from 'react-router-dom'
import Flag from './Flag'
import { rating, pct, num } from '../lib/format'

/**
 * The roster block on a team profile -- the page's headline component.
 *
 * Deliberately NOT built on DataTable: this needs a two-line identity
 * cell, a date-range column, and per-row emphasis that DataTable's
 * uniform single-line cells don't accommodate. Sorting is fixed (rating
 * desc) rather than clickable for the same reason -- a five-to-seven
 * row roster doesn't need it.
 *
 * The player table previously had a derived "Role" badge (CORE/
 * ROTATION/STAND-IN, guessed from each player's share of team maps
 * played) because VLR doesn't publish official starter/sub status.
 * That's gone now, replaced with real data from Liquipedia: a captain/
 * IGL indicator, a Starter/Benched status badge, and a real coaching
 * staff section, all sourced from public/data/liquipedia_rosters.json.
 *
 * Status is ONLY Liquipedia's own Active/Inactive table split (labeled
 * Starter/Benched here to match VLR's own terminology) -- a clean,
 * structured, reliable signal. An earlier version additionally tried
 * inferring finer-grained status from that team's History/Timeline
 * prose, which is fragile natural-language parsing; dropped entirely in
 * favor of the reliable table-based signal alone.
 *
 * `rows` (this team's roster) comes from OUR OWN VLR match data --
 * whoever has aggregated stats for this team in the current filter
 * scope, which is NOT the same question as "who is currently on this
 * team". A player who left months ago still has real match history
 * for this team within a wide-enough date range, and would otherwise
 * show up looking like a normal current member with no indication
 * they've departed. Liquipedia's Former Players list (NOT displayed
 * here, only used as a filter) is the ground truth for that: anyone
 * confirmed departed (present in formerPlayers, absent from the
 * current Active/Inactive list) is dropped from `rows` entirely rather
 * than shown unmarked. Confirmed against Natus Vincere specifically --
 * sociablEE, Filu, ComeBack, and Kolosha all have real match stats in
 * scope but have since left per Liquipedia, and were showing up
 * unflagged before this fix.
 */

function shortDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${d}`
}

function activeRange(first, last) {
  if (!first && !last) return '—'
  const a = shortDate(first)
  const b = shortDate(last)
  return a === b ? a : `${a} – ${b}`
}

/**
 * Match win/loss record for `team` from `joinDate` onward -- the head
 * coach's own tenure record, not scoped to whatever Year/Event the rest of
 * the page is currently showing. Deliberately unscoped, same reasoning as
 * PlayerProfile's bestKillMatch/allMatchRows: "since becoming head coach"
 * is a fixed historical fact about the coach, not something that should
 * shrink or disappear because the page's Year chip moved elsewhere.
 *
 * Match-level (not map-level), matching the KPI card convention already
 * used for "Matches" on TeamProfile -- a coach's record is talked about in
 * series won/lost, not individual maps. Ties (s1 === s2, an undecided/
 * abandoned series) and matches with no reported score are skipped rather
 * than counted either way.
 */
function coachRecordSince(matches, team, joinDate) {
  if (!joinDate || !matches) return null
  let wins = 0
  let losses = 0
  for (const m of matches) {
    if (!m.date || m.date < joinDate) continue
    if (m.s1 == null || m.s2 == null || m.s1 === m.s2) continue
    const isTeam1 = m.team1 === team
    const isTeam2 = m.team2 === team
    if (!isTeam1 && !isTeam2) continue
    if (isTeam1 ? m.s1 > m.s2 : m.s2 > m.s1) wins++
    else losses++
  }
  const played = wins + losses
  return played ? { wins, losses, winPct: wins / played } : null
}

/**
 * Real status from Liquipedia's own Active/Inactive table split -- labeled
 * Starter/Benched to match VLR's own terminology. An earlier version
 * additionally tried inferring status from that team's History/Timeline
 * prose (natural-language parsing, fragile, ~7% genuinely undetermined
 * even after several rounds of bug fixes); dropped entirely in favor of
 * this reliable table-based signal alone.
 *
 * Anything other than the literal STARTER/BENCHED (e.g. SUBSTITUTE, or
 * whatever else Liquipedia's roster table uses in that same slot -- see
 * derive_player_status in build_liquipedia_data.py) renders as a plain
 * neutral badge with that value as its own label, generalizing to values
 * this component doesn't need to know about in advance.
 */
function statusBadge(status) {
  if (!status) return null
  if (status === 'STARTER') return { label: 'STARTER', cls: 'bg-good/15 text-good border-good/30' }
  if (status === 'BENCHED') return { label: 'BENCHED', cls: 'bg-bad/15 text-bad border-bad/30' }
  return { label: status, cls: 'bg-mid/15 text-mid border-mid/30' }
}

const th = 'px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap'
const td = 'px-4 py-3 text-sm whitespace-nowrap align-middle'

export default function RosterTable({ team, rows, liquipedia, enforceCurrentRoster = true, matches, headCoach }) {
  // headCoach itself is computed once by TeamProfile.jsx (also feeds
  // RosterTimeline's coach column below the roster) -- Head Coach only,
  // dropping Assistant Coach/Analyst/other coaching roles, and only ever
  // one slot even if Liquipedia's Organization section currently lists
  // more than one "Head Coach"-titled entry (e.g. a coaching change caught
  // mid-transition); see that computation's own comment.
  const coachRecord = headCoach ? coachRecordSince(matches, team, headCoach.joinDate) : null
  const lqPlayersById = new Map(
    (liquipedia?.players ?? []).map((p) => [p.id.toLowerCase(), p])
  )
  // Only show players Liquipedia confirms are CURRENTLY on the roster
  // (its Active or Inactive table) -- not everyone with match stats in
  // scope. Those aren't the same question: a player who left months ago
  // still has real match history for this team within a wide-enough
  // date range. Started as a narrower "exclude anyone confirmed
  // departed via the Former list" check, but that missed a real case:
  // Kolosha has actual match stats for Natus Vincere but appears
  // NOWHERE on their Liquipedia page at all (not Active, not Inactive,
  // not even Former) -- a 7-day stint Liquipedia apparently never
  // recorded. There's nothing to blacklist against for a player absent
  // from the page entirely, so this whitelists against the current
  // roster instead of trying to blacklist every way someone could be
  // gone.
  //
  // `enforceCurrentRoster` (set by TeamProfile.jsx based on whether the
  // active filter scope reaches this team's most recent season) turns
  // that whitelist off for a purely historical scope -- applied
  // unconditionally, it also erased a past season's real roster whenever
  // none of today's players happened to be on the team back then (e.g.
  // picking a year before every current player joined left "No players
  // in this scope" despite the team having real matches that year).
  // Direct request: a historical-only scope should show that season's
  // actual roster instead, so the whitelist only applies once the scope
  // reaches back to the present.
  const currentRows = liquipedia && enforceCurrentRoster
    ? rows.filter((p) => lqPlayersById.has(p.player.toLowerCase()))
    : rows

  // Sorted by role, starters first -- Array.prototype.sort is stable
  // (guaranteed since ES2019), so within each tier this preserves
  // whatever order currentRows already came in (rating desc, set by
  // TeamProfile.jsx), it doesn't need its own secondary sort key here.
  // A middle tier for anything other than the literal STARTER/BENCHED
  // (SUBSTITUTE, STAND-IN, INACTIVE, or whatever other note Liquipedia's
  // roster table carries -- see statusBadge above) reads as "still on
  // the active roster, just not starting", which belongs between full
  // starters and fully benched players rather than arbitrarily lumped
  // with either.
  const ROLE_RANK = { STARTER: 0, BENCHED: 2 }
  const roleRank = (status) => ROLE_RANK[status] ?? 1
  const sortedRows = [...currentRows].sort(
    (a, b) => roleRank(lqPlayersById.get(a.player.toLowerCase())?.playerStatus)
      - roleRank(lqPlayersById.get(b.player.toLowerCase())?.playerStatus)
  )

  return (
    <div className="flex flex-col gap-4">
      {headCoach && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold text-ink">Coaching Staff</h2>
          <div className="bg-surface border border-hairline rounded-2xl divide-y divide-hairline">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-ink font-medium flex items-center gap-2">
                <Flag countryCode={headCoach.flag} countryName={headCoach.name} size={16} />
                {headCoach.id}
              </span>
              <div className="flex items-center gap-6 text-xs text-muted">
                <span>Head Coach</span>
                {headCoach.joinDate && <span>Since {shortDate(headCoach.joinDate)}</span>}
                {coachRecord && (
                  <span className={`font-medium ${coachRecord.winPct >= 0.5 ? 'text-good' : 'text-ink/80'}`}>
                    {coachRecord.wins}–{coachRecord.losses} ({pct(coachRecord.winPct)})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="font-display text-sm font-semibold text-ink">Players of {team}</h2>
          <p className="text-muted text-xs">Reflects the filters above.</p>
        </div>

        <div className="bg-surface border border-hairline rounded-2xl overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-surface2">
                <th className={`${th} text-left border-b border-hairline`}>Player</th>
                <th className={`${th} text-left border-b border-hairline`}>Status</th>
                <th className={`${th} text-right border-b border-hairline`}>Active</th>
                <th className={`${th} text-right border-b border-hairline`}>Maps</th>
                <th className={`${th} text-right border-b border-hairline`}>Rounds</th>
                <th className={`${th} text-right border-b border-hairline`}>Rating</th>
                <th className={`${th} text-right border-b border-hairline`}>ACS</th>
                <th className={`${th} text-right border-b border-hairline`}>K/D</th>
                <th className={`${th} text-right border-b border-hairline`}>KAST</th>
                <th className={`${th} text-right border-b border-hairline`}>ADR</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((p, i) => {
                const lq = lqPlayersById.get(p.player.toLowerCase())
                const last = i === sortedRows.length - 1
                const bd = last ? '' : 'border-b border-hairline'
                return (
                  <tr key={p.player} className="hover:bg-surface2/40 transition-colors">
                    <td className={`${td} ${bd}`}>
                      <Link
                        to={`/players/${encodeURIComponent(p.player)}`}
                        className="flex items-center gap-2.5 min-w-0 group"
                      >
                        <Flag countryCode={p.countryCode} countryName={p.countryName} size={18} />
                        <span className="font-medium text-ink truncate group-hover:text-accent-bright transition-colors">
                          {p.player}
                        </span>
                        {lq?.captain && (
                          <span className="text-accent text-xs shrink-0" title="Team captain / IGL">★</span>
                        )}
                      </Link>
                    </td>
                    <td className={`${td} ${bd}`}>
                      {(() => {
                        const badge = statusBadge(lq?.playerStatus)
                        return badge && (
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )
                      })()}
                    </td>
                    <td className={`${td} ${bd} text-right text-muted text-xs`}>
                      {activeRange(p.firstDate, p.lastDate)}
                    </td>
                    <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>{num(p.mapsPlayed)}</td>
                    <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>{num(p.roundsPlayed)}</td>
                    <td className={`${td} ${bd} text-right font-semibold tabular-nums ${
                      p.avgRating == null ? 'text-muted'
                        : p.avgRating >= 1 ? 'text-good' : 'text-ink/90'
                    }`}>
                      {rating(p.avgRating)}
                    </td>
                    <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>{num(p.avgAcs, 0)}</td>
                    <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>
                      {p.kd == null ? '—' : p.kd.toFixed(2)}
                    </td>
                    <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>{pct(p.avgKast)}</td>
                    <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>{num(p.avgAdr, 1)}</td>
                  </tr>
                )
              })}
              {sortedRows.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-muted text-xs" colSpan={10}>
                    No players in this scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-muted text-xs leading-relaxed">
          Active is the first and last match week the player appeared in for this team, resolved to
          that week's actual play dates. Status is Liquipedia's own Active/Inactive roster split.
          Roster/captain/coach/status data from{' '}
          <a
            href="https://liquipedia.net/valorant"
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent-bright transition-colors underline"
          >
            Liquipedia
          </a>
          , licensed CC-BY-SA 3.0.
        </p>
      </div>
    </div>
  )
}
