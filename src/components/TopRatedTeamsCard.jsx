import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import { RailCard } from './MatchRail'
import { num } from '../lib/format'

/**
 * Left/right-rail summary of /ratings' Glicko-2 table: the current season's
 * top teams by rating, so a visitor lands on something more informative than
 * "check the ratings page" for the season's headline number. `rows` is
 * expected pre-filtered/sliced by the caller (top N, non-provisional) --
 * this component just renders whatever it's handed, same division of labour
 * as CircuitList/ResultsRail.
 */
export default function TopRatedTeamsCard({ year, rows }) {
  if (!rows || rows.length === 0) return null

  return (
    <RailCard
      title={`Top rated teams · ${year}`}
      footer={
        <Link to="/ratings" className="transition-colors hover:text-ink">
          Full ratings →
        </Link>
      }
    >
      <div className="flex flex-col gap-1.5 p-2">
        {rows.map((r, i) => (
          <Link
            key={r.team}
            to={`/teams/${encodeURIComponent(r.team)}`}
            className="flex items-center gap-2 rounded-lg border border-hairline bg-surface2 px-3 py-1.5 shadow-depth-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-muted hover:shadow-depth-sm"
          >
            <span className="w-3.5 shrink-0 text-right text-[10px] font-semibold tabular-nums text-muted">
              {i + 1}
            </span>
            <TeamLogo team={r.team} size={18} showName={false} />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
              {r.team}
            </span>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink">
              {num(r.rating)}
            </span>
          </Link>
        ))}
      </div>
    </RailCard>
  )
}
