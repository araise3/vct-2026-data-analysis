import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import KpiCard from '../components/KpiCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

export default function PlayerProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data, loading } = useData('players')
  const [useIntlStats, setUseIntlStats] = useState(true)
  const [ratedOnly, setRatedOnly] = useState(false)
  const [includeEwc, setIncludeEwc] = useState(false)

  const player = useMemo(() => {
    if (!data) return null
    return data.find((p) => p.player === decodedName) || null
  }, [data, decodedName])

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  if (!player) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/players" className="text-sm text-accent-bright hover:underline">← Back to Players</Link>
        <p className="text-muted text-sm">No player found matching "{decodedName}".</p>
      </div>
    )
  }

  const useIntl = player.isChina && useIntlStats && player.hasIntlStats
  const useRated = !useIntl && player.isChina && ratedOnly && player.ratedOnlyStats
  const base = includeEwc && player.statsWithEwc ? player.statsWithEwc : player.stats
  const stats = useIntl ? player.intlStats : useRated ? player.ratedOnlyStats : base

  return (
    <div className="flex flex-col gap-6">
      <Link to="/players" className="text-sm text-muted hover:text-ink w-fit">← Back to Players</Link>

      <div>
        <h1 className="font-display text-2xl font-semibold text-ink flex items-center gap-2.5">
          {player.player}
          <Flag countryCode={player.countryCode} countryName={player.countryName} size={22} />
        </h1>
        <Link to={`/teams/${encodeURIComponent(player.team)}`} className="text-muted text-sm hover:text-accent-bright inline-block mt-1">
          <TeamLogo team={player.team} size={18} />
        </Link>
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

      {player.isChina && (
        <div className="flex flex-col gap-2">
          {player.hasIntlStats && (
            <label className="flex items-center gap-2.5 text-sm text-muted bg-surface border border-hairline rounded-xl px-4 py-3 w-fit">
              <input
                type="checkbox"
                checked={useIntlStats}
                onChange={(e) => setUseIntlStats(e.target.checked)}
                className="accent-accent w-4 h-4"
              />
              Use International-only stats (this player also played Masters/EWC)
            </label>
          )}
          {!useIntl && player.ratedOnlyStats && (
            <label className="flex items-center gap-2.5 text-sm text-muted bg-surface border border-hairline rounded-xl px-4 py-3 w-fit">
              <input
                type="checkbox"
                checked={ratedOnly}
                onChange={(e) => setRatedOnly(e.target.checked)}
                className="accent-accent w-4 h-4"
              />
              Only include maps with Rating 2.0
            </label>
          )}
          <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
            China-region matches don't publish multi-kill, clutch, or economy data on VLR — Total 2K/3K/4K/Ace
            and Total Clutches will read 0 unless a toggle above applies.
          </div>
        </div>
      )}

      {!stats ? (
        <p className="text-muted text-sm">No stats available for this scope.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Maps Played" value={num(stats.mapsPlayed)} />
            <KpiCard label="Rounds Played" value={num(stats.roundsPlayed)} />
            <KpiCard label="Avg Rating" value={rating(stats.avgRating)} />
            <KpiCard label="Avg ACS" value={num(stats.avgAcs, 0)} />
            <KpiCard label="K/D" value={stats.kd ? stats.kd.toFixed(2) : '—'} />
            <KpiCard label="Avg KAST" value={pct(stats.avgKast)} />
            <KpiCard label="Avg ADR" value={num(stats.avgAdr, 0)} />
            <KpiCard label="Avg HS%" value={pct(stats.avgHsPct)} />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-4">Totals</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Kills" value={num(stats.totalKills)} />
              <Stat label="Deaths" value={num(stats.totalDeaths)} />
              <Stat label="Assists" value={num(stats.totalAssists)} />
              <Stat label="First Kills" value={num(stats.totalFirstKills)} />
              <Stat label="First Deaths" value={num(stats.totalFirstDeaths)} />
              <Stat label="2K" value={num(stats.total2k)} />
              <Stat label="3K" value={num(stats.total3k)} />
              <Stat label="4K" value={num(stats.total4k)} />
              <Stat label="Ace" value={num(stats.totalAce)} />
              <Stat label="Clutches Won" value={num(stats.totalClutches)} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
      <span className="font-body text-lg text-ink font-medium">{value}</span>
    </div>
  )
}
