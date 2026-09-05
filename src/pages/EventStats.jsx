import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandBuckets, aggregateTeamBuckets } from '../lib/entityBuckets'
import { eventLabel, num, pct, rating } from '../lib/format'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import DataTable from '../components/DataTable'

function EventStatistics({ event }) {
  const { data, loading, error } = useData('team_buckets')
  const records = useMemo(() => data ? expandBuckets(data, 't') : [], [data])
  const filters = useFacetedFilter(records, FACETS, event ? { event: [event] } : { competition: ['VCT'], year: [2026] })
  const rows = useMemo(() => {
    const groups = new Map()
    for (const bucket of filters.filtered) {
      const key = JSON.stringify([bucket.event, bucket.t])
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(bucket)
    }
    return [...groups.entries()].map(([key, buckets]) => ({
      key, event: buckets[0].event, team: buckets[0].t,
      ...aggregateTeamBuckets(buckets),
    })).filter((row) => row.mapsPlayed > 0)
  }, [filters.filtered])

  if (error) return <p role="alert">Event statistics could not be loaded. Please refresh to try again.</p>
  if (loading) return <p role="status" className="text-sm text-muted">Loading event statistics…</p>

  const columns = [
    { key: 'event', label: 'Event', format: (value) => <Link to={`/tournaments/${encodeURIComponent(value)}`} className="hover:text-accent">{eventLabel(value)}</Link> },
    { key: 'team', label: 'Team', format: (value) => <Link to={`/teams/${encodeURIComponent(value)}`} className="font-medium hover:text-accent">{value}</Link> },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (value) => num(value) },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (value) => num(value) },
    { key: 'mapWinPct', label: 'Map win %', align: 'right', format: (value) => pct(value) },
    { key: 'atkWinPct', label: 'Attack %', align: 'right', format: (value) => pct(value) },
    { key: 'defWinPct', label: 'Defence %', align: 'right', format: (value) => pct(value) },
    { key: 'pistolWinPct', label: 'Pistol %', align: 'right', format: (value) => pct(value) },
    { key: 'avgRating', label: 'Rating', align: 'right', format: (value) => rating(value) },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">{event ? eventLabel(event) : 'Event statistics'}</h1><p className="mt-1 text-sm text-muted">Team performance within each event. Completed maps only.</p></div>
      <FilterPanel {...filters} summary={`${rows.length} team–event records`} />
      <DataTable columns={columns} rows={rows} defaultSortKey="mapsPlayed" />
      <p className="text-xs text-muted">Rates use summed counts within the selected scope. Attack and defence exclude overtime; missing statistics are shown as a dash.</p>
    </div>
  )
}

export default function EventStats() {
  const { event } = useParams()
  return <EventStatistics key={event || 'all'} event={event} />
}
