import StageTabs from '../components/StageTabs'
import AgentOverview from '../components/AgentOverview'
import AgentCompositions from '../components/AgentCompositions'

/**
 * Agents -- two sub-tabs sharing this one route (no separate URL/nav item;
 * see project-history for why). "Overview" is the original pick-rate/map
 * win-rate page, driven by the pre-aggregated agents.json buckets.
 * "Compositions & win rates" is a heavier match-level join (match_results +
 * match_players, ~7.3MB combined) that StageTabs only mounts -- and
 * therefore only fetches -- once the user actually selects it.
 */
export default function Agents() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Agents</h1>
        <p className="text-muted text-sm mt-1">
          Pick rates, map performance and composition win rates, computed directly from per-map
          player data. Every filter below is multi-select and independent — combine them freely.
        </p>
      </div>

      <StageTabs
        defaultTabId="overview"
        tabs={[
          { id: 'overview', label: 'Overview', content: <AgentOverview /> },
          { id: 'compositions', label: 'Compositions & win rates', content: <AgentCompositions /> },
        ]}
      />
    </div>
  )
}
