import { useMemo } from 'react'
import { shortDate } from '../lib/format'

/**
 * `patchStart`/`patchEnd` -> a compact label ("12.06 – 12.08", or just
 * "12.00" when the event never left its starting patch, or "TBD" when
 * Liquipedia hasn't recorded one yet).
 */
function patchLabel(r) {
  if (!r.patchStart) return 'TBD'
  return r.patchStart === r.patchEnd ? r.patchStart : `${r.patchStart} – ${r.patchEnd}`
}

/**
 * View 1 of the /patches page: patch releases (vertical lines) drawn across
 * every 2026 event's date range (horizontal bars), one row per event, each
 * bar labelled with the patch(es) Liquipedia's own event page records it as
 * having actually been played on (`r.patchStart`/`r.patchEnd`) -- ground
 * truth, not a guess from which vertical lines happen to cross the bar. The
 * lines stay: they still show the season's release cadence and are what
 * `onSelectPatch` uses to surface a patch's own change list below.
 *
 * No lane-packing -- at n=16 events with regions deliberately running
 * concurrent splits, every event gets its own row; the overlap between rows
 * (Americas/EMEA/Pacific/China all mid-split at once) is the point of this
 * view, not something to hide by packing bars into shared lanes.
 */
export default function PatchTimeline({ rows, patches, domain, selectedVersion, onSelectPatch }) {
  // r=70 (not the old 12) leaves room to the right of the latest bar for
  // its own patch-range label ("12.06 – 12.08" at 9px is ~55px wide) --
  // without it, whichever event's bar reaches the domain's own max date
  // (Champions 2026 currently) would have its label clipped by the viewBox.
  const pad = { l: 150, r: 70, t: 40, b: 16 }
  const rowH = 22
  const W = 1000
  const H = rows.length * rowH + pad.t + pad.b

  const x = useMemo(() => {
    if (!domain) return () => pad.l
    const [minD, maxD] = domain
    const tMin = new Date(minD).getTime()
    const tMax = new Date(maxD).getTime()
    const span = tMax - tMin || 1
    return (dateStr) => pad.l + ((new Date(dateStr).getTime() - tMin) / span) * (W - pad.l - pad.r)
  }, [domain])

  if (!rows.length || !domain) {
    return <p className="text-muted text-xs">Not enough dated data to plot the timeline.</p>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {rows.map((r, i) => {
        const y = pad.t + i * rowH
        const x1 = r.startDate ? x(r.startDate) : pad.l
        const x2 = r.endDate ? x(r.endDate) : W - pad.r
        return (
          <g key={r.name}>
            <text
              x={pad.l - 10} y={y + rowH / 2 + 3} textAnchor="end"
              className="fill-current text-muted" style={{ fontSize: 9 }}
            >
              {r.name.length > 26 ? `${r.name.slice(0, 25)}…` : r.name}
            </text>
            <rect
              x={x1} y={y + 3} width={Math.max(2, x2 - x1)} height={rowH - 9}
              rx="3" className="fill-surface2"
            />
            <rect x={x1} y={y + 3} width="3" height={rowH - 9} className="fill-accent" />
            <text
              x={x2 + 6} y={y + rowH / 2 + 3}
              className={`fill-current ${r.patchStart ? 'text-muted' : 'text-muted/50 italic'}`}
              style={{ fontSize: 9 }}
            >
              {patchLabel(r)}
            </text>
            <title>
              {`${r.name}: ${shortDate(r.startDate) || '?'} – ${shortDate(r.endDate) || '?'}\n`}
              {r.patchStart
                ? `Played on patch ${patchLabel(r)} (per Liquipedia)`
                : 'Patch not yet recorded on Liquipedia'}
            </title>
          </g>
        )
      })}

      {(patches || []).map((p) => {
        const lx = x(p.date)
        const selected = p.version === selectedVersion
        return (
          <g
            key={p.version}
            role="button"
            tabIndex={0}
            onClick={() => onSelectPatch(p.version)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectPatch(p.version) }}
            className="cursor-pointer outline-none"
          >
            <line
              x1={lx} x2={lx} y1={pad.t - 14} y2={H - pad.b}
              stroke="currentColor"
              strokeWidth={selected ? 2.5 : 1.5}
              strokeDasharray={p.notable ? undefined : '3 3'}
              className={p.notable ? 'text-accent' : 'text-muted'}
              opacity={selected ? 1 : p.notable ? 0.85 : 0.5}
            />
            <text
              x={lx} y={pad.t - 18} textAnchor="middle"
              className={`fill-current ${selected ? 'text-accent-bright font-semibold' : p.notable ? 'text-accent' : 'text-muted'}`}
              style={{ fontSize: 9 }}
            >
              {p.version}
            </text>
            <title>{`v${p.version} — ${shortDate(p.date)} (${(p.agentChanges?.length || 0) + (p.mapChanges?.length || 0)} changes)`}</title>
          </g>
        )
      })}
    </svg>
  )
}
