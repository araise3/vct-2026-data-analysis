import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandBuckets,
  expandSeriesRows,
  expandMapLengthRows,
  aggregateTeamBuckets,
  groupByEntity,
} from '../lib/entityBuckets'
import DataTable from '../components/DataTable'
import HorizontalBarChart from '../components/HorizontalBarChart'
import LeaderCard, { CardShell, topBy } from '../components/LeaderCard'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import TeamLogo from '../components/TeamLogo'
import { pct, num, rating, duration } from '../lib/format'



/**
 * The round-level stats added in d4db14d, as leaderboard cards rather
 * than the tail end of a 19-column table. Every one of these is a rate
 * over a denominator that varies wildly between teams, so each card
 * gates on its own sample size -- see topBy's comment for why.
 */
const TEAM_LEADERS = [
  {
    key: 'atkWinPct', title: 'Best attack sides',
    qualify: (r) => r.atkRounds >= 150,
    meta: (r) => `${num(r.atkRounds)} rds`, value: (r) => pct(r.atkWinPct),
    note: 'Regulation rounds only — VLR\'s per-side score header excludes overtime. Min. 150 attack rounds.',
  },
  {
    key: 'defWinPct', title: 'Best defence sides',
    qualify: (r) => r.defRounds >= 150,
    meta: (r) => `${num(r.defRounds)} rds`, value: (r) => pct(r.defWinPct),
    note: 'Min. 150 defence rounds in scope.',
  },
  {
    key: 'pistolWinPct', title: 'Best pistol rounds',
    qualify: (r) => r.pistolPlayed >= 20,
    meta: (r) => `${r.pistolWon}/${r.pistolPlayed}`, value: (r) => pct(r.pistolWinPct),
    note: 'Assumes 2 pistol rounds per map. Min. 20 pistols.',
  },
  {
    key: 'postPistolAntiEcoWinPct', title: 'Best post-pistol anti-eco',
    qualify: (r) => r.postPistolAntiEcoRounds >= 15,
    meta: (r) => `${num(r.postPistolAntiEcoRounds)} rds`, value: (r) => pct(r.postPistolAntiEcoWinPct),
    note: 'Round 2/14, having just won the pistol. Distinct from the economy-based Anti-eco card below. Min. 15 such rounds.',
  },
  {
    key: 'bonusWinPct', title: 'Best bonus round',
    qualify: (r) => r.bonusRounds >= 15,
    meta: (r) => `${num(r.bonusRounds)} rds`, value: (r) => pct(r.bonusWinPct),
    note: 'Round 3/15, having won both the pistol and the round after it. Min. 15 such rounds.',
  },
  {
    key: 'antiEcoWinPct', title: 'Best anti-eco',
    qualify: (r) => r.antiEcoRounds >= 10,
    meta: (r) => `${num(r.antiEcoRounds)} rds`, value: (r) => pct(r.antiEcoWinPct),
    note: 'Economy-based (eco/semi-buy vs. a full-buy opponent), any round. Min. 10 anti-eco rounds.',
  },
  {
    key: 'otWinPct', title: 'Best in overtime',
    qualify: (r) => r.otMaps >= 4,
    meta: (r) => `${num(r.otMaps)} maps`, value: (r) => `${r.otWon}/${r.otMaps}`,
    note: 'Min. 4 maps that reached overtime.',
  },
  {
    key: 'comebackPct', title: 'Best comebacks',
    qualify: (r) => r.comebackMaps >= 6,
    meta: (r) => `${num(r.comebackMaps)} maps`, value: (r) => `${r.comebackWon}/${r.comebackMaps}`,
    note: 'Faced a 3+ round deficit and still won the map. Min. 6 such maps.',
  },
  {
    key: 'elimPct', title: 'Most rounds won by elimination',
    qualify: (r) => r.mapsPlayed >= 10,
    meta: (r) => `${num(r.mapsPlayed)} maps`, value: (r) => pct(r.elimPct),
    note: 'Share of round wins ending in a team wipe rather than defuse/detonation/time.',
  },
  {
    key: 'avgMapDurationSeconds', title: 'Longest maps on average',
    qualify: (r) => r.mapsWithDuration >= 10,
    meta: (r) => `${num(r.mapsWithDuration)} maps`, value: (r) => duration(r.avgMapDurationSeconds),
    note: 'Min. 10 maps with a published duration.',
  },
]

export default function Teams() {
  const { data, loading } = useData('team_buckets')
  const { data: seriesData } = useData('series_length')
  const { data: mapLengthData } = useData('map_length')
  const [durationView, setDurationView] = useState('series') // 'series' | 'map'

  const records = useMemo(() => (data ? expandBuckets(data, 't') : []), [data])
  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds } =
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
        elimPct: (() => {
          const wc = agg.winConditions
          if (!wc) return null
          const total = Object.values(wc).reduce((a, b) => a + b, 0)
          return total ? (wc.elim ?? 0) / total : null
        })(),
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
  const matchesSelections = (r) => matchesFilters(r, FACETS, selections, dateRange)

  const seriesRows = useMemo(() => {
    if (!seriesData) return []
    return expandSeriesRows(seriesData).filter((r) => r.fullyTimed && matchesSelections(r))
  }, [seriesData, selections, dateRange])

  const mapRows = useMemo(() => {
    if (!mapLengthData) return []
    return expandMapLengthRows(mapLengthData).filter(matchesSelections)
  }, [mapLengthData, selections, dateRange])

  const activeDurationRows = durationView === 'series' ? seriesRows : mapRows

  const longestSeries = useMemo(
    () => [...activeDurationRows].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 5),
    [activeDurationRows]
  )
  const shortestSeries = useMemo(
    () => [...activeDurationRows].sort((a, b) => a.durationSeconds - b.durationSeconds).slice(0, 5),
    [activeDurationRows]
  )

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  const columns = [
    {
      key: 'team', label: 'Team', align: 'left',
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
    { key: 'atkWinPct', label: 'ATK Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'defWinPct', label: 'DEF Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'otWinPct', label: 'OT Win%', align: 'right', colorScale: true, format: (v, r) => (r.otMaps ? `${r.otWon}/${r.otMaps}` : '—') },
    { key: 'postPistolAntiEcoWinPct', label: 'Post-Pistol AE%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'bonusWinPct', label: 'Bonus Rd%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'antiEcoWinPct', label: 'Anti-Eco%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'comebackPct', label: 'Comebacks', align: 'right', colorScale: true, format: (v, r) => (r.comebackMaps ? `${r.comebackWon}/${r.comebackMaps}` : '—') },
    { key: 'elimPct', label: 'Elim%', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : pct(v)) },
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
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
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

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="font-display text-sm font-semibold text-ink">Round-level leaders</h2>
              <p className="text-muted text-xs">
                Same filters as the table below. China-region matches carry no economy data,
                so those teams are absent from the pistol-conversion and anti-eco cards
                rather than shown as 0%.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {TEAM_LEADERS.map((c) => (
                <LeaderCard
                  key={c.key}
                  title={c.title}
                  note={c.note}
                  rows={topBy(rows, c.key, { qualify: c.qualify })}
                  renderEntity={(r) => (
                    <Link to={`/teams/${encodeURIComponent(r.team)}`} className="min-w-0">
                      <TeamLogo team={r.team} size={18} />
                    </Link>
                  )}
                  meta={c.meta}
                  value={c.value}
                  showRank
                />
              ))}
            </div>
          </div>

          {(seriesRows.length > 0 || mapRows.length > 0) && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-end">
                <div className="flex rounded-lg overflow-hidden border border-hairline w-fit">
                  {['series', 'map'].map((v) => (
                    <button
                      key={v}
                      onClick={() => setDurationView(v)}
                      className={`px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                        durationView === v ? 'bg-accent text-white' : 'bg-surface2 text-muted hover:text-ink'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SeriesList
                  title={durationView === 'series' ? 'Longest series (clock time)' : 'Longest map (clock time)'}
                  rows={longestSeries}
                  mode={durationView}
                />
                <SeriesList
                  title={durationView === 'series' ? 'Shortest series (clock time)' : 'Shortest map (clock time)'}
                  rows={shortestSeries}
                  mode={durationView}
                />
              </div>
            </div>
          )}

          <DataTable columns={columns} rows={rows} defaultSortKey="mapWinPct" />

          <p className="text-muted text-xs">
            Pistol Win% assumes 2 pistol rounds per map. China teams show — since VLR doesn't
            publish economy data for that region. "Eternal Fire" reflects one EMEA franchise slot
            held sequentially by two orgs (ULF Esports, then Eternal Fire). Avg Map Time and the
            series/map lists exclude a small number of China-region maps (94 of 1281) where VLR
            itself never published a duration — the same known gap as the missing Rating 2.0
            values for that region.
          </p>
        </>
      )}
    </div>
  )
}

function SeriesList({ title, rows, mode = 'series' }) {
  return (
    <CardShell title={title}>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <TeamLogo team={r.team1} size={18} />
              <span className="text-muted text-xs shrink-0">vs</span>
              <TeamLogo team={r.team2} size={18} />
            </div>
            <div className="text-muted text-xs shrink-0">
              {mode === 'series' ? `${r.mapCount} maps` : r.mapName}
            </div>
            <div className="font-semibold text-ink shrink-0 w-16 text-right">
              {duration(r.durationSeconds)}
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  )
}
