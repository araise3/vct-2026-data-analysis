import teamLogos from '../lib/teamLogos.json'

export default function TeamLogo({ team, size = 20, showName = true, showTag = false, showBg = true }) {
  const entry = teamLogos[team]

  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {entry?.logo ? (
        showBg ? (
          <span
            className="rounded shrink-0 flex items-center justify-center bg-white/90 p-0.5"
            style={{ width: size, height: size }}
          >
            <img
              src={entry.logo}
              alt={team}
              className="object-contain w-full h-full"
              loading="lazy"
            />
          </span>
        ) : (
          <img
            src={entry.logo}
            alt={team}
            width={size}
            height={size}
            className="object-contain shrink-0"
            loading="lazy"
          />
        )
      ) : (
        <span className="rounded shrink-0 bg-surface2" style={{ width: size, height: size }} />
      )}
      {showName && <span className="truncate">{team}</span>}
      {showTag && entry?.tag && <span className="text-muted text-xs shrink-0">{entry.tag}</span>}
    </span>
  )
}
