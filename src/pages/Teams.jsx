import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import DataTable from '../components/DataTable'
import HorizontalBarChart from '../components/HorizontalBarChart'
import FilterChips from '../components/FilterChips'
import TeamLogo from '../components/TeamLogo'
import { pct, num, rating } from '../lib/format'

const REGIONS = ['All', 'Americas', 'EMEA', 'Pacific', 'China', 'International']

export default function Teams() {
  const { data, loading } = useData('teams')
  const [region, setRegion] = useState('All')

  const rows = useMemo(() => {
    if (!data) return []
    if (region === 'All') return data
    return data.filter((t) => t.region === region)
  }, [data, region])

  const topByMapWin = useMemo(() => {
    return [...rows]
      .filter((t) => t.mapsPlayed >= 10 && t.mapWinPct !== null)
      .sort((a, b) => b.mapWinPct - a.mapWinPct)
      .slice(0, 12)
  }, [rows])

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const columns = [
    {
      key: 'team', label: 'Team', align: 'left', width: 220,
      format: (v) => (
        <Link to={`/teams/${encodeURIComponent(v)}`} className="font-medium hover:text-accent-bright transition-colors">
          <TeamLogo team={v} size={20} />
        </Link>
      ),
    },
    { key: 'region', label: 'Region', align: 'left' },
    { key: 'matchesPlayed', label: 'Matches', align: 'right', format: (v) => num(v) },
    { key: 'matchWinPct', label: 'Match Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (v) => num(v) },
    { key: 'mapWinPct', label: 'Map Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'pistolWinPct', label: 'Pistol Win%', align: 'right', colorScale: true, format: (v) => (v === null ? '—' : pct(v)) },
    { key: 'avgRating', label: 'Avg Rating', align: 'right', colorScale: true, format: (v) => rating(v) },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Teams</h1>
        <p className="text-muted text-sm mt-1">{rows.length} teams shown</p>
      </div>

      <FilterChips options={REGIONS} value={region} onChange={setRegion} />

      <div className="bg-surface border border-hairline rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-ink mb-4">Map win rate (min. 10 maps played)</h3>
        <HorizontalBarChart
          data={topByMapWin} labelKey="team" valueKey="mapWinPct" formatValue={pct} max={1}
          renderLabel={(d) => <TeamLogo team={d.team} size={16} />}
        />
      </div>

      <DataTable columns={columns} rows={rows} defaultSortKey="mapWinPct" />

      <p className="text-xs text-muted leading-relaxed">
        Pistol win rate assumes 2 pistol rounds per map (rounds 1 and 13 — there are none in overtime).
        China teams show — for pistol stats since VLR doesn't publish economy data for that region.
        "ULF Esports / Eternal Fire" reflects one EMEA franchise slot held sequentially by two orgs.
      </p>
    </div>
  )
}
