import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, aggregatePlayerBuckets, groupByEntity } from '../lib/entityBuckets'
import DataTable from '../components/DataTable'
import FacetGroup from '../components/FacetGroup'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { rating, pct, num } from '../lib/format'

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

export default function Players() {
  const { data, loading } = useData('player_buckets')
  const [ratedOnly, setRatedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [minMaps, setMinMaps] = useState(0)

  const records = useMemo(() => (data ? expandBuckets(data, 'p') : []), [data])
  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const rows = useMemo(() => {
    if (!data) return []
    const grouped = groupByEntity(filtered)
    const out = []
    for (const [player, buckets] of grouped) {
      const meta = data.meta[player]
      if (!meta) continue
      const s = aggregatePlayerBuckets(buckets, { ratedOnly })
      if (!s || !s.mapsPlayed) continue
      if (s.mapsPlayed < minMaps) continue
      out.push({
        player,
        team: meta.team,
        region: meta.region,
        isChina: meta.isChina,
        countryCode: meta.countryCode,
        countryName: meta.countryName,
        ...s,
      })
    }
    const q = search.trim().toLowerCase()
    const searched = q
      ? out.filter((p) => p.player.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q))
      : out
    return searched.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
  }, [filtered, data, ratedOnly, search, minMaps])

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  const columns = [
    {
      key: 'player', label: 'Player', align: 'left', width: 190,
      format: (v, row) => (
        <div className="flex items-center gap-2">
          <Flag countryCode={row.countryCode} countryName={row.countryName} size={20} />
          <Link
            to={`/players/${encodeURIComponent(v)}`}
            className="font-body font-medium hover:text-accent-bright transition-colors"
          >
            {v}
          </Link>
        </div>
      ),
    },
    {
      key: 'team', label: 'Team', align: 'left', width: 200,
      format: (v) => (
        <Link to={`/teams/${encodeURIComponent(v)}`} className="hover:text-accent-bright transition-colors">
          <TeamLogo team={v} size={18} />
        </Link>
      ),
    },
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

  const renderers = { week: weekLabel, event: eventLabel }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Players</h1>
        <p className="text-muted text-sm mt-1">{rows.length} players shown</p>
      </div>

      <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="font-display text-sm font-semibold text-ink">Filters</span>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player or team…"
              className="bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:border-muted w-56"
            />
            {activeCount > 0 && (
              <button onClick={clearAll} className="text-xs text-accent-bright hover:underline">
                Clear all ({activeCount})
              </button>
            )}
          </div>
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

        <div className="flex items-center gap-5 flex-wrap pt-1">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={ratedOnly}
              onChange={(e) => setRatedOnly(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            Only maps with a Rating 2.0
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Min. maps
            <input
              type="number"
              min={0}
              value={minMaps}
              onChange={(e) => setMinMaps(Number(e.target.value) || 0)}
              className="bg-surface2 border border-hairline rounded-lg px-2 py-1 w-20 text-ink focus:outline-none focus:border-muted"
            />
          </label>
        </div>
      </div>

      <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
        China-region matches don't publish multi-kill, clutch, or economy data on VLR, so those
        columns read 0 for China players. A small number of China maps are also missing Rating 2.0 —
        by default they still count toward other stats, which can make a rating average cover fewer
        maps than the rest of the row; "Only maps with a Rating 2.0" makes every stat consistent.
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No players match this filter combination.</p>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} defaultSortKey="avgRating" />
      )}
    </div>
  )
}
