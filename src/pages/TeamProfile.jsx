import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import KpiCard from '../components/KpiCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

export default function TeamProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data: teams, loading: teamsLoading } = useData('teams')
  const { data: players, loading: playersLoading } = useData('players')
  const [includeEwc, setIncludeEwc] = useState(false)

  const team = useMemo(() => {
    if (!teams) return null
    const found = teams.find((t) => t.team === decodedName) || null
    if (!found) return null
    return includeEwc ? { ...found, ...found.withEwc } : found
  }, [teams, decodedName, includeEwc])

  const roster = useMemo(() => {
    if (!players) return []
    return players
      .filter((p) => p.team === decodedName)
      .map((p) => ({ ...p, _stats: includeEwc && p.statsWithEwc ? p.statsWithEwc : p.stats }))
      .filter((p) => p._stats)
      .sort((a, b) => (b._stats.avgRating || 0) - (a._stats.avgRating || 0))
  }, [players, decodedName, includeEwc])

  if (teamsLoading || playersLoading) return <div className="text-muted text-sm">Loading…</div>

  if (!team) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/teams" className="text-sm text-accent-bright hover:underline">← Back to Teams</Link>
        <p className="text-muted text-sm">No team found matching "{decodedName}".</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/teams" className="text-sm text-muted hover:text-ink w-fit">← Back to Teams</Link>

      <div className="flex items-stretch gap-4">
        <div className="w-16 rounded-xl bg-surface2 border border-hairline flex items-center justify-center shrink-0">
          <TeamLogo team={team.team} size={40} showName={false} showBg={false} />
        </div>
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-2xl font-semibold text-ink">{team.team}</h1>
          <p className="text-muted text-sm">{team.region}</p>
        </div>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Matches" value={`${team.matchesWon}-${team.matchesPlayed - team.matchesWon}`} sub={pct(team.matchWinPct)} />
        <KpiCard label="Maps" value={`${team.mapsWon}-${team.mapsPlayed - team.mapsWon}`} sub={pct(team.mapWinPct)} />
        <KpiCard label="Rounds Played" value={num(team.roundsPlayed)} />
        <KpiCard label="Avg Player Rating" value={rating(team.avgRating)} />
        <KpiCard
          label="Pistol Win%"
          value={team.pistolPlayed ? pct(team.pistolWinPct) : '—'}
          sub={team.pistolPlayed ? `${team.pistolWon}/${team.pistolPlayed}` : 'No economy data (China)'}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">Roster</h3>
        <p className="text-muted text-xs">Players first seen on this team, ranked by average rating.</p>
        <div className="bg-surface border border-hairline rounded-2xl divide-y divide-hairline">
          {roster.map((p) => (
            <Link
              key={p.player}
              to={`/players/${encodeURIComponent(p.player)}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-surface2/50 transition-colors"
            >
              <span className="text-sm text-ink font-medium flex items-center gap-2">
                {p.player}
                <Flag countryCode={p.countryCode} countryName={p.countryName} size={16} />
              </span>
              <div className="flex items-center gap-6 text-xs text-muted">
                <span>{p._stats.mapsPlayed} maps</span>
                <span className="text-good font-body font-medium">{rating(p._stats.avgRating)}</span>
              </div>
            </Link>
          ))}
          {roster.length === 0 && (
            <p className="text-muted text-xs px-5 py-4">No players found for this team.</p>
          )}
        </div>
      </div>
    </div>
  )
}
