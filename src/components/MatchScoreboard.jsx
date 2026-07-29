import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import AgentIcon from './AgentIcon'
import Flag from './Flag'
import { rating, pct, num } from '../lib/format'

/**
 * One map's (or the whole series') box score, both teams, in VLR's own
 * scoreboard layout.
 *
 * Controlled: the caller owns `side`, because the match page drives the
 * map selector and the side toggle from one place and both re-render this.
 *
 * Row shape differs slightly between the two things that feed it -- a
 * series row's `ag` is the list of agents played across the maps, a single
 * map's is one agent -- so `ag` is normalised here rather than making the
 * export write the same shape twice.
 */

/** Signed difference, colored green/red like VLR's own +/- columns. */
function Diff({ value }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="text-muted">—</span>
  const cls = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-accent-bright' : 'text-muted'
  return <span className={cls}>{value > 0 ? `+${value}` : value}</span>
}

/** Picks the active side's stats, falling back to the All row. */
export function statsFor(row, side) {
  if (side === 'all') return row
  return row[side] || row
}

const BASE_COLUMNS = [
  { key: 'r', label: 'R', render: (s) => rating(s.r) },
  { key: 'acs', label: 'ACS', render: (s) => num(s.acs, 0) },
  { key: 'k', label: 'K', render: (s) => num(s.k) },
  { key: 'd', label: 'D', render: (s) => num(s.d) },
  { key: 'a', label: 'A', render: (s) => num(s.a) },
  { key: 'kdDiff', label: '+/−', render: (s) => <Diff value={s.k - s.d} /> },
  { key: 'kast', label: 'KAST', render: (s) => pct(s.kast, 0) },
  { key: 'adr', label: 'ADR', render: (s) => num(s.adr, 0) },
  { key: 'hs', label: 'HS%', render: (s) => pct(s.hs, 0) },
  { key: 'fk', label: 'FK', render: (s) => num(s.fk) },
  { key: 'fd', label: 'FD', render: (s) => num(s.fd) },
  { key: 'fkDiff', label: '+/−', render: (s) => <Diff value={s.fk - s.fd} /> },
]

// Multi-kills, clutches, economy rating and objective play. These come off
// the All row even when a side is selected -- the source has no side split
// for them at all, so showing them under an Attack heading would imply a
// breakdown that doesn't exist. Dimmed for that reason.
const EXTRA_COLUMNS = [
  { key: 'm2', label: '2K' },
  { key: 'm3', label: '3K' },
  { key: 'm4', label: '4K' },
  { key: 'm5', label: 'ACE' },
  { key: 'cl', label: 'CL' },
  { key: 'ec', label: 'ECON' },
  { key: 'pl', label: 'PL' },
  { key: 'df', label: 'DF' },
]

function TeamBlock({ team, rows, side, meta, highlightPlayer, extras }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (statsFor(b, side).r ?? -1) - (statsFor(a, side).r ?? -1)),
    [rows, side]
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline">
              <Link
                to={`/teams/${encodeURIComponent(team)}`}
                className="hover:text-accent-bright transition-colors"
              >
                <TeamLogo team={team} size={20} />
              </Link>
            </th>
            <th className="px-2 py-2 border-b border-hairline" />
            {BASE_COLUMNS.map((c) => (
              <th
                key={c.key}
                className="px-3 py-2 text-right font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
            {extras.map((c) => (
              <th
                key={c.key}
                className="px-2.5 py-2 text-right font-medium text-xs uppercase tracking-wide text-muted/60 border-b border-hairline whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const s = statsFor(row, side)
            const m = meta?.[row.p]
            const isHighlight = highlightPlayer && row.p === highlightPlayer
            const agents = Array.isArray(row.ag) ? row.ag : row.ag ? [row.ag] : []
            return (
              <tr
                key={row.p}
                className={`transition-colors ${
                  isHighlight ? 'bg-accent/10' : 'hover:bg-surface2/40'
                }`}
              >
                <td className="px-3 py-2 border-b border-hairline">
                  <div className="flex items-center gap-2 min-w-0">
                    <Flag countryCode={m?.cc} countryName={m?.cn} size={14} />
                    <Link
                      to={`/players/${encodeURIComponent(row.p)}`}
                      className={`font-medium truncate hover:text-accent-bright transition-colors ${
                        isHighlight ? 'text-accent-bright' : 'text-ink'
                      }`}
                    >
                      {row.p}
                    </Link>
                  </div>
                </td>
                <td className="px-2 py-2 border-b border-hairline">
                  <div className="flex items-center gap-1">
                    {agents.map((a, i) => (
                      <AgentIcon key={`${a}-${i}`} agent={a} size={18} />
                    ))}
                  </div>
                </td>
                {BASE_COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className="px-3 py-2 text-right border-b border-hairline whitespace-nowrap text-ink/90"
                  >
                    {c.render(s)}
                  </td>
                ))}
                {extras.map((c) => (
                  <td
                    key={c.key}
                    className="px-2.5 py-2 text-right border-b border-hairline whitespace-nowrap text-muted"
                  >
                    {row[c.key] == null ? '—' : num(row[c.key])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function MatchScoreboard({
  rows, team1, team2, meta, side = 'all', highlightPlayer, showExtras = false,
}) {
  const byTeam = useMemo(() => {
    const out = new Map()
    for (const r of rows) {
      if (!out.has(r.t)) out.set(r.t, [])
      out.get(r.t).push(r)
    }
    return out
  }, [rows])

  const teams = useMemo(() => {
    const ordered = [team1, team2].filter((t) => byTeam.has(t))
    for (const t of byTeam.keys()) if (!ordered.includes(t)) ordered.push(t)
    return ordered
  }, [byTeam, team1, team2])

  // Only offer the extra columns that this match actually has data for --
  // China-region maps publish none of them, and eight permanently-empty
  // columns on every China scoreboard would be worse than not showing them.
  const extras = useMemo(() => {
    if (!showExtras) return []
    return EXTRA_COLUMNS.filter((c) => rows.some((r) => r[c.key] != null))
  }, [rows, showExtras])

  if (rows.length === 0) {
    return <p className="text-muted text-xs px-1 py-3">No player stats published for this map.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {teams.map((t) => (
        <TeamBlock
          key={t}
          team={t}
          rows={byTeam.get(t)}
          side={side}
          meta={meta}
          highlightPlayer={highlightPlayer}
          extras={extras}
        />
      ))}
    </div>
  )
}
