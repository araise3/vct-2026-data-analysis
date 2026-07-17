import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import DataTable from '../components/DataTable'
import FilterChips from '../components/FilterChips'
import { rating, pct, num } from '../lib/format'

const SCOPE_OPTIONS = ['All players', 'Non-China only', 'China only']

export default function Players() {
  const { data, loading } = useData('players')
  const [scope, setScope] = useState('Non-China only')
  const [useIntlStatsForChina, setUseIntlStatsForChina] = useState(true)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    if (!data) return []
    let filtered = data
    if (scope === 'Non-China only') filtered = data.filter((p) => !p.isChina)
    if (scope === 'China only') filtered = data.filter((p) => p.isChina)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter(
        (p) => p.player.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q)
      )
    }

    return filtered
      .map((p) => {
        const useIntl = p.isChina && useIntlStatsForChina && p.hasIntlStats
        const s = useIntl ? p.intlStats : p.stats
        if (!s) return null
        return {
          player: p.player,
          team: p.team,
          isChina: p.isChina,
          usingIntlStats: useIntl,
          ...s,
        }
      })
      .filter(Boolean)
  }, [data, scope, search, useIntlStatsForChina])

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const columns = [
    {
      key: 'player',
      label: 'Player',
      align: 'left',
      format: (v, row) => (
        <div className="flex items-center gap-2">
          <span className="font-body font-medium">{v}</span>
          {row.usingIntlStats && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-bright font-body">
              Intl-only
            </span>
          )}
        </div>
      ),
    },
    { key: 'team', label: 'Team', align: 'left' },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (v) => num(v) },
    { key: 'avgRating', label: 'Rating', align: 'right', colorScale: true, format: (v) => rating(v) },
    { key: 'avgAcs', label: 'ACS', align: 'right', colorScale: true, format: (v) => num(v, 0) },
    { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v ? v.toFixed(2) : '—') },
    { key: 'avgKast', label: 'KAST', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'avgAdr', label: 'ADR', align: 'right', colorScale: true, format: (v) => num(v, 0) },
    { key: 'avgHsPct', label: 'HS%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'totalKills', label: 'Kills', align: 'right', format: (v) => num(v) },
    { key: 'totalDeaths', label: 'Deaths', align: 'right', format: (v) => num(v) },
    { key: 'totalFirstKills', label: 'FK', align: 'right', format: (v) => num(v) },
    { key: 'total2k', label: '2K', align: 'right', format: (v) => num(v) },
    { key: 'total3k', label: '3K', align: 'right', format: (v) => num(v) },
    { key: 'totalAce', label: 'Ace', align: 'right', format: (v) => num(v) },
    { key: 'totalClutches', label: 'Clutches', align: 'right', format: (v) => num(v) },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Players</h1>
        <p className="text-muted text-sm mt-1">{rows.length} players shown</p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <FilterChips options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
        <input
          type="text"
          placeholder="Search player or team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-surface border border-hairline rounded-xl px-4 py-2 text-sm text-ink placeholder-muted focus:outline-none focus:border-accent/50 w-full md:w-64"
        />
      </div>

      {(scope !== 'Non-China only') && (
        <label className="flex items-center gap-2.5 text-sm text-muted bg-surface border border-hairline rounded-xl px-4 py-3 w-fit">
          <input
            type="checkbox"
            checked={useIntlStatsForChina}
            onChange={(e) => setUseIntlStatsForChina(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          Use International-only stats for China players who also played Masters/EWC
        </label>
      )}

      <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
        China-region matches don't publish multi-kill, clutch, or economy data on VLR — those columns
        will read 0 for China players unless "Intl-only stats" is checked above and that player also
        competed internationally.
      </div>

      <DataTable columns={columns} rows={rows} defaultSortKey="avgRating" />
    </div>
  )
}
