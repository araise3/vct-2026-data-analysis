import { useState } from 'react'
import { useData } from '../lib/useData'
import StackedBar from '../components/StackedBar'
import FilterChips from '../components/FilterChips'
import { pct } from '../lib/format'

export default function Economy() {
  const { data, loading } = useData('economy')
  const [region, setRegion] = useState('Overall')

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const regionOptions = ['Overall', ...Object.keys(data.byRegion)]
  const tiers = region === 'Overall' ? data.overall : data.byRegion[region]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Economy</h1>
        <p className="text-muted text-sm mt-1">
          Round buy-type distribution and win rates. China isn't included — VLR doesn't publish
          economy data for that region.
        </p>
      </div>

      <FilterChips options={regionOptions} value={region} onChange={setRegion} />

      <div className="bg-surface border border-hairline rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-ink mb-5">Round buy-type distribution</h3>
        <StackedBar tiers={tiers} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(tiers).map(([key, t]) => (
          <div key={key} className="bg-surface border border-hairline rounded-2xl px-5 py-4">
            <div className="text-muted text-xs uppercase tracking-wide mb-1">{tierLabel(key)}</div>
            <div className="font-display text-2xl font-semibold text-ink">
              {t.winPct !== null ? pct(t.winPct) : '—'}
            </div>
            <div className="text-muted text-xs mt-1">win rate · {t.rounds.toLocaleString()} rounds</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted leading-relaxed">
        Round counts and win rates are aggregated directly from VLR's per-map economy tables.
        A round's buy tier is VLR's own classification (loadout value at the round's start), and
        pistol rounds are counted within the "Eco" tier since a pistol buy is dollar-wise an eco
        round — VLR doesn't separately tally pistol-round totals.
      </p>
    </div>
  )
}

function tierLabel(key) {
  const labels = { eco: 'Eco ($0-5K)', semiEco: 'Semi-eco ($5-10K)', semiBuy: 'Semi-buy ($10-20K)', fullBuy: 'Full buy ($20K+)' }
  return labels[key] || key
}
