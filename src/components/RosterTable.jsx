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
 * IGL indicator (matched by handle, case-insensitive since VLR and
 * Liquipedia don't always agree on capitalization) and a real coaching
 * staff section above the table, both sourced from
 * public/data/liquipedia_rosters.json. Liquipedia's own roster tables
 * don't distinguish starter/sub either (just active/former), so there
 * isn't a like-for-like replacement for the old badge's granularity --
 * this shows what's actually verifiable instead of re-guessing it a
 * different way.
 *
 * Scope deliberately limited to CURRENT roster + coaches only (no
 * historical transfers, no non-coaching staff like managers/streamers/
 * content creators) -- Liquipedia has all of that too, just not surfaced
 * here.
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
 * Real status from Liquipedia, NOT the old derived map-share badge.
 * STARTER/BENCHED come straight from Liquipedia's own Active/Inactive
 * table split when available, or -- Liquipedia doesn't have a
 * Starter-vs-Stand-in column anywhere -- inferred from the most recent
 * relevant sentence in that team's History/Timeline section (see
 * compute_player_statuses in the scraper). null means genuinely
 * undetermined: either no history text mentions this player's current
 * stint at all, or the phrasing didn't match any pattern the classifier
 * recognizes. Shown as nothing rather than a guess.
 */
function statusBadge(status) {
  if (status === 'STARTER') return { label: 'STARTER', cls: 'bg-accent/15 text-accent border-accent/30' }
  if (status === 'BENCHED') return { label: 'BENCHED', cls: 'bg-bad/15 text-bad border-bad/30' }
  if (status === 'STAND-IN') return { label: 'STAND-IN', cls: 'bg-surface2 text-muted border-hairline' }
  return null
}

const th = 'px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap'
const td = 'px-4 py-3 text-sm whitespace-nowrap align-middle'

export default function RosterTable({ team, rows, liquipedia }) {
  const coaches = liquipedia?.coaches ?? []
  const lqPlayersById = new Map(
    (liquipedia?.players ?? []).map((p) => [p.id.toLowerCase(), p])
  )

  return (
    <div className="flex flex-col gap-4">
      {coaches.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold text-ink">Coaching Staff</h2>
          <div className="bg-surface border border-hairline rounded-2xl divide-y divide-hairline">
            {coaches.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ink font-medium flex items-center gap-2">
                  <Flag countryCode={c.flag} countryName={c.name} size={20} />
                  {c.name || c.id}
                  {c.name && <span className="text-muted text-xs font-normal">({c.id})</span>}
                </span>
                <div className="flex items-center gap-6 text-xs text-muted">
                  <span>{c.role}</span>
                  {c.joinDate && <span>Since {shortDate(c.joinDate)}</span>}
                </div>
              </div>
            ))}
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
              {rows.map((p, i) => {
                const lq = lqPlayersById.get(p.player.toLowerCase())
                const last = i === rows.length - 1
                const bd = last ? '' : 'border-b border-hairline'
                return (
                  <tr key={p.player} className="hover:bg-surface2/40 transition-colors">
                    <td className={`${td} ${bd}`}>
                      <Link
                        to={`/players/${encodeURIComponent(p.player)}`}
                        className="flex items-center gap-2.5 min-w-0 group"
                      >
                        <Flag countryCode={p.countryCode} countryName={p.countryName} size={22} />
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
              {rows.length === 0 && (
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
          that week's actual play dates. Status is Starter/Benched/Stand-in inferred from Liquipedia's
          roster tables and transaction history -- shown blank where that history doesn't clearly say.
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
