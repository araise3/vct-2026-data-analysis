export default function RankedList({ title, rows, renderRow }) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-5">
      <h3 className="font-display text-sm font-semibold text-ink mb-4 tracking-wide">{title}</h3>
      <div className="flex flex-col gap-1">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-surface2 transition-colors"
          >
            <span className="font-mono text-xs text-muted w-5 text-right shrink-0">{i + 1}</span>
            {renderRow(row)}
          </div>
        ))}
      </div>
    </div>
  )
}
