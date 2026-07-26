import { useMemo, useState } from 'react'

/**
 * Gantt-style "who was on the roster when" chart -- one row per
 * person, one horizontal bar per stint (someone who left and later
 * rejoined gets two separate bars on their own row, not one bar
 * spanning the gap).
 *
 * timeline: [{ id, name, type: 'player'|'coach',
 *              status: 'active'|'inactive'|'former',
 *              joinDate, leaveDate }]
 * -- straight from public/data/liquipedia_rosters.json, both players
 * and coaches combined onto one chart since both are "who's part of
 * the team" in the sense this chart is about.
 *
 * Rendered as inline SVG with a viewBox, matching TrendChart's
 * conventions elsewhere on this site (no fixed width, scales to its
 * container).
 *
 * "Last year" / "All time" toggle, defaulting to Last year: some teams
 * have 40+ historical entries once every stint is counted, and the
 * full history back to a team's founding is a lot of visual noise for
 * the common case of "who's been around recently".
 */
export default function RosterTimeline({ timeline }) {
  const [range, setRange] = useState('year') // 'year' | 'all'

  const rows = useMemo(() => {
    if (!timeline?.length) return []
    // Group by id -- each person is one row, possibly multiple stints.
    const byId = new Map()
    for (const t of timeline) {
      if (!t.joinDate || !/^\d{4}-\d{2}-\d{2}$/.test(t.joinDate)) continue // skip partial/missing dates
      const key = t.id.toLowerCase()
      if (!byId.has(key)) byId.set(key, { id: t.id, name: t.name, type: t.type, stints: [] })
      const leaveDate = t.leaveDate && /^\d{4}-\d{2}-\d{2}$/.test(t.leaveDate) ? t.leaveDate : null
      byId.get(key).stints.push({ start: t.joinDate, end: leaveDate, status: t.status })
    }
    return [...byId.values()].sort((a, b) => {
      const aStart = Math.min(...a.stints.map((s) => new Date(s.start).getTime()))
      const bStart = Math.min(...b.stints.map((s) => new Date(s.start).getTime()))
      return aStart - bStart
    })
  }, [timeline])

  const today = new Date()
  const windowStart = range === 'year'
    ? new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
    : null

  const visibleRows = useMemo(() => {
    if (!windowStart) return rows
    // Keep a row if ANY of its stints overlap the visible window at all.
    return rows.filter((r) =>
      r.stints.some((s) => (s.end ? new Date(s.end) : today) >= windowStart)
    )
  }, [rows, windowStart])

  if (visibleRows.length === 0) {
    return <p className="text-muted text-sm">Not enough dated roster history to plot a timeline.</p>
  }

  const allStarts = rows.flatMap((r) => r.stints.map((s) => new Date(s.start).getTime()))
  const rangeStart = windowStart ? windowStart.getTime() : Math.min(...allStarts)
  const rangeEnd = today.getTime()

  const W = 700
  const rowH = 26
  const pad = { l: 96, r: 12, t: 28, b: 8 }
  const H = pad.t + pad.b + visibleRows.length * rowH

  const x = (dateStr) => {
    const t = Math.max(rangeStart, Math.min(rangeEnd, new Date(dateStr).getTime()))
    return pad.l + ((t - rangeStart) / (rangeEnd - rangeStart)) * (W - pad.l - pad.r)
  }

  // Month gridlines/labels across the visible span.
  const months = []
  const cursor = new Date(rangeStart)
  cursor.setDate(1)
  while (cursor.getTime() <= rangeEnd) {
    months.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const monthFmt = (d) => d.toLocaleDateString('en-US', { month: 'short' })

  const STATUS_COLOR = {
    active: '#FF4655',   // accent -- current starter
    inactive: '#9b9c9e', // muted -- current, but benched
    former: '#4a4d55',   // dim -- no longer on the team
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <div className="flex rounded-lg overflow-hidden border border-hairline w-fit">
          {['year', 'all'].map((v) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={`px-3 py-1 text-xs font-medium capitalize transition-colors ${
                range === v ? 'bg-accent text-white' : 'bg-surface2 text-muted hover:text-ink'
              }`}
            >
              {v === 'year' ? 'Last year' : 'All time'}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {months.map((m, i) => {
          const cx = x(m.toISOString().slice(0, 10))
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={pad.t} y2={H - pad.b} stroke="currentColor" className="text-hairline" strokeWidth="1" />
              <text x={cx} y={pad.t - 8} textAnchor="middle" className="fill-current text-muted" style={{ fontSize: 9 }}>
                {monthFmt(m)}{m.getMonth() === 0 ? ` '${String(m.getFullYear()).slice(2)}` : ''}
              </text>
            </g>
          )
        })}
        <line x1={x(today.toISOString().slice(0, 10))} x2={x(today.toISOString().slice(0, 10))}
              y1={pad.t} y2={H - pad.b} stroke="currentColor" className="text-ink/40" strokeWidth="1" strokeDasharray="2 2" />

        {visibleRows.map((r, i) => {
          const cy = pad.t + i * rowH + rowH / 2
          return (
            <g key={r.id}>
              <text x={pad.l - 8} y={cy + 3} textAnchor="end" className="fill-current text-ink/80" style={{ fontSize: 10 }}>
                {r.name || r.id}
              </text>
              {r.stints.map((s, j) => {
                const x1 = x(s.start)
                const x2 = s.end ? x(s.end) : x(today.toISOString().slice(0, 10))
                return (
                  <rect
                    key={j}
                    x={x1} y={cy - 5} width={Math.max(2, x2 - x1)} height={10} rx={2}
                    fill={STATUS_COLOR[s.status] || STATUS_COLOR.former}
                  >
                    <title>{`${r.name || r.id}: ${s.start} \u2013 ${s.end || 'present'} (${s.status})`}</title>
                  </rect>
                )
              })}
            </g>
          )
        })}
      </svg>

      <div className="flex items-center gap-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR.active }} />Active</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR.inactive }} />Inactive</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR.former }} />Former</span>
      </div>
    </div>
  )
}
