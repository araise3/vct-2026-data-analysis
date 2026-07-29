import agentIcons from '../lib/agentIcons.json'

export default function AgentIcon({ agent, size = 20 }) {
  const key = agent?.toLowerCase().replace(/[^a-z0-9]/g, '')
  const entry = agentIcons[key]
  if (!entry) return null

  return (
    <img
      src={entry.icon}
      alt={entry.displayName || agent}
      width={size}
      height={size}
      className="object-contain shrink-0"
      loading="lazy"
    />
  )
}
