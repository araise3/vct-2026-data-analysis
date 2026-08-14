import StageTabs from '../components/StageTabs'
import AgentOverview from '../components/AgentOverview'
import AgentImpact from '../components/AgentImpact'

/**
 * Agents -- two sub-tabs sharing this one route. "Overview" is the
 * original pick-rate/map win-rate page, driven by the pre-aggregated
 * agents.json buckets. "Agent impact" is a heavier match-level join
 * (match_results + match_players + team_map_detail, ~10.4MB combined) that
 * StageTabs only mounts -- and therefore only fetches -- once the user
 * actually selects it.
 *
 * Most-played compositions used to be a third table under this same join,
 * sharing this tab with Agent impact and Role signatures; split out to its
 * own top-level Compositions page/nav item per direct request, so
 * "Compositions" always means just the composition list and this tab
 * always means per-agent/role-shape numbers.
 */
export default function Agents() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Agents</h1>
        <p className="text-muted text-sm mt-1">
          Pick rates, map performance and per-agent impact, computed directly from per-map
          player data. Every filter below is multi-select and independent — combine them freely.
        </p>
      </div>

      <StageTabs
        defaultTabId="overview"
        tabs={[
          { id: 'overview', label: 'Overview', content: <AgentOverview /> },
          { id: 'impact', label: 'Agent impact', content: <AgentImpact /> },
        ]}
      />
    </div>
  )
}
