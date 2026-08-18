import rankIcons from '../lib/rankIcons.json'

export default function RankIcon({ tier, size = 20 }) {
  const key = tier?.toLowerCase().trim()
  const entry = rankIcons[key]
  if (!entry) return null

  return (
    <img
      src={entry.icon}
      alt={entry.displayName || tier}
      width={size}
      height={size}
      className="object-contain shrink-0"
      loading="lazy"
    />
  )
}
