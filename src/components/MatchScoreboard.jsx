import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import AgentIcon from './AgentIcon'
import Flag from './Flag'
import { rating, pct, num } from '../lib/format'

/**
 * One match's box score, both teams, in VLR's own scoreboard layout:
 * a per-team block of five player rows, each with the agents they played
 * (one per map of the series) and their series-aggregate stats.
 *
 * Rows come from match_players.json, which stores FINAL per-match values
 * rather than the (value x rounds) sums every bucket file uses -- a match
 * is the smallest unit this data is ever viewed at, so there's nothing to
 * re-aggregate here. See the export script's own comment for why.
 *
 * The All/Attack/Defend toggle swaps in each row's `atk`/`def` sub-object,
 * which carries the same stat set minus maps/rounds (those are
 * side-invariant -- you play the same maps either way). A row with no side
 * data at all keeps its All numbers rather than blanking out, since the
 * absence is a scrape gap, not a real zero.
 */
const SIDES = [
  { key: 'all', label: 'All' },
  { key: 'atk', label: 'Attack' },
  { key: 'def', label: 'Defend' },
]

/** Signed difference, colored green/red like VLR's own +/- columns. */
function Diff({ value }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="text-muted">—</span>
  const cls = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-accent-bright' : 'text-muted'
  return <span className={cls}>{value > 0 ? `+${value}` : value}</span>
}

/** Picks the active side's stats, falling back to the All row. */
function statsFor(row, side) {
  if (side === 'all') return row
  return row[side] || row
}

const COLUMNS = [
  { key: 'r', label: 'R', render: (s) => rating(s.r) },
  { key: 'acs', label: 'ACS', render: (s) => num(s.acs, 0) },
  {
    key: 'kda', label: 'K / D / A', wide: true,
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
  { key: 'fk', label: 'FK', render: (s) => num(s.fk) },
  { key: 'fd', label: 'FD', render: (s) => num(s.fd) },
  { key: 'fkDiff', label: '+/−', render: (s) => <Diff value={s.fk - s.fd} /> },
]

function TeamBlock({ team, rows, side, meta, highlightPlayer }) {
  // Sorted by rating within the team, the way VLR orders a scoreboard --
  // best performer first rather than by however the source rows happened
  // to come out of the groupby.
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
            {/* Agent column has no header label -- it's identified by its
                contents, same as VLR, and a label would only widen it. */}
            <th className="px-2 py-2 border-b border-hairline" />
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className="px-3 py-2 text-right font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap"
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
                    {row.ag?.map((a, i) => (
                      <AgentIcon key={`${a}-${i}`} agent={a} size={18} />
                    ))}
                  </div>
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className="px-3 py-2 text-right border-b border-hairline whitespace-nowrap text-ink/90"
                  >
                    {c.render(s)}
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

export default function MatchScoreboard({ rows, team1, team2, meta, highlightPlayer }) {
  const [side, setSide] = useState('all')

  // Group by each row's own team rather than assuming the two teams from
  // the match record: a scoreboard should render whatever teams the player
  // rows actually claim, so a name mismatch shows up as an extra block
  // instead of silently dropping five players.
  const byTeam = useMemo(() => {
    const out = new Map()
    for (const r of rows) {
      if (!out.has(r.t)) out.set(r.t, [])
      out.get(r.t).push(r)
    }
    return out
  }, [rows])

  // team1/team2 first (match order), then anything unexpected.
  const teams = useMemo(() => {
    const ordered = [team1, team2].filter((t) => byTeam.has(t))
    for (const t of byTeam.keys()) if (!ordered.includes(t)) ordered.push(t)
    return ordered
  }, [byTeam, team1, team2])

  const anySideData = useMemo(() => rows.some((r) => r.atk || r.def), [rows])

  if (rows.length === 0) {
    return (
      <p className="text-muted text-xs px-4 py-3">
        No player stats published for this match.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {anySideData && (
        <div className="flex justify-end">
          <div className="flex rounded-lg overflow-hidden border border-hairline">
            {SIDES.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSide(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  side === opt.key ? 'bg-accent text-white' : 'bg-surface2 text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {teams.map((t) => (
        <TeamBlock
          key={t}
          team={t}
          rows={byTeam.get(t)}
          side={side}
          meta={meta}
          highlightPlayer={highlightPlayer}
        />
      ))}
    </div>
  )
}
