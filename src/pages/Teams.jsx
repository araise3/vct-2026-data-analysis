import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import {
  expandBuckets,
  aggregateTeamBuckets,
  groupByEntity,
} from '../lib/entityBuckets'
import DataTable from '../components/DataTable'
import LeaderCard, { topBy, dynamicQualify } from '../components/LeaderCard'
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
    sampleKey: 'atkRounds', sampleMin: 150,
    meta: (r) => `${num(r.atkRounds)} rds`, value: (r) => pct(r.atkWinPct),
    note: 'Regulation rounds only — VLR\'s per-side score header excludes overtime. Min. 150 attack rounds (scaled down when the current filter scope doesn\'t have that much volume).',
  },
  {
    key: 'defWinPct', title: 'Best defence sides',
    sampleKey: 'defRounds', sampleMin: 150,
    meta: (r) => `${num(r.defRounds)} rds`, value: (r) => pct(r.defWinPct),
    note: 'Min. 150 defence rounds in scope (scaled down for a smaller filter scope).',
  },
  {
    key: 'pistolWinPct', title: 'Best pistol rounds',
    sampleKey: 'pistolPlayed', sampleMin: 20,
    meta: (r) => `${r.pistolWon}/${r.pistolPlayed}`, value: (r) => pct(r.pistolWinPct),
    note: 'Assumes 2 pistol rounds per map. Min. 20 pistols (scaled down for a smaller filter scope).',
  },
  {
    key: 'postPistolAntiEcoWinPct', title: 'Best post-pistol anti-eco',
    sampleKey: 'postPistolAntiEcoRounds', sampleMin: 15,
    meta: (r) => `${num(r.postPistolAntiEcoRounds)} rds`, value: (r) => pct(r.postPistolAntiEcoWinPct),
    note: 'Round 2/14, having just won the pistol. Distinct from the economy-based Anti-eco card below. Min. 15 such rounds (scaled down for a smaller filter scope).',
  },
  {
    key: 'bonusWinPct', title: 'Best bonus round',
    sampleKey: 'bonusRounds', sampleMin: 15,
    meta: (r) => `${num(r.bonusRounds)} rds`, value: (r) => pct(r.bonusWinPct),
    note: 'Round 3/15, having won both the pistol and the round after it. Min. 15 such rounds (scaled down for a smaller filter scope).',
  },
  {
    key: 'antiEcoWinPct', title: 'Best anti-eco',
    sampleKey: 'antiEcoRounds', sampleMin: 10,
    meta: (r) => `${num(r.antiEcoRounds)} rds`, value: (r) => pct(r.antiEcoWinPct),
    note: 'Economy-based (eco/semi-buy vs. a full-buy opponent), any round. Min. 10 anti-eco rounds (scaled down for a smaller filter scope).',
  },
  {
    key: 'otWinPct', title: 'Best in overtime',
    sampleKey: 'otMaps', sampleMin: 4,
    meta: (r) => `${num(r.otMaps)} maps`, value: (r) => `${r.otWon}/${r.otMaps}`,
    note: 'Min. 4 maps that reached overtime (scaled down for a smaller filter scope).',
  },
  {
    key: 'comebackPct', title: 'Best comebacks',
    sampleKey: 'comebackMaps', sampleMin: 6,
    meta: (r) => `${num(r.comebackMaps)} maps`, value: (r) => `${r.comebackWon}/${r.comebackMaps}`,
    note: 'Faced a 3+ round deficit and still won the map. Min. 6 such maps (scaled down for a smaller filter scope).',
  },
  {
    key: 'elimPct', title: 'Most rounds won by elimination',
    sampleKey: 'mapsPlayed', sampleMin: 10,
    meta: (r) => `${num(r.mapsPlayed)} maps`, value: (r) => pct(r.elimPct),
    note: 'Share of round wins ending in a team wipe rather than defuse/detonation/time.',
  },
  {
    key: 'avgMapDurationSeconds', title: 'Longest maps on average',
    sampleKey: 'mapsWithDuration', sampleMin: 10,
    meta: (r) => `${num(r.mapsWithDuration)} maps`, value: (r) => duration(r.avgMapDurationSeconds),
    note: 'Min. 10 maps with a published duration (scaled down for a smaller filter scope).',
  },
  {
    key: 'roundsPerMap', title: 'Most rounds per map',
    sampleKey: 'mapsPlayed', sampleMin: 10,
    meta: (r) => `${num(r.mapsPlayed)} maps`, value: (r) => (r.roundsPerMap == null ? '—' : r.roundsPerMap.toFixed(1)),
    note: 'Closer maps run longer, on average, than blowouts. Min. 10 maps (scaled down for a smaller filter scope).',
  },
  {
    key: 'mapsPerSeries', title: 'Most maps per series',
    sampleKey: 'matchesPlayed', sampleMin: 5,
    meta: (r) => `${num(r.matchesPlayed)} series`, value: (r) => (r.mapsPerSeries == null ? '—' : r.mapsPerSeries.toFixed(2)),
    note: 'How often a team\u2019s series go the distance rather than getting swept. Min. 5 series.',
  },
]

export default function Teams() {
  const { data, loading } = useData('team_buckets')

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

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  const columns = [
    {
      key: 'team', label: 'Team', align: 'left',
      format: (v) => (
        <Link to={`/teams/${encodeURIComponent(v)}`} className="font-medium hover:text-accent-bright transition-colors">
          <TeamLogo team={v} size={24} />
        </Link>
      ),
    },
    { key: 'region', label: 'Region', align: 'left' },
    { key: 'matchesPlayed', label: 'Matches', align: 'right', format: (v) => num(v) },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'RND', align: 'right', format: (v) => num(v) },
    { key: 'matchWinPct', label: 'Match Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'avgRating', label: 'Avg Rating', align: 'right', colorScale: true, format: (v) => rating(v) },
    { key: 'pistolWinPct', label: 'Pistol Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'atkWinPct', label: 'ATK Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'defWinPct', label: 'DEF Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'otWinPct', label: 'OT Win%', align: 'right', colorScale: true, format: (v, r) => (r.otMaps ? `${r.otWon}/${r.otMaps}` : '—') },
    { key: 'avgMapDurationSeconds', label: 'Avg Map Time', align: 'right', colorScale: true, format: (v) => duration(v) },
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
          <DataTable columns={columns} rows={rows} defaultSortKey="matchWinPct" />

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="font-display text-sm font-semibold text-ink">Round-level leaders</h2>
              <p className="text-muted text-xs">
                Same filters as the table above. China-region matches carry no economy data,
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
                  rows={topBy(rows, c.key, {
                    qualify: dynamicQualify(rows, c.sampleKey, { fixed: c.sampleMin }),
                    invert: c.invert,
                  })}
                  renderEntity={(r) => (
                    <Link to={`/teams/${encodeURIComponent(r.team)}`} className="min-w-0">
                      <TeamLogo team={r.team} size={22} />
                    </Link>
                  )}
                  meta={c.meta}
                  value={c.value}
                  showRank
                />
              ))}
            </div>
          </div>

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
