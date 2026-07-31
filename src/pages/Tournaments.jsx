import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { expandMatchRows } from '../lib/entityBuckets'
import MatchHistory from '../components/MatchHistory'
import { eventLabel, phaseLabel, num } from '../lib/format'

/**
 * Every tournament, broken into its stages, each listing its matches.
 *
 * Built entirely from match_results.json + match_players.json -- no new
 * export needed, since a "tournament" here is just the set of matches
 * sharing an event id, and each match already carries the
 * "Phase: Round" string this groups on (`w`).
 *
 * Deliberately has no FilterPanel, unlike every other page -- this is meant
 * to be a complete index of every tournament in the dataset (every
 * region/competition/year/split), not a scoped view, so there is nothing to
 * filter by design rather than an oversight.
 */
function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 16 16" width="14" height="14" fill="none"
      className={`shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Tournaments() {
  // No match_players.json here: this page renders MatchHistory with
  // perspective={null}, and that component only ever reads playersByMatch to
  // resolve which team a *player* was on for a given match. Fetching it
  // anyway cost a 3.9MB download + parse and a 10,974-row Map build whose
  // result was never read once.
  const { data: matchData, loading } = useData('match_results')

  const records = useMemo(() => expandMatchRows(matchData), [matchData])

  // event -> { meta, phases: [{ phase, matches }] }, newest tournament
  // first. "Newest" is the latest match date in the event rather than the
  // event id: ids are only roughly chronological (they're VLR's own
  // creation order), and a tournament list is one place where getting the
  // order visibly wrong is obvious.
  const tournaments = useMemo(() => {
    const byEvent = new Map()
    for (const m of records) {
      if (!byEvent.has(m.event)) {
        byEvent.set(m.event, {
          event: m.event,
          region: m.region,
          split: m.split,
          competition: m.competition,
          matches: [],
        })
      }
      byEvent.get(m.event).matches.push(m)
    }

    const out = []
    for (const t of byEvent.values()) {
      const dates = t.matches.map((m) => m.date).filter(Boolean).sort()
      // Phases keep the order they first appear in chronologically
      // (Group Stage before Playoffs), not alphabetical -- a bracket reads
      // wrong any other way.
      const byPhase = new Map()
      for (const m of [...t.matches].sort((a, b) =>
        (a.date || '').localeCompare(b.date || '') || a.id - b.id
      )) {
        const p = phaseLabel(m.w) || 'Matches'
        if (!byPhase.has(p)) byPhase.set(p, [])
        byPhase.get(p).push(m)
      }
      out.push({
        ...t,
        firstDate: dates[0] || null,
        lastDate: dates[dates.length - 1] || null,
        phases: [...byPhase.entries()].map(([phase, matches]) => ({ phase, matches })),
      })
    }
    return out.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''))
  }, [records])

  // All collapsed by default -- expanding every tournament at once would
  // mount ~500 match rows, and auto-opening "the most recent one" meant the
  // same card (currently Pacific Stage 2, since tournaments are sorted by
  // last match date) kept expanding itself back open on every visit even
  // after the user had collapsed it, since `expanded` only ever tracked
  // an explicit override and reset on reload.
  const [expanded, setExpanded] = useState('')
  const openEvent = expanded

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Tournaments</h1>
        <p className="text-muted text-sm mt-1">
          {tournaments.length} tournaments · {num(records.length)} matches
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No tournaments found.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tournaments.map((t) => {
            const open = openEvent === t.event
            return (
              <div key={t.event} className="bg-surface border border-hairline rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? '' : t.event)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface2/40 transition-colors"
                  aria-expanded={open}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="text-muted"><Chevron open={open} /></span>
                    <span className="min-w-0">
                      <span className="font-display text-sm font-semibold text-ink block truncate">
                        {eventLabel(t.event)}
                      </span>
                      <span className="text-muted text-xs">
                        {[t.region, t.split, t.competition].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="text-muted text-xs block whitespace-nowrap">
                      {t.firstDate === t.lastDate
                        ? t.firstDate
                        : `${t.firstDate || '…'} → ${t.lastDate || '…'}`}
                    </span>
                    <span className="text-muted/70 text-[11px]">
                      {t.matches.length} {t.matches.length === 1 ? 'match' : 'matches'} ·{' '}
                      {t.phases.length} {t.phases.length === 1 ? 'stage' : 'stages'}
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="px-5 pb-5 flex flex-col gap-5 border-t border-hairline pt-4">
                    {t.phases.map(({ phase, matches }) => (
                      <div key={phase} className="flex flex-col gap-2">
                        <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink">
                          {phase}
                          <span className="text-muted/60 font-normal ml-2">
                            {matches.length}
                          </span>
                        </h3>
                        <MatchHistory
                          matches={matches}
                          perspective={null}
                          showEvent={false}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
