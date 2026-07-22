import agentIcons from '../lib/agentIcons.json'

export default function AgentIcon({ agent, size = 20, showName = true }) {
  const key = agent?.toLowerCase().replace(/[^a-z0-9]/g, '')
  const entry = agentIcons[key]

  return (
    <span className="inline-flex items-center gap-2">
      {entry ? (
        <img
          src={entry.icon}
          alt={entry.displayName}
          width={size}
          height={size}
          className="rounded-md shrink-0 bg-surface2"
          loading="lazy"
        />
      ) : (
        <span className="rounded-md shrink-0 bg-surface2" style={{ width: size, height: size }} />
      )}
      {showName && <span>{entry?.displayName || agent}</span>}
    </span>
  )
}
