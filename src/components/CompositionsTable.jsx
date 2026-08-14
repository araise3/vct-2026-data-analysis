import AgentIcon from './AgentIcon'
import DataTable from './DataTable'
import { pct, num } from '../lib/format'

/**
 * Most-played 5-agent compositions table -- the shared shape between the
 * Compositions page (AgentCompositions.jsx) and a single team's own
 * Compositions section on its profile page (TeamProfile.jsx), both of which
 * feed it rows already produced by lib/compositions.js's
 * aggregateCompositions() (and already capped/sliced by the caller -- this
 * component doesn't apply its own limit).
 *
 * renderExpanded is optional and passed straight through to DataTable (see
 * its own comment) -- only TeamProfile.jsx uses it, for its per-composition
 * player breakdown; the Compositions page leaves it unset and gets the
 * plain table with no expand arrows. expandKey is always the composition's
 * own `key` (map + sorted comp, already unique -- see aggregateCompositions)
 * rather than row index, since DataTable's rows can be re-sorted by any
 * column and a row index would point at a different composition after a
 * re-sort, silently closing (or worse, misattributing) an open row.
 */
export default function CompositionsTable({ rows, hiddenCount, renderExpanded }) {
  const columns = [
    {
      key: 'compLabel', label: 'Composition', align: 'left', noPadding: true,
      format: (v, row) => (
        <span className="flex items-center gap-1 px-3 py-1">
          {row.comp.map((a, i) => <AgentIcon key={`${a}-${i}`} agent={a} size={22} />)}
        </span>
      ),
    },
    { key: 'games', label: 'Games', align: 'right', format: (v) => num(v) },
    { key: 'share', label: 'Share', align: 'right', colorScale: true, format: (v) => pct(v, 1) },
    { key: 'winPct', label: 'Win%', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    {
      key: 'rd', label: 'RD', align: 'right', colorScale: true,
      format: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`),
    },
  ]

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        defaultSortKey="games"
        renderExpanded={renderExpanded}
        expandKey={renderExpanded ? (row) => row.key : undefined}
      />
      {hiddenCount > 0 && (
        <p className="text-muted text-xs">
          {hiddenCount} more composition{hiddenCount === 1 ? '' : 's'} not shown.
        </p>
      )}
    </>
  )
}
