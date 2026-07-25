import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandMatchRows, expandSeriesRows, expandMapLengthRows,
  expandBuckets, aggregatePlayerBuckets, groupByEntity,
} from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import LeaderCard, { CardShell, topBy } from '../components/LeaderCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { pct, duration, num } from '../lib/format'

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
  const { data: seriesData } = useData('series_length')
  const { data: mapLengthData } = useData('map_length')
  const { data: playerData } = useData('player_buckets')
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [durationView, setDurationView] = useState('series') // 'series' | 'map'

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

  // Same active facet selections applied to the match-level series/map
  // duration data -- duplicated here rather than sharing useFacetedFilter's
  // internal matching logic, since that hook owns its own state and these
  // are second/third, independently-shaped record sets filtered by the
  // same values. Moved here from the Teams page along with the cards
  // themselves below.
  const matchesSelections = (r) => matchesFilters(r, FACETS, selections, dateRange)

  const seriesRows = useMemo(() => {
    if (!seriesData) return []
    return expandSeriesRows(seriesData).filter((r) => r.fullyTimed && matchesSelections(r))
  }, [seriesData, selections, dateRange])

  const mapRows = useMemo(() => {
    if (!mapLengthData) return []
    return expandMapLengthRows(mapLengthData).filter(matchesSelections)
  }, [mapLengthData, selections, dateRange])

  const activeDurationRows = durationView === 'series' ? seriesRows : mapRows

  const longestSeries = useMemo(
    () => [...activeDurationRows].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 5),
    [activeDurationRows]
  )
  const shortestSeries = useMemo(
    () => [...activeDurationRows].sort((a, b) => a.durationSeconds - b.durationSeconds).slice(0, 5),
    [activeDurationRows]
  )

  // Ace leaderboard: total aces (5-kill rounds) across every player in
  // scope, filtered by the same active facet selections as everything
  // else on this page. A season-long aggregate, unlike the kill-record
  // cards below (which are single-match records) -- there's no season-
  // long entity page it fits better on than here.
  const aceLeaders = useMemo(() => {
    if (!playerData) return []
    const filteredPlayers = expandBuckets(playerData, 'p').filter(matchesSelections)
    const out = []
    for (const [player, buckets] of groupByEntity(filteredPlayers)) {
      const meta = playerData.meta[player]
      if (!meta) continue
      const s = aggregatePlayerBuckets(buckets)
      if (!s || !s.totalAce) continue
      out.push({ player, team: meta.team, countryCode: meta.countryCode,
                 countryName: meta.countryName, totalAce: s.totalAce, mapsPlayed: s.mapsPlayed })
    }
    return out
  }, [playerData, selections, dateRange])

  // Kill records: the single highest individual kill total across an
  // entire series (summed across every map of that match for one
  // player) -- computed at export time as the per-match top scorer (see
  // export_from_db.py), not a combined team total. Best-of is inferred
  // from the winning score alone (max(s1,s2)==2 can only be a Bo3, ==3
  // can only be a Bo5 -- a Bo5 can't end 2-0, so there's no ambiguity),
  // not a separately-tracked field.
  const killRecordsBo3 = useMemo(
    () => matches
      .filter((m) => m.topKills != null && Math.max(m.s1, m.s2) === 2)
      .map((m) => ({
        id: m.id,
        player: m.topKiller,
        team: m.topKillerTeam,
        opponent: m.topKillerTeam === m.team1 ? m.team2 : m.team1,
        score: `${m.s1}–${m.s2}`,
        kills: m.topKills,
      }))
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 5),
    [matches]
  )
  const killRecordsBo5 = useMemo(
    () => matches
      .filter((m) => m.topKills != null && Math.max(m.s1, m.s2) === 3)
      .map((m) => ({
        id: m.id,
        player: m.topKiller,
        team: m.topKillerTeam,
        opponent: m.topKillerTeam === m.team1 ? m.team2 : m.team1,
        score: `${m.s1}–${m.s2}`,
        kills: m.topKills,
      }))
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 5),
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

      {(seriesRows.length > 0 || mapRows.length > 0) && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <div className="flex rounded-lg overflow-hidden border border-hairline w-fit">
              {['series', 'map'].map((v) => (
                <button
                  key={v}
                  onClick={() => setDurationView(v)}
                  className={`px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                    durationView === v ? 'bg-accent text-white' : 'bg-surface2 text-muted hover:text-ink'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MatchList
              title={durationView === 'series' ? 'Longest series (clock time)' : 'Longest map (clock time)'}
              rows={longestSeries}
              renderEntity={(r) => (
                <>
                  <TeamLogo team={r.team1} size={18} />
                  <span className="text-muted text-xs shrink-0">vs</span>
                  <TeamLogo team={r.team2} size={18} />
                </>
              )}
              renderMeta={(r) => (durationView === 'series' ? `${r.mapCount} maps` : r.mapName)}
              renderValue={(r) => duration(r.durationSeconds)}
            />
            <MatchList
              title={durationView === 'series' ? 'Shortest series (clock time)' : 'Shortest map (clock time)'}
              rows={shortestSeries}
              renderEntity={(r) => (
                <>
                  <TeamLogo team={r.team1} size={18} />
                  <span className="text-muted text-xs shrink-0">vs</span>
                  <TeamLogo team={r.team2} size={18} />
                </>
              )}
              renderMeta={(r) => (durationView === 'series' ? `${r.mapCount} maps` : r.mapName)}
              renderValue={(r) => duration(r.durationSeconds)}
            />
          </div>
          <p className="text-muted text-xs">
            Excludes a small number of China-region maps (94 of 1281) where VLR itself never
            published a duration — the same known gap as the missing Rating 2.0 values for that
            region.
          </p>
        </div>
      )}

      {(killRecordsBo3.length > 0 || killRecordsBo5.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MatchList
            title="Most kills in a Bo3 (single player)"
            rows={killRecordsBo3}
            renderEntity={(r) => (
              <>
                <TeamLogo team={r.team} size={16} showName={false} showTag />
                <span className="font-medium text-ink truncate">{r.player}</span>
              </>
            )}
            renderMeta={(r) => (
              <span className="flex items-center gap-1.5">
                vs <TeamLogo team={r.opponent} size={14} showName={false} showTag /> {r.score}
              </span>
            )}
            renderValue={(r) => `${num(r.kills)} kills`}
          />
          <MatchList
            title="Most kills in a Bo5 (single player)"
            rows={killRecordsBo5}
            renderEntity={(r) => (
              <>
                <TeamLogo team={r.team} size={16} showName={false} showTag />
                <span className="font-medium text-ink truncate">{r.player}</span>
              </>
            )}
            renderMeta={(r) => (
              <span className="flex items-center gap-1.5">
                vs <TeamLogo team={r.opponent} size={14} showName={false} showTag /> {r.score}
              </span>
            )}
            renderValue={(r) => `${num(r.kills)} kills`}
          />
        </div>
      )}

      {aceLeaders.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LeaderCard
            title="Most aces"
            note="Total 5-kill rounds across every map in scope."
            rows={topBy(aceLeaders, 'totalAce', { qualify: (r) => r.totalAce > 0 })}
            renderEntity={(r) => (
              <>
                <Flag countryCode={r.countryCode} countryName={r.countryName} size={18} />
                <Link
                  to={`/players/${encodeURIComponent(r.player)}`}
                  className="font-medium text-ink truncate hover:text-accent-bright transition-colors"
                >
                  {r.player}
                </Link>
                <TeamLogo team={r.team} size={16} />
              </>
            )}
            meta={(r) => `${num(r.mapsPlayed)} maps`}
            value={(r) => num(r.totalAce)}
            showRank
          />
        </div>
      )}
    </div>
  )
}

/**
 * Generic "identity block, some meta text, one right-aligned number"
 * leaderboard used for series/map duration and kill records. Generalized
 * from a Teams-page-only SeriesList component (moved here along with the
 * duration cards) by taking renderEntity/renderMeta/renderValue instead
 * of hardcoding a team-vs-team identity block -- kill records need to
 * show a player, not two teams.
 */
function MatchList({ title, rows, renderEntity, renderMeta, renderValue }) {
  return (
    <CardShell title={title}>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0 flex-1">{renderEntity(r)}</div>
            <div className="text-muted text-xs shrink-0">{renderMeta(r)}</div>
            <div className="font-semibold text-ink shrink-0 w-20 text-right">{renderValue(r)}</div>
          </div>
        ))}
      </div>
    </CardShell>
  )
}
