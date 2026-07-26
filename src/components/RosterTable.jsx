import { Link } from 'react-router-dom'
import Flag from './Flag'
import { rating, pct, num } from '../lib/format'

/**
 * The roster block on a team profile -- the page's headline component.
 *
 * Deliberately NOT built on DataTable: this needs a two-line identity
 * cell (name over role badge), a date-range column, and per-row
 * emphasis that DataTable's uniform single-line cells don't accommodate.
 * Sorting is fixed (rating desc) rather than clickable for the same
 * reason -- a five-to-seven row roster doesn't need it.
 *
 * On the "Role" column: this is DERIVED from each player's share of the
 * team's maps in the current filter scope, not official roster data.
 * VLR does publish starter/sub/inactive flags but the scraper doesn't
 * collect them, so inferring from map share is the honest option --
 * hence the footnote under the table rather than an unqualified
 * "STARTER" badge implying it came from the source.
 */

function roleFor(mapShare) {
  if (mapShare == null) return null
  if (mapShare >= 0.8) return { label: 'CORE', cls: 'bg-accent/15 text-accent border-accent/30' }
  if (mapShare >= 0.3) return { label: 'ROTATION', cls: 'bg-surface2 text-muted border-hairline' }
  return { label: 'STAND-IN', cls: 'bg-surface2 text-muted/70 border-hairline' }
}

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

const th = 'px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap'
const td = 'px-4 py-3 text-sm whitespace-nowrap align-middle'

export default function RosterTable({ team, rows }) {
  return (
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
              <th className={`${th} text-left border-b border-hairline`}>Role</th>
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
              const role = roleFor(p.mapShare)
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
                    </Link>
                  </td>
                  <td className={`${td} ${bd}`}>
                    {role && (
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${role.cls}`}>
                        {role.label}
                      </span>
                    )}
                  </td>
                  <td className={`${td} ${bd} text-right text-muted text-xs`}>
                    {activeRange(p.firstDate, p.lastDate)}
                  </td>
                  <td className={`${td} ${bd} text-right text-ink/90 tabular-nums`}>
                    {num(p.mapsPlayed)}
                    {p.mapShare != null && (
                      <span className="text-muted text-xs ml-1.5">{pct(p.mapShare, 0)}</span>
                    )}
                  </td>
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
        Role is derived from each player's share of the team's maps in scope, not official roster
        data — VLR publishes starter/sub flags but the scraper doesn't collect them. Active is the
        first and last match week the player appeared in for this team, resolved to that week's
        actual play dates.
      </p>
    </div>
  )
}
