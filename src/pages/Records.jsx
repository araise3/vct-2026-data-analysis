import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandMatchRows, expandSeriesRows, expandMapLengthRows,
  expandBuckets, aggregatePlayerBuckets, groupByEntity, teamInScope,
  buildPlayerDayGroups, attachDateSpans,
} from '../lib/entityBuckets'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import LeaderCard, { CardShell, topBy, dynamicQualify, dynamicQualifyThreshold } from '../components/LeaderCard'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import Select from '../components/ui/Select'
import { pct, duration, num } from '../lib/format'

/**
 * Records -- the things that are about a specific matchup rather than one
 * entity's aggregate, so they don't fit the bucket model the rest of the
 * site uses: head-to-head records, biggest upsets, biggest blowouts.
 * All driven by match_results.json (one row per completed match, with its
 * maps nested).
 */

const card = 'bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5'
const heading = 'font-display text-sm font-semibold text-ink mb-4'

/**
 * Moved here from the Tournaments page's "Season stats" section, which was
 * pared down to just its headline KPI tiles -- these per-player leaderboards
 * fit better alongside Records' other player leaderboard ("Most aces",
 * already here) than under a KPI strip. None of these have a side breakdown
 * in the source data (see entityBuckets' aggregatePlayerBuckets), so there's
 * no Attack/Defend toggle to worry about here either.
 */
const PLAYER_LEADERS = [
  {
    key: 'consistencyScore', title: 'Most consistent',
    invert: true,
    // Gates on ratedMaps, NOT mapsPlayed: China maps often have no
    // Rating 2.0, so a player can have 33 maps but only 14 that feed the
    // SD. Using mapsPlayed here let a 14-rated-map player onto the card
    // with an artificially tiny spread. Same threshold also drives the
    // shrinkage strength in `consistencyRows` below -- see its own comment.
    sampleKey: 'ratedMaps', sampleMin: 15,
    meta: (r) => `${num(r.ratedMaps)} rated`,
    value: (r) => r.consistencyScore.toFixed(3),
    note: "Rating 2.0 spread across individual maps, shrunk toward the qualified pool's own average spread by sample size (same round-weighted method Player of the Week uses) — a player just over the rated-map minimum is pulled toward the field's typical spread instead of a lucky small sample winning outright on raw standard deviation. Lower is steadier. Min. 15 rated maps (scaled down for a smaller filter scope).",
  },
  {
    key: 'avgEcon', title: 'Highest econ rating',
    sampleKey: 'utilMaps', sampleMin: 15,
    meta: (r) => `${num(r.utilMaps)} maps`,
    value: (r) => num(r.avgEcon),
    note: 'Min. 15 maps with economy data (scaled down for a smaller filter scope).',
  },
  {
    key: 'totalClutches', title: 'Most clutches',
    qualify: (r) => r.totalClutches > 0,
    meta: (r) => `${num(r.roundsPlayed)} rds`,
    value: (r) => num(r.totalClutches),
  },
  {
    key: 'totalPlants', title: 'Most spike plants',
    qualify: (r) => r.utilMaps > 0,
    meta: (r) => `${num(r.utilMaps)} maps`,
    value: (r) => num(r.totalPlants),
  },
  {
    key: 'totalDefuses', title: 'Most defuses',
    qualify: (r) => r.utilMaps > 0,
    meta: (r) => `${num(r.utilMaps)} maps`,
    value: (r) => num(r.totalDefuses),
  },
  {
    key: 'totalAce', title: 'Most aces',
    qualify: (r) => r.totalAce > 0,
    meta: (r) => `${num(r.mapsPlayed)} maps`,
    value: (r) => num(r.totalAce),
    note: 'Total 5-kill rounds across every map in scope.',
  },
]

export default function Records() {
  const { data, loading } = useData('match_results')
  const { data: seriesData } = useData('series_length')
  const { data: mapLengthData } = useData('map_length')
  const { data: playerData } = useData('player_buckets')
  // player_buckets has no per-day date (see buildPlayerDayGroups' own
  // comment in entityBuckets.js), so the page's DATE RANGE control looked
  // live but silently filtered nothing out of the Player leaders section
  // below. player_agents.json fills the same role it does on Players.jsx --
  // idle-loaded (9.4MB, off the critical path) since this page's main
  // content (head-to-head/upsets/blowouts) doesn't need it.
  const idle = useIdle()
  const { data: agentData } = useData(idle ? 'player_agents' : null)
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [durationView, setDurationView] = useState('series') // 'series' | 'map'

  const records = useMemo(() => expandMatchRows(data), [data])
  const { selections, setFacet, clearAll, options, activeCount,
          dateRange, setDateRange, dateBounds,
          includeHiddenEvents, setIncludeHiddenEvents } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'], year: [2026] })

  const matches = useMemo(
    () => records.filter((r) => matchesFilters(r, FACETS, selections, dateRange, includeHiddenEvents)),
    [records, selections, dateRange, includeHiddenEvents]
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
  const matchesSelections = (r) => matchesFilters(r, FACETS, selections, dateRange, includeHiddenEvents)

  // Same split as playerRecords below: expand once per dataset, then only
  // re-run the cheap match test when the selections change.
  const allSeriesRows = useMemo(
    () => (seriesData ? expandSeriesRows(seriesData).filter((r) => r.fullyTimed) : []),
    [seriesData]
  )
  const allMapRows = useMemo(
    () => (mapLengthData ? expandMapLengthRows(mapLengthData) : []),
    [mapLengthData]
  )

  const seriesRows = useMemo(
    () => allSeriesRows.filter(matchesSelections),
    [allSeriesRows, selections, dateRange, includeHiddenEvents]
  )

  const mapRows = useMemo(
    () => allMapRows.filter(matchesSelections),
    [allMapRows, selections, dateRange, includeHiddenEvents]
  )

  const activeDurationRows = durationView === 'series' ? seriesRows : mapRows

  const longestSeries = useMemo(
    () => [...activeDurationRows].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 5),
    [activeDurationRows]
  )
  const shortestSeries = useMemo(
    () => [...activeDurationRows].sort((a, b) => a.durationSeconds - b.durationSeconds).slice(0, 5),
    [activeDurationRows]
  )

  // Player leaderboards: every season-long aggregate stat, filtered by the
  // same active facet selections as everything else on this page. A
  // season-long aggregate, unlike the kill-record cards below (which are
  // single-match records) -- there's no season-long entity page it fits
  // better on than here.
  // Expanded once per dataset, not once per filter change -- this memo
  // depends on `selections`, so leaving expandBuckets inside it re-walked
  // all 10,894 player buckets (~8ms) on every chip click, rebuilding an
  // identical intermediate each time.
  const rawPlayerRecords = useMemo(
    () => (playerData ? expandBuckets(playerData, 'p') : []),
    [playerData]
  )
  const dayGroups = useMemo(
    () => (agentData ? buildPlayerDayGroups(agentData.buckets) : new Map()),
    [agentData]
  )
  const playerRecords = useMemo(
    () => attachDateSpans(rawPlayerRecords, dayGroups),
    [rawPlayerRecords, dayGroups]
  )

  const leaderRows = useMemo(() => {
    if (!playerData) return []
    const filteredPlayers = playerRecords.filter(matchesSelections)
    const out = []
    for (const [player, buckets] of groupByEntity(filteredPlayers)) {
      const meta = playerData.meta[player]
      if (!meta) continue
      const s = aggregatePlayerBuckets(buckets)
      if (!s || !s.mapsPlayed) continue
      out.push({ player, team: teamInScope(buckets, meta.team), countryCode: meta.countryCode,
                 countryName: meta.countryName, ...s })
    }
    return out
  }, [playerData, playerRecords, selections, dateRange, includeHiddenEvents])

  // "Most consistent" card: shrinks each qualified player's raw rating
  // standard deviation toward the qualified pool's own (maps-weighted)
  // mean spread, by the same IMDB-style formula Player of the Week uses
  // for its rating ranking (see data_prep/build_player_week.py) --
  // weighted = v/(v+m)*R + m/(v+m)*C, where R is the player's own SD, v is
  // their rated maps, m is the same dynamic qualification threshold used
  // to gate the card, and C is the pool's mean SD. A player who barely
  // cleared the rated-maps floor is pulled hard toward the field's typical
  // spread instead of letting a lucky small sample's low variance win
  // outright; a player with many rated maps is barely shrunk at all.
  const consistencyRows = useMemo(() => {
    if (!leaderRows.length) return leaderRows
    const threshold = dynamicQualifyThreshold(leaderRows, 'ratedMaps', { fixed: 15 })
    const qualified = leaderRows.filter((r) => r.ratedMaps >= threshold && r.ratingSd != null)
    if (!qualified.length) return leaderRows
    const totalMaps = qualified.reduce((s, r) => s + r.ratedMaps, 0)
    const poolMeanSd = qualified.reduce((s, r) => s + r.ratingSd * r.ratedMaps, 0) / totalMaps
    return leaderRows.map((r) => {
      if (r.ratingSd == null) return r
      const v = r.ratedMaps
      const consistencyScore = (v / (v + threshold)) * r.ratingSd + (threshold / (v + threshold)) * poolMeanSd
      return { ...r, consistencyScore }
    })
  }, [leaderRows])

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
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        summary={`${matches.length} matches`}
      />

      <div className={card}>
        <h3 className={heading}>Head-to-head</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <Select
            value={teamA} onChange={setTeamA} placeholder="Select team…" options={teams}
            renderIcon={(t) => <TeamLogo team={t} size={16} showName={false} />}
          />
          <span className="text-muted text-xs">vs</span>
          <Select
            value={teamB} onChange={setTeamB} placeholder="Select team…" options={teams}
            renderIcon={(t) => <TeamLogo team={t} size={16} showName={false} />}
          />
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
                        <TeamLogo team={m.team1} size={22} />
                        <span className="font-semibold text-ink shrink-0">{m.s1}–{m.s2}</span>
                        <TeamLogo team={m.team2} size={22} />
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
                  <TeamLogo team={m.winner} size={22} />
                  <span className="text-muted text-xs shrink-0">beat</span>
                  <TeamLogo team={m.loser} size={22} />
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
                  <TeamLogo team={b.winner} size={22} />
                  <span className="text-muted text-xs shrink-0">beat</span>
                  <TeamLogo team={b.loser} size={22} />
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
            <div className="flex rounded-lg overflow-hidden border border-hairline shadow-depth-xs w-fit">
              {['series', 'map'].map((v) => (
                <button
                  key={v}
                  onClick={() => setDurationView(v)}
                  className={`px-4 py-1.5 text-xs font-medium capitalize transition-all duration-150 ${
                    durationView === v ? 'bg-grad-selected text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15)]' : 'bg-surface2 text-muted hover:text-ink hover:bg-surface3'
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
                  <TeamLogo team={r.team1} size={22} />
                  <span className="text-muted text-xs shrink-0">vs</span>
                  <TeamLogo team={r.team2} size={22} />
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
                  <TeamLogo team={r.team1} size={22} />
                  <span className="text-muted text-xs shrink-0">vs</span>
                  <TeamLogo team={r.team2} size={22} />
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
                <TeamLogo team={r.team} size={20} showName={false} showTag />
                <span className="font-medium text-ink truncate">{r.player}</span>
              </>
            )}
            renderMeta={(r) => (
              <span className="flex items-center gap-1.5">
                vs <TeamLogo team={r.opponent} size={18} showName={false} showTag /> {r.score}
              </span>
            )}
            renderValue={(r) => `${num(r.kills)} kills`}
          />
          <MatchList
            title="Most kills in a Bo5 (single player)"
            rows={killRecordsBo5}
            renderEntity={(r) => (
              <>
                <TeamLogo team={r.team} size={20} showName={false} showTag />
                <span className="font-medium text-ink truncate">{r.player}</span>
              </>
            )}
            renderMeta={(r) => (
              <span className="flex items-center gap-1.5">
                vs <TeamLogo team={r.opponent} size={18} showName={false} showTag /> {r.score}
              </span>
            )}
            renderValue={(r) => `${num(r.kills)} kills`}
          />
        </div>
      )}

      {leaderRows.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className="font-display text-sm font-semibold text-ink">Player leaders</h2>
            <p className="text-muted text-xs">Follows the filters above.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {PLAYER_LEADERS.map((c) => (
              <LeaderCard
                key={c.key}
                title={c.title}
                note={c.note}
                rows={topBy(c.key === 'consistencyScore' ? consistencyRows : leaderRows, c.key, {
                  qualify: c.sampleKey
                    ? dynamicQualify(leaderRows, c.sampleKey, { fixed: c.sampleMin })
                    : c.qualify,
                  invert: c.invert,
                })}
                renderEntity={(r) => (
                  <>
                    <Flag countryCode={r.countryCode} countryName={r.countryName} size={14} />
                    <Link
                      to={`/players/${encodeURIComponent(r.player)}`}
                      className="font-medium text-ink truncate hover:text-accent-bright transition-colors"
                    >
                      {r.player}
                    </Link>
                    <TeamLogo team={r.team} size={20} />
                  </>
                )}
                meta={c.meta}
                value={c.value}
                showRank
              />
            ))}
          </div>
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
