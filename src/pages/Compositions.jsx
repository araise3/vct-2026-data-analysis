import { Link } from 'react-router-dom'
import AgentCompositions from '../components/AgentCompositions'

/**
 * Compositions -- its own top-level nav item/route. Used to be a sub-tab of
 * the Agents page (see that page's own comment); split out so it can be
 * linked to directly rather than requiring a click into Agents first.
 *
 * Compositions ONLY, per direct request -- per-agent pick/impact splits and
 * role-shape trends (which used to sit alongside the composition list here)
 * moved to the Agents page's own "Agent impact" tab instead.
 */
export default function Compositions() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Compositions</h1>
        <p className="text-muted text-sm mt-1">
          Most-played per-map 5-agent compositions and their win rates, computed directly from
          match-level data. Every filter below is multi-select and independent — combine them
          freely. For per-agent pick rate and performance, see the{' '}
          <Link to="/agents" className="text-accent-bright hover:underline">Agents</Link> page's
          Agent impact tab.
        </p>
      </div>

      <AgentCompositions />
    </div>
  )
}
