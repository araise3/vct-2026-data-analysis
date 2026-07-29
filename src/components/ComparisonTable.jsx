import { pct, num } from '../lib/format'

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd". */
function ordinal(n) {
  if (n == null) return '—'
  // 11/12/13 are the exception to the last-digit rule in every century.
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

/**
 * Rank badge colour: top decile of the peer group reads green, bottom
 * quarter reads red, everything between is neutral. Deliberately relative
 * to the group SIZE rather than fixed cutoffs -- "8th" is excellent among
 * 90 players and unremarkable among 10.
 */
function rankTone(rank, total) {
  if (rank == null || !total) return 'text-muted bg-surface2'
  const q = rank / total
  if (q <= 0.1) return 'text-good bg-good/10'
  if (q <= 0.35) return 'text-ink bg-surface2'
  if (q >= 0.75) return 'text-bad bg-bad/10'
  return 'text-muted bg-surface2'
}

function formatStat(v, stat) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (stat.pct) return pct(v)
  return num(v, stat.digits ?? 2)
}

/**
 * Player-vs-peers stat table, modelled on rft.gg's "<player>'s
 * Performances" panel: one row per stat, showing the player's value
 * against the peer median plus their rank within the group.
 *
 * Rendered as a real <table> rather than a grid so the three columns stay
 * aligned as values change width, and so it degrades sanely on mobile
 * inside the same overflow-x wrapper every other table on the site uses.
 */
export default function ComparisonTable({ playerName, peerLabel, rows, peerCount }) {
  return (
    <div className="overflow-auto rounded-2xl border border-hairline">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-surface2">
            <th className="px-5 py-3 text-left font-medium text-xs uppercase tracking-wide text-muted border-r border-b border-hairline">
              Stat
            </th>
            <th className="px-5 py-3 text-right font-medium text-xs uppercase tracking-wide text-ink border-r border-b border-hairline whitespace-nowrap">
              {playerName}
            </th>
            <th className="px-5 py-3 text-right font-medium text-xs uppercase tracking-wide text-ink border-b border-hairline whitespace-nowrap">
              {peerLabel}
              <span className="ml-1 normal-case tracking-normal text-muted">
                (median of {peerCount})
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // "Better" is direction-aware: for first deaths per round a
            // LOWER number than the peer median is the good outcome.
            const better =
              r.value != null && r.peer != null
                ? (r.invert ? r.value < r.peer : r.value > r.peer)
                : null
            return (
              <tr key={r.key} className="hover:bg-surface/60 transition-colors">
                <td className="px-5 py-2.5 text-left font-body text-[13px] text-ink border-r border-b border-hairline">
                  <span className="flex items-center gap-2">
                    {r.label}
                    <span
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${rankTone(r.rank, r.peerCount)}`}
                      title={`Rank ${ordinal(r.rank)} of ${r.peerCount} qualified players`}
                    >
                      {ordinal(r.rank)}
                    </span>
                  </span>
                </td>
                <td
                  className={`px-5 py-2.5 text-right font-body text-[13px] font-medium border-r border-b border-hairline whitespace-nowrap ${
                    better === null ? 'text-ink' : better ? 'text-good' : 'text-bad'
                  }`}
                >
                  {formatStat(r.value, r)}
                </td>
                <td className="px-5 py-2.5 text-right font-body text-[13px] text-ink border-b border-hairline whitespace-nowrap">
                  {formatStat(r.peer, r)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
