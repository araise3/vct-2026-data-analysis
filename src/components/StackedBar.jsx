const TIER_COLORS = {
  eco: '#6B7280',
  semiEco: '#4C7A9E',
  semiBuy: '#ffd47d',
  fullBuy: '#4ac97e',
}

const TIER_LABELS = {
  eco: 'Eco ($0-5K)',
  semiEco: 'Semi-eco ($5-10K)',
  semiBuy: 'Semi-buy ($10-20K)',
  fullBuy: 'Full buy ($20K+)',
}

export default function StackedBar({ tiers }) {
  const total = Object.values(tiers).reduce((s, t) => s + (t.rounds || 0), 0)
  return (
    <div>
      <div className="h-10 rounded-xl overflow-hidden flex border border-hairline">
        {Object.entries(tiers).map(([key, t]) => {
          const widthPct = total ? (t.rounds / total) * 100 : 0
          if (widthPct === 0) return null
          return (
            <div
              key={key}
              style={{ width: `${widthPct}%`, backgroundColor: TIER_COLORS[key] }}
              title={`${TIER_LABELS[key]}: ${t.rounds} rounds`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
        {Object.entries(tiers).map(([key, t]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: TIER_COLORS[key] }} />
            <span className="text-muted">{TIER_LABELS[key]}</span>
            <span className="font-body text-ink">
              {t.rounds.toLocaleString()} rounds · {t.winPct !== null ? `${(t.winPct * 100).toFixed(1)}%` : '—'} won
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
