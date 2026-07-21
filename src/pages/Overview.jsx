import { useData } from '../lib/useData'
import KpiCard from '../components/KpiCard'
import RankedList from '../components/RankedList'
import { rating, pct, num } from '../lib/format'

export default function Overview() {
  const { data, loading } = useData('overview')

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const { kpis, topPlayersByRating, topTeamsByMapWinPct } = data

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Season Overview</h1>
        <p className="text-muted text-sm mt-1">
          Every tier-1 VCT 2026 international event — Kickoffs, Stage 1s, Stage 2s, Masters, Champions.
        </p>
      </div>

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
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink font-medium truncate">{p.player}</div>
                <div className="text-xs text-muted truncate">{p.team}</div>
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
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink font-medium truncate">{t.team}</div>
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
