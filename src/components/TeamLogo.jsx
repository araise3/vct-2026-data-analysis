import teamLogos from '../lib/teamLogos.json'

export default function TeamLogo({ team, size = 20, showName = true, showTag = false }) {
  const entry = teamLogos[team]

  return (
    <span className="inline-flex items-center gap-2 min-w-0 align-middle">
      {entry?.logo ? (
        <img
          src={entry.logo}
          alt={team}
          className="object-contain shrink-0"
          style={{ width: size, height: size }}
          loading="lazy"
        />
      ) : (
        <span className="rounded shrink-0 bg-surface2" style={{ width: size, height: size }} />
      )}
      {showName && <span className="truncate">{team}</span>}
      {showTag && entry?.tag && (
        <span className={showName ? 'text-muted text-xs shrink-0' : 'truncate'}>{entry.tag}</span>
      )}
    </span>
  )
}
