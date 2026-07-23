import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import KpiCard from '../components/KpiCard'
import RankedList from '../components/RankedList'
import TeamLogo from '../components/TeamLogo'
import { rating, pct, num } from '../lib/format'

export default function Overview() {
  const { data, loading } = useData('overview')
  const [includeEwc, setIncludeEwc] = useState(false)

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const kpis = includeEwc ? data.kpisWithEwc : data.kpis
  const topPlayersByRating = includeEwc ? data.topPlayersByRatingWithEwc : data.topPlayersByRating
  const topTeamsByMapWinPct = includeEwc ? data.topTeamsByMapWinPctWithEwc : data.topTeamsByMapWinPct

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Season Overview</h1>
        <p className="text-muted text-sm mt-1">
          Every tier-1 VCT 2026 international event — Kickoffs, Stage 1s, Stage 2s, Masters, Champions.
        </p>
      </div>

      <label className="flex items-center gap-2.5 text-sm text-muted bg-surface border border-hairline rounded-xl px-4 py-3 w-fit">
        <input
          type="checkbox"
          checked={includeEwc}
          onChange={(e) => setIncludeEwc(e.target.checked)}
          className="accent-accent w-4 h-4"
        />
        Include Esports World Cup (EWC) 2026
      </label>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <KpiCard label="Events" value={kpis.totalEvents} />
        <KpiCard label="Matches" value={num(kpis.totalMatches)} />
        <KpiCard label="Maps" value={num(kpis.totalMaps)} />
        <KpiCard label="Rounds" value={num(kpis.totalRounds)} />
        <KpiCard label="Players" value={num(kpis.totalPlayers)} />
        <KpiCard label="Teams" value={num(kpis.totalTeams)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RankedList
          title="Top players by rating (min. 10 maps)"
          rows={topPlayersByRating}
          renderRow={(p) => (
            <>
              <Link to={`/teams/${encodeURIComponent(p.team)}`} className="shrink-0 self-center h-8 flex items-center justify-center">
                <TeamLogo team={p.team} size={32} showName={false} />
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/players/${encodeURIComponent(p.player)}`} className="block text-sm text-ink font-medium truncate hover:text-accent-bright transition-colors">
                  {p.player}
                </Link>
                <Link to={`/teams/${encodeURIComponent(p.team)}`} className="block text-xs text-muted truncate hover:text-accent-bright transition-colors">
                  {p.team}
                </Link>
              </div>
              <span className="font-body text-sm text-good font-medium">{rating(p.rating)}</span>
            </>
          )}
        />
        <RankedList
          title="Top teams by map win rate (min. 10 maps)"
          rows={topTeamsByMapWinPct}
          renderRow={(t) => (
            <>
              <Link to={`/teams/${encodeURIComponent(t.team)}`} className="shrink-0 self-center h-8 flex items-center justify-center">
                <TeamLogo team={t.team} size={32} showName={false} />
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/teams/${encodeURIComponent(t.team)}`} className="block text-sm text-ink font-medium truncate hover:text-accent-bright transition-colors">
                  {t.team}
                </Link>
                <div className="text-xs text-muted truncate">{t.region} · {t.mapsWon}/{t.mapsPlayed} maps</div>
              </div>
              <span className="font-body text-sm text-good font-medium">{pct(t.mapWinPct)}</span>
            </>
          )}
        />
      </div>
    </div>
  )
}
