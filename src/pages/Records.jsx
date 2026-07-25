import { useMemo, useState } from 'react'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import { expandMatchRows } from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import TeamLogo from '../components/TeamLogo'
import { pct } from '../lib/format'

/**
 * Records -- the things that are about a specific matchup rather than one
 * entity's aggregate, so they don't fit the bucket model the rest of the
 * site uses: head-to-head records, biggest upsets, biggest blowouts.
 * All driven by match_results.json (one row per completed match, with its
 * maps nested).
 */

const card = 'bg-surface border border-hairline rounded-2xl p-5'
const heading = 'font-display text-sm font-semibold text-ink mb-4'

export default function Records() {
  const { data, loading } = useData('match_results')
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')

  const records = useMemo(() => expandMatchRows(data), [data])
  const { selections, setFacet, clearAll, options, activeCount,
          dateRange, setDateRange, dateBounds } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const matches = useMemo(
    () => records.filter((r) => matchesFilters(r, FACETS, selections, dateRange)),
    [records, selections, dateRange]
  )

  const teams = useMemo(
    () => [...new Set(matches.flatMap((m) => [m.team1, m.team2]))].sort(),
    [matches]
  )

  // Biggest upsets: winner had the worse season-long match win rate.
  // `strength` is only a proxy (there's no seeding in the scrape), so the
  // gap is shown explicitly rather than presented as an authoritative
  // ranking upset.
  const upsets = useMemo(() => {
    const out = []
    for (const m of matches) {
      if (m.str1 == null || m.str2 == null) continue
      const winnerIsOne = m.s1 > m.s2
      const winStr = winnerIsOne ? m.str1 : m.str2
      const loseStr = winnerIsOne ? m.str2 : m.str1
      const gap = loseStr - winStr
      if (gap <= 0) continue
      out.push({
        ...m,
        winner: winnerIsOne ? m.team1 : m.team2,
        loser: winnerIsOne ? m.team2 : m.team1,
        winnerScore: winnerIsOne ? m.s1 : m.s2,
        loserScore: winnerIsOne ? m.s2 : m.s1,
        winStr, loseStr, gap,
      })
    }
    return out.sort((a, b) => b.gap - a.gap).slice(0, 10)
  }, [matches])

  // Biggest blowouts: largest round margin on a single map.
  const blowouts = useMemo(() => {
    const out = []
    for (const m of matches) {
      for (const mp of m.maps || []) {
        if (mp.s1 == null || mp.s2 == null) continue
        const margin = Math.abs(mp.s1 - mp.s2)
        const oneWon = mp.s1 > mp.s2
        out.push({
          id: `${m.id}-${mp.map}`,
          winner: oneWon ? m.team1 : m.team2,
          loser: oneWon ? m.team2 : m.team1,
          winScore: oneWon ? mp.s1 : mp.s2,
          loseScore: oneWon ? mp.s2 : mp.s1,
          map: mp.map, margin, date: m.date,
        })
      }
    }
    return out.sort((a, b) => b.margin - a.margin || a.loseScore - b.loseScore).slice(0, 10)
  }, [matches])

  // Head-to-head between the two selected teams.
  const h2h = useMemo(() => {
    if (!teamA || !teamB || teamA === teamB) return null
    const played = matches.filter(
      (m) =>
        (m.team1 === teamA && m.team2 === teamB) ||
        (m.team1 === teamB && m.team2 === teamA)
    )
    let aWins = 0, bWins = 0, aMaps = 0, bMaps = 0
    for (const m of played) {
      const aIsOne = m.team1 === teamA
      const aScore = aIsOne ? m.s1 : m.s2
      const bScore = aIsOne ? m.s2 : m.s1
      if (aScore > bScore) aWins++
      else if (bScore > aScore) bWins++
      aMaps += aScore
      bMaps += bScore
    }
    return { played, aWins, bWins, aMaps, bMaps }
  }, [matches, teamA, teamB])

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  const selectCls =
    'bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-muted'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Records</h1>
        <p className="text-muted text-sm mt-1">
          Head-to-head, upsets and blowouts — the matchup-level things that don't fit a
          per-team average.
        </p>
      </div>

      <FilterPanel
        options={options} selections={selections} setFacet={setFacet} clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        summary={`${matches.length} matches`}
      />

      <div className={card}>
        <h3 className={heading}>Head-to-head</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={teamA} onChange={(e) => setTeamA(e.target.value)} className={selectCls}>
            <option value="">Select team…</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-muted text-xs">vs</span>
          <select value={teamB} onChange={(e) => setTeamB(e.target.value)} className={selectCls}>
            <option value="">Select team…</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {h2h && (
          h2h.played.length === 0 ? (
            <p className="text-muted text-sm mt-4">
              These two haven't played within the current filters.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-semibold text-ink text-lg">
                  {h2h.aWins}–{h2h.bWins}
                </span>
                <span className="text-muted text-xs">
                  series ({h2h.aMaps}–{h2h.bMaps} in maps, {h2h.played.length} played)
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {h2h.played
                  .slice()
                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                  .map((m) => (
                    <div key={m.id} className="flex items-center gap-3 text-sm">
                      <span className="text-muted text-xs w-24 shrink-0">{m.date}</span>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <TeamLogo team={m.team1} size={18} />
                        <span className="font-semibold text-ink shrink-0">{m.s1}–{m.s2}</span>
                        <TeamLogo team={m.team2} size={18} />
                      </div>
                      <span className="text-muted text-xs truncate">{m.event}</span>
                    </div>
                  ))}
              </div>
            </div>
          )
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className={heading}>Biggest upsets</h3>
          <div className="flex flex-col gap-3">
            {upsets.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <TeamLogo team={m.winner} size={18} />
                  <span className="text-muted text-xs shrink-0">beat</span>
                  <TeamLogo team={m.loser} size={18} />
                </div>
                <span className="text-muted text-xs shrink-0">
                  {m.winnerScore}–{m.loserScore}
                </span>
                <span className="font-semibold text-ink shrink-0 w-28 text-right text-xs">
                  {pct(m.winStr)} vs {pct(m.loseStr)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-muted text-xs mt-4 leading-relaxed">
            Ranked by the gap in the two teams' overall match win rate across all data in
            scope. There's no seeding or ranking in the source data, so this is a proxy for
            "who was expected to win", not an official upset.
          </p>
        </div>

        <div className={card}>
          <h3 className={heading}>Biggest blowouts (single map)</h3>
          <div className="flex flex-col gap-3">
            {blowouts.map((b) => (
              <div key={b.id} className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <TeamLogo team={b.winner} size={18} />
                  <span className="text-muted text-xs shrink-0">beat</span>
                  <TeamLogo team={b.loser} size={18} />
                </div>
                <span className="text-muted text-xs shrink-0">{b.map}</span>
                <span className="font-semibold text-ink shrink-0 w-14 text-right">
                  {b.winScore}–{b.loseScore}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
