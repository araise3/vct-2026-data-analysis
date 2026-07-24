import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, expandSeriesRows, aggregateTeamBuckets, groupByEntity } from '../lib/entityBuckets'
import DataTable from '../components/DataTable'
import HorizontalBarChart from '../components/HorizontalBarChart'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import TeamLogo from '../components/TeamLogo'
import { pct, num, rating, duration } from '../lib/format'



export default function Teams() {
  const { data, loading } = useData('team_buckets')
  const { data: seriesData } = useData('series_length')

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
      out.push({
        team,
        region: data.meta[team]?.region ?? '—',
        ...agg,
        roundsPerMap: agg.mapsPlayed ? agg.roundsPlayed / agg.mapsPlayed : null,
        mapsPerSeries: agg.matchesPlayed ? agg.mapsPlayed / agg.matchesPlayed : null,
      })
    }
    return out.sort((a, b) => (b.mapWinPct ?? 0) - (a.mapWinPct ?? 0))
  }, [filtered, data])

  const topByMapWin = useMemo(
    () => rows.filter((t) => t.mapsPlayed >= 10).slice(0, 12),
    [rows]
  )

  // Same active facet selections applied to the match-level series data --
  // duplicated here rather than sharing useFacetedFilter's internal
  // matching logic, since that hook owns its own state and this is a
  // second, independently-shaped record set filtered by the same values.
  const seriesRows = useMemo(() => {
    if (!seriesData) return []
    return expandSeriesRows(seriesData).filter(
      (r) =>
        r.fullyTimed &&
        FACETS.every((f) => {
          const sel = selections[f]
          return !sel || sel.length === 0 || sel.includes(r[f])
        })
    )
  }, [seriesData, selections])

  const longestSeries = useMemo(
    () => [...seriesRows].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 5),
    [seriesRows]
  )
  const shortestSeries = useMemo(
    () => [...seriesRows].sort((a, b) => a.durationSeconds - b.durationSeconds).slice(0, 5),
    [seriesRows]
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
    { key: 'mapsPerSeries', label: 'Maps/Series', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (v) => num(v) },
    { key: 'roundsPerMap', label: 'Rounds/Map', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(1)) },
    { key: 'avgMapDurationSeconds', label: 'Avg Map Time', align: 'right', colorScale: true, format: (v) => duration(v) },
    { key: 'mapWinPct', label: 'Map Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'pistolWinPct', label: 'Pistol Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'avgRating', label: 'Avg Rating', align: 'right', colorScale: true, format: (v) => rating(v) },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Teams</h1>
        <p className="text-muted text-sm mt-1">{rows.length} teams shown</p>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        summary={`${rows.length} teams`}
      />

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

          {seriesRows.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SeriesList title="Longest series (clock time)" rows={longestSeries} />
              <SeriesList title="Shortest series (clock time)" rows={shortestSeries} />
            </div>
          )}

          <DataTable columns={columns} rows={rows} defaultSortKey="mapWinPct" />

          <p className="text-muted text-xs">
            Pistol Win% assumes 2 pistol rounds per map. China teams show — since VLR doesn't
            publish economy data for that region. "Eternal Fire" reflects one EMEA franchise slot
            held sequentially by two orgs (ULF Esports, then Eternal Fire). Avg Map Time and the
            series lists only count maps/matches with a scraped duration, so coverage may be
            partial for older or unrescraped matches.
          </p>
        </>
      )}
    </div>
  )
}

function SeriesList({ title, rows }) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-5">
      <h3 className="font-display text-sm font-semibold text-ink mb-4">{title}</h3>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <TeamLogo team={r.team1} size={18} />
              <span className="text-muted text-xs shrink-0">vs</span>
              <TeamLogo team={r.team2} size={18} />
            </div>
            <div className="text-muted text-xs shrink-0">{r.mapCount} maps</div>
            <div className="font-semibold text-ink shrink-0 w-16 text-right">
              {duration(r.durationSeconds)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
