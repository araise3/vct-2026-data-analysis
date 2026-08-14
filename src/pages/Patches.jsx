import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../lib/useData'
import { buildTimelineRows } from '../lib/patchNotes'
import PatchTimeline from '../components/PatchTimeline'
import AgentPatchTrend from '../components/AgentPatchTrend'
import AgentIcon from '../components/AgentIcon'
import agentIcons from '../lib/agentIcons.json'
import { shortDate } from '../lib/format'

const AGENT_NAMES = new Set(Object.values(agentIcons).map((a) => a.displayName))
const DEFAULT_AGENT = 'Jett'

// Agent-change types (buff/nerf/adjust/rework/new) and map-pool-change
// types (added/removed/reworked) share this one badge component -- neither
// set overlaps the other's keys, so one lookup table covers both.
const TYPE_TONE = {
  buff: 'text-good bg-good/10',
  nerf: 'text-bad bg-bad/10',
  adjust: 'text-muted bg-surface2',
  rework: 'text-accent-bright bg-accent/10',
  new: 'text-accent-bright bg-accent/10',
  added: 'text-good bg-good/10',
  removed: 'text-bad bg-bad/10',
  reworked: 'text-accent-bright bg-accent/10',
}

function TypeBadge({ type }) {
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${TYPE_TONE[type] || 'text-muted bg-surface2'}`}>
      {type}
    </span>
  )
}

/**
 * /patches -- patch releases plotted against 2026 event date ranges
 * (PatchTimeline), plus a per-agent pick/win-rate trend across patch
 * windows (AgentPatchTrend). New top-level route rather than a tab under
 * /agents or a section of /tournaments: /tournaments is already a dense
 * three-column grid with no room for a full-width timeline, and "patch
 * notes" isn't something someone browsing the Agents tab would think to
 * look for there.
 *
 * `patch_notes` and `event_meta` are both small and load on mount;
 * `player_agents` (9.57MB) is NOT fetched here -- AgentPatchTrend pulls it
 * itself, on idle, exactly like Players.jsx already does for the same file.
 * TopNav's own prefetch list for this route deliberately omits it for the
 * same reason.
 */
export default function Patches() {
  const { data: patchData, loading: patchLoading } = useData('patch_notes')
  const { data: eventMetaData, loading: eventLoading } = useData('event_meta')
  const [searchParams, setSearchParams] = useSearchParams()

  const patches = patchData?.patches || []

  const [selectedVersion, setSelectedVersion] = useState(null)
  const activeVersion = useMemo(() => {
    if (selectedVersion) return selectedVersion
    const notable = patches.filter((p) => p.notable)
    return (notable[notable.length - 1] || patches[patches.length - 1])?.version ?? null
  }, [selectedVersion, patches])

  const selectedPatch = patches.find((p) => p.version === activeVersion) || null

  const agentParam = searchParams.get('agent')
  const agent = AGENT_NAMES.has(agentParam) ? agentParam : DEFAULT_AGENT
  function handleAgentChange(next) {
    const params = new URLSearchParams(searchParams)
    params.set('agent', next)
    setSearchParams(params, { replace: true })
  }

  const { rows, domain } = useMemo(
    () => buildTimelineRows(eventMetaData?.events, undefined, patches),
    [eventMetaData, patches]
  )

  if (patchLoading || eventLoading || !patchData) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Patches</h1>
        <p className="text-muted text-sm mt-1">
          Every VALORANT patch since v11.10 (2025-11-11), and how each agent's pick/win rate
          actually moved across them. Each event below is labelled with the patch(es) it was
          actually played on, per Liquipedia's own event pages — not inferred from which patch
          happened to release during its date range.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-4 overflow-x-auto">
          <PatchTimeline
            rows={rows}
            patches={patches}
            domain={domain}
            selectedVersion={activeVersion}
            onSelectPatch={setSelectedVersion}
          />
        </div>

        {selectedPatch && (
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-semibold text-ink">
                  Patch v{selectedPatch.version}
                </h3>
                <span className="text-muted text-xs">{shortDate(selectedPatch.date)}</span>
                {selectedPatch.notable && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md text-accent-bright bg-accent/10">
                    Notable
                  </span>
                )}
              </div>
              <a
                href={selectedPatch.url} target="_blank" rel="noreferrer"
                className="text-xs text-accent-bright hover:underline"
              >
                Full patch notes ↗
              </a>
            </div>

            {selectedPatch.agentChanges.length === 0 && selectedPatch.mapChanges.length === 0 ? (
              <p className="text-muted text-sm">No agent or map-pool changes in this patch.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedPatch.agentChanges.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 py-1.5 border-t border-hairline first:border-t-0 first:pt-0">
                    <AgentIcon agent={c.agent} size={24} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink">{c.agent}</span>
                        {c.ability && <span className="text-xs text-muted">{c.ability}</span>}
                        <TypeBadge type={c.type} />
                      </div>
                      <p className="text-xs text-muted mt-0.5">{c.summary}</p>
                    </div>
                  </div>
                ))}
                {selectedPatch.mapChanges.map((c, i) => (
                  <div key={`map-${i}`} className="flex items-start gap-3 py-1.5 border-t border-hairline first:border-t-0 first:pt-0">
                    <span className="w-6 h-6 shrink-0 rounded-md bg-surface2 flex items-center justify-center text-[10px] font-semibold text-muted">
                      MAP
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink">{c.map}</span>
                        <TypeBadge type={c.type} />
                      </div>
                      <p className="text-xs text-muted mt-0.5">{c.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(patchData._meta?.attribution || eventMetaData?._meta?.attribution) && (
          <p className="px-1 text-[11px] leading-relaxed text-muted/60">
            {patchData._meta?.attribution}
            {patchData._meta?.attribution && eventMetaData?._meta?.attribution && ' '}
            {eventMetaData?._meta?.attribution}
          </p>
        )}
      </div>

      <AgentPatchTrend
        patches={patches}
        eventMetaEvents={eventMetaData?.events}
        agent={agent}
        onAgentChange={handleAgentChange}
      />
    </div>
  )
}
