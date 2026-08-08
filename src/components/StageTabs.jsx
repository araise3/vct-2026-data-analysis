import { useState } from 'react'

/**
 * Generic tab strip + active panel switcher -- purely mechanical, takes
 * whatever `tabs` ({id, label, badge?, content}) it's given and renders
 * them, with zero knowledge of what a "stage" or "phase" is. Callers
 * (TournamentDetail.jsx) own deciding what the tabs actually are, whether
 * that's a Liquipedia-sourced Group Stage/Play-Ins/Playoffs split or a
 * plain per-phase grouping of match history for events with no scraped
 * structure -- this component renders either the same way.
 *
 * Defaults to the LAST tab, not the first -- mirrors rft.gg's own
 * per-event pages, which open on the most advanced/current stage (e.g.
 * its EWC 2026 Main Event page opens on "Playoffs", not "Group Stage")
 * rather than always the earliest one.
 *
 * Reuses FilterChips.jsx's exact pill styling (bg-accent/15 + border-
 * accent/40 active state) rather than inventing a second visual language
 * for "a row of selectable options" in the same app.
 */
export default function StageTabs({ tabs, defaultTabId }) {
  const initial = defaultTabId ?? tabs?.[tabs.length - 1]?.id
  const [activeId, setActiveId] = useState(initial)

  if (!tabs || tabs.length === 0) return null

  const active = tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1]

  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => {
            const isActive = t.id === active.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  isActive
                    ? 'bg-accent/15 text-accent-bright border-accent/40'
                    : 'bg-surface text-muted border-hairline hover:text-ink hover:border-muted'
                }`}
              >
                {t.label}
                {t.badge != null && <span className="opacity-60 font-normal ml-1.5">{t.badge}</span>}
              </button>
            )
          })}
        </div>
      )}
      {active.content}
    </div>
  )
}
