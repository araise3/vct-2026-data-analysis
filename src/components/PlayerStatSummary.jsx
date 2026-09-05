import { num, pct, rating } from '../lib/format'

export default function PlayerStatSummary({ perf, stats, actStats, showRanked, setStatSource }) {
  const fallbackMetrics = showRanked ? [
    { label: 'ADR', value: actStats?.adr, format: (value) => num(value, 1) },
    { label: 'K/D', value: actStats?.kd, format: (value) => num(value, 2) },
    { label: 'HS%', value: actStats?.hsPct, format: pct },
    { label: 'Win %', value: actStats?.winPct, format: pct },
  ] : [
    { label: 'Rating', value: stats.avgRating, format: rating },
    { label: 'K/D', value: stats.kd, format: (value) => num(value, 2) },
    { label: 'HS%', value: stats.avgHsPct, format: pct },
    { label: 'Win %', value: stats.winPct, format: pct },
  ]
  const metrics = perf?.pills || fallbackMetrics
  const wins = showRanked ? actStats?.wins : stats.mapsWon
  const losses = showRanked ? actStats?.losses : stats.mapsLost

  return (
    <section aria-label="Performance summary" className="border-y border-hairline py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Performance summary</h2>
        {actStats && <div className="flex gap-1" aria-label="Statistics population">
          {[{ id: 'pro', label: 'Pro matches' }, { id: 'ranked', label: 'Ranked account' }].map((option) => (
            <button key={option.id} type="button" aria-pressed={(option.id === 'ranked') === showRanked} onClick={() => setStatSource(option.id)} className={`rounded px-3 py-1.5 text-xs ${(option.id === 'ranked') === showRanked ? 'bg-selected text-white' : 'text-muted hover:bg-surface2'}`}>{option.label}</button>
          ))}
        </div>}
      </div>
      <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="border-l border-hairline px-4 first:border-l-0 first:pl-0">
            <p className="text-xs text-muted">{metric.label}</p>
            <p className="my-1 text-2xl font-semibold tabular-nums tracking-tight">{metric.value == null ? '—' : metric.format(metric.value)}</p>
            {metric.percentile != null && <p className="text-[11px] text-muted">Top {Math.max(0.1, 100 - metric.percentile).toFixed(1)}%</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{num(wins)} wins · {num(losses)} losses{showRanked && actStats?.draws ? ` · ${num(actStats.draws)} draws` : ''}</span>
        <span>{showRanked ? `Act ${actStats?.actShort || '—'} · solo queue` : `${num(stats.mapsPlayed)} maps · ${num(stats.roundsPlayed)} rounds`}</span>
        {showRanked && actStats?.rank && <span>{actStats.rank.tier} · {num(actStats.rank.rr)} RR{actStats.rank.leaderboardRank != null ? ` · #${num(actStats.rank.leaderboardRank)} leaderboard` : ''}</span>}
      </div>
      {showRanked && <p className="mt-2 text-xs text-muted">Ranked statistics describe the linked account, not professional matches. Percentiles compare tracked accounts from the same act, not the full player base.</p>}
      {perf ? <details className="mt-4 border-t border-hairline pt-3 text-xs">
        <summary className="w-fit cursor-pointer text-muted">Percentile breakdown · composite {perf.score}/1000</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {perf.scoreMetrics.map((metric) => <div key={metric.statKey} className="flex justify-between gap-3"><span className="text-muted">{metric.label}</span><span className="tabular-nums">{metric.format(metric.value)} <span className="text-muted">· P{num(metric.percentile, 1)}</span></span></div>)}
        </div>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted">Composite = mean of the available metric percentiles × 10. {showRanked ? 'Compared with tracked ranked accounts in the same act.' : 'Compared with qualified players in the selected scope.'} Missing metrics are excluded. This is a portal calculation, not an official rating.</p>
      </details> : <p className="mt-3 text-xs text-muted">Insufficient comparable data for percentiles. Raw statistics are shown above.</p>}
    </section>
  )
}
