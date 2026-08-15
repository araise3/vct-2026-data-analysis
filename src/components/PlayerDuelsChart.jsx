import { Link } from 'react-router-dom'
import TeamLogo from './TeamLogo'
import Flag from './Flag'

/**
 * This player's kill duels against every opponent they've faced, grouped
 * into columns by that opponent's country -- modeled directly on vlr.gg's
 * own per-match duel widget (team logo, player name, team tag, then a
 * three-cell kills-for/kills-against/diff strip), just aggregated across
 * the subject's whole match history and grouped by country instead of by
 * one match's single opposing team.
 *
 * `groups` is aggregatePlayerDuelsByOpponent()'s return shape: an array of
 * `{ code, name, opponents: [{ opponent, team, kFor, kAgainst, diff }] }`,
 * already sorted by country name with each group's opponents ranked by
 * duel volume.
 */
export default function PlayerDuelsChart({ groups }) {
  if (!groups.length) {
    return <p className="text-muted text-sm px-1">No duel data for this scope.</p>
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex items-start gap-5 pb-1">
        {groups.map((g) => (
          <div key={g.code || 'unknown'} className="flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-muted text-[10px] font-bold uppercase tracking-wide">
              {g.code && <Flag countryCode={g.code} countryName={g.name} size={11} />}
              {g.name || 'Unknown'}
            </div>
            <div className="flex items-end gap-1.5">
              {g.opponents.map((o) => (
                <Link
                  key={o.opponent}
                  to={`/players/${encodeURIComponent(o.opponent)}`}
                  className="group flex flex-col items-center gap-1 w-[64px] shrink-0"
                  title={`${o.opponent}${o.team ? ` (${o.team})` : ''}: ${o.kFor} kills for, ${o.kAgainst} kills against`}
                >
                  <TeamLogo team={o.team} size={20} showName={false} />
                  <span className="text-[10px] text-ink font-medium truncate w-full text-center group-hover:text-accent-bright transition-colors">
                    {o.opponent}
                  </span>
                  <span className="flex w-full rounded-md overflow-hidden text-[11px] font-semibold tabular-nums">
                    <span className="flex-1 bg-surface2 text-ink text-center py-0.5">{o.kFor}</span>
                    <span className="flex-1 bg-surface2 text-ink text-center py-0.5 border-l border-base">{o.kAgainst}</span>
                    <span
                      className={`flex-1 text-center py-0.5 border-l border-base ${
                        o.diff > 0 ? 'bg-good/15 text-good' : o.diff < 0 ? 'bg-bad/15 text-bad' : 'bg-surface2 text-muted'
                      }`}
                    >
                      {o.diff > 0 ? `+${o.diff}` : o.diff}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
