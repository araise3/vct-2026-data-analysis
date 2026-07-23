import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import DataTable from '../components/DataTable'
import HorizontalBarChart from '../components/HorizontalBarChart'
import FacetGroup from '../components/FacetGroup'
import TeamLogo from '../components/TeamLogo'
import { pct, num, rating } from '../lib/format'

const REGIONS = ['Americas', 'EMEA', 'Pacific', 'China', 'International']

export default function Teams() {
  const { data, loading } = useData('teams')
  const [regions, setRegions] = useState([])
  const [includeEwc, setIncludeEwc] = useState(false)

  const rows = useMemo(() => {
    if (!data) return []
    let filtered = data
    if (regions.length > 0) filtered = filtered.filter((t) => regions.includes(t.region))
    if (includeEwc) filtered = filtered.map((t) => ({ ...t, ...t.withEwc }))
    return filtered
  }, [data, regions, includeEwc])

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

      <FacetGroup
        label="Region"
        options={REGIONS.map((r) => ({ value: r, available: true }))}
        selected={regions}
        onChange={setRegions}
      />

      <label className="flex items-center gap-2.5 text-sm text-muted bg-surface border border-hairline rounded-xl px-4 py-3 w-fit">
        <input
          type="checkbox"
          checked={includeEwc}
          onChange={(e) => setIncludeEwc(e.target.checked)}
          className="accent-accent w-4 h-4"
        />
        Include Esports World Cup (EWC) 2026
      </label>

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
        "Eternal Fire" reflects one EMEA franchise slot held sequentially by two orgs (ULF Esports, then Eternal Fire).
      </p>
    </div>
  )
}
