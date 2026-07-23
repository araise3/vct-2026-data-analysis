import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, aggregateTeamBuckets, groupByEntity } from '../lib/entityBuckets'
import DataTable from '../components/DataTable'
import HorizontalBarChart from '../components/HorizontalBarChart'
import FacetGroup from '../components/FacetGroup'
import TeamLogo from '../components/TeamLogo'
import { pct, num, rating } from '../lib/format'

const FACETS = ['competition', 'region', 'event', 'stage', 'phase', 'week']
const FACET_LABELS = {
  competition: 'Competition',
  region: 'Region',
  event: 'Event',
  stage: 'Stage',
  phase: 'Phase',
  week: 'Week / Round',
}

const weekLabel = (w) => (w.includes(': ') ? w.split(': ').slice(1).join(': ') : w)
const eventLabel = (e) => e.replace(/^Vct\b/, 'VCT')

export default function Teams() {
  const { data, loading } = useData('team_buckets')

  const records = useMemo(() => (data ? expandBuckets(data, 't') : []), [data])
  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const rows = useMemo(() => {
    if (!data) return []
    const grouped = groupByEntity(filtered)
    const out = []
    for (const [team, buckets] of grouped) {
      const agg = aggregateTeamBuckets(buckets)
      if (!agg || !agg.mapsPlayed) continue
      out.push({ team, region: data.meta[team]?.region ?? '—', ...agg })
    }
    return out.sort((a, b) => (b.mapWinPct ?? 0) - (a.mapWinPct ?? 0))
  }, [filtered, data])

  const topByMapWin = useMemo(
    () => rows.filter((t) => t.mapsPlayed >= 10).slice(0, 12),
    [rows]
  )

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

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
    { key: 'pistolWinPct', label: 'Pistol Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'avgRating', label: 'Avg Rating', align: 'right', colorScale: true, format: (v) => rating(v) },
  ]

  const renderers = { week: weekLabel, event: eventLabel }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Teams</h1>
        <p className="text-muted text-sm mt-1">{rows.length} teams shown</p>
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-semibold text-ink">Filters</span>
          {activeCount > 0 && (
            <button onClick={clearAll} className="text-xs text-accent-bright hover:underline">
              Clear all ({activeCount})
            </button>
          )}
        </div>
        {FACETS.map((f) => (
          <FacetGroup
            key={f}
            label={FACET_LABELS[f]}
            options={options[f] || []}
            selected={selections[f] || []}
            onChange={(vals) => setFacet(f, vals)}
            renderLabel={renderers[f]}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No teams match this filter combination.</p>
        </div>
      ) : (
        <>
          {topByMapWin.length > 0 && (
            <div className="bg-surface border border-hairline rounded-2xl p-5">
              <h3 className="font-display text-sm font-semibold text-ink mb-4">
                Top teams by map win rate (min. 10 maps in scope)
              </h3>
              <HorizontalBarChart
                data={topByMapWin} labelKey="team" valueKey="mapWinPct" formatValue={pct} max={1}
                renderLabel={(d) => <TeamLogo team={d.team} size={16} />}
              />
            </div>
          )}

          <DataTable columns={columns} rows={rows} defaultSortKey="mapWinPct" />

          <p className="text-muted text-xs">
            Pistol Win% assumes 2 pistol rounds per map. China teams show — since VLR doesn't
            publish economy data for that region. "Eternal Fire" reflects one EMEA franchise slot
            held sequentially by two orgs (ULF Esports, then Eternal Fire).
          </p>
        </>
      )}
    </div>
  )
}
