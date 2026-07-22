import agentIcons from '../lib/agentIcons.json'

function luminance(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export default function AgentIcon({ agent, size = 20, showName = true }) {
  const key = agent?.toLowerCase().replace(/[^a-z0-9]/g, '')
  const entry = agentIcons[key]
  const color = entry?.visualColor || entry?.sampledColor || entry?.outlineColor || entry?.color || '#8A8F98'
  const textColor = luminance(color) > 0.5 ? '#131619' : '#ffffff'

  return (
    <span className="inline-flex items-center gap-1.5">
      {showName && (
        <span
          className="h-6 rounded-lg px-2.5 flex items-center text-sm font-semibold whitespace-nowrap"
          style={{ backgroundColor: color, color: textColor }}
        >
          {entry?.displayName || agent}
        </span>
      )}
      <span
        className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: color }}
      >
        {entry ? (
          <img
            src={entry.icon}
            alt={entry.displayName}
            width={size}
            height={size}
            className="object-contain"
            loading="lazy"
          />
        ) : null}
      </span>
    </span>
  )
}
