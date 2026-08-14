import Card from './ui/Card'

export default function KpiCard({ label, value, sub }) {
  return (
    <Card className="px-6 py-5 flex flex-col gap-1">
      <span className="text-muted text-xs font-medium tracking-wide uppercase">{label}</span>
      <span className="font-display text-3xl font-semibold text-ink">{value}</span>
      {sub && <span className="text-muted text-xs">{sub}</span>}
    </Card>
  )
}
