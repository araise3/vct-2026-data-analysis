export default function HorizontalBarChart({ data, labelKey, valueKey, formatValue, max, renderLabel }) {
  const maxVal = max ?? Math.max(...data.map((d) => d[valueKey] ?? 0), 0.0001)
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d, i) => {
        const value = d[valueKey] ?? 0
        const widthPct = Math.max(2, (value / maxVal) * 100)
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted w-32 shrink-0 truncate text-right">
              {renderLabel ? renderLabel(d) : d[labelKey]}
            </span>
            <div className="flex-1 h-6 bg-surface2 rounded-lg overflow-hidden">
              <div
                className="h-full rounded-lg bg-accent/70 flex items-center justify-end pr-2 transition-all"
                style={{ width: `${widthPct}%` }}
              >
                <span className="font-body text-[11px] text-base font-medium">
                  {formatValue ? formatValue(value) : value}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
