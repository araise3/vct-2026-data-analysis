import { Link } from 'react-router-dom'
import { STAT_LIBRARY_GROUPS } from '../lib/statLibrary'
import { getStatisticById } from '../lib/statCatalog'
import { prefetchData } from '../lib/useData'

export default function Statistics() {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All statistics</h1>
        <p className="mt-1 text-sm text-muted">Choose a leaderboard, then filter it by event, date, region, and other available scopes.</p>
      </div>
      {STAT_LIBRARY_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`statistics-${group.id}`}>
          <h2 id={`statistics-${group.id}`} className="text-lg font-semibold">{group.label}</h2>
          <p className="mt-1 text-xs text-muted">{group.description}</p>
          <div className="statistics-links">
            {group.statistics.map((entry) => {
              const statistic = getStatisticById(entry.id.replace(/\.(longest|shortest)$/, ''))
              const order = new URLSearchParams(entry.search).get('order')
              return (
                <Link
                  key={entry.id}
                  to={`${statistic.to}${order ? `?order=${order}` : ''}`}
                  className="statistics-link"
                  onMouseEnter={() => entry.data.forEach(prefetchData)}
                  onFocus={() => entry.data.forEach(prefetchData)}
                >
                  <span>{entry.label}</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
