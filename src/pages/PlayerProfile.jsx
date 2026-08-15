import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateAgentBuckets, teamInScope,
  expandMatchRows, groupMatchPlayers,
} from '../lib/entityBuckets'
import { rolesInScope } from '../lib/peerComparison'
import { buildRadarProfile } from '../lib/radarProfile'
import { aggregatePlayerDuelsByOpponent, aggregateKdByCountry } from '../lib/playerDuels'
import RadarChart from '../components/RadarChart'
import CountryKdChart from '../components/CountryKdChart'
import FilterChips from '../components/FilterChips'
import EventPicker from '../components/EventPicker'
import DataTable from '../components/DataTable'
import MatchHistory from '../components/MatchHistory'
import PerformanceStrip from '../components/PerformanceStrip'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import AgentIcon from '../components/AgentIcon'
import Button from '../components/ui/Button'
import { rating, pct, num, ratingTier, vlrMatchUrl, eventLabel } from '../lib/format'

export default function PlayerProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data, loading } = useData('player_buckets')
  const { data: agentData } = useData('player_agents')
  const { data: matchData } = useData('match_results')
  const { data: matchPlayerData } = useData('match_players')
  // Radar comparison target. Kept as two pieces of state -- `compareInput`
  // is the live text of the field, `compareName` is what actually gets
  // passed to buildRadarProfile() -- so a mid-typing "no data for 'as'"
  // caveat doesn't flash on every keystroke; the name only "commits" on
  // blur/Enter, same as picking a suggestion from the datalist.
  // Seeded from ?compare= so a link to this profile can land with a second
  // player already plotted, without needing its own UI to pass state.
  const [searchParams] = useSearchParams()
  const seededCompare = searchParams.get('compare') || ''
  const [compareInput, setCompareInput] = useState(seededCompare)
  const [compareName, setCompareName] = useState(seededCompare)

  // Every one of this player's own buckets, across every year/competition --
  // the page-wide multi-facet FilterPanel (region/event/phase/week/split/
  // competition + date range) this used to run through was built for list
  // pages with dozens of entities in scope at once; on a single player's
  // profile it was mostly empty chip groups. Replaced with one fixed rule
  // instead: everything below except the Kill Record (a career-wide fact,
  // see bestKillMatch) and the Agents table (its own small year/event
  // picker, see below) pins to this player's most recent season.
  const records = useMemo(
    () => (data ? expandBuckets(data, 'p', (b) => b.p === decodedName) : []),
    [data, decodedName]
  )

  const recentYear = useMemo(
    () => (records.length ? Math.max(...records.map((r) => r.year)) : null),
    [records]
  )

  const filtered = useMemo(
    () => records.filter((r) => r.year === recentYear),
    [records, recentYear]
  )

  const stats = useMemo(
    () => aggregatePlayerBuckets(filtered),
    [filtered]
  )

  // Peer-relative radar profile. Needs EVERY player's buckets, not just
  // this player's, so it re-expands the full file once (memoized on `data`
  // alone -- the expensive part, ~10.9ms over 10,894 buckets) and then
  // narrows that flat array to the subject's own most recent season (cheap,
  // a plain predicate), rather than re-running expandBuckets per render.
  const allPlayerRecords = useMemo(() => (data ? expandBuckets(data, 'p') : []), [data])
  const radarScope = useMemo(
    () => allPlayerRecords.filter((r) => r.year === recentYear),
    [allPlayerRecords, recentYear]
  )
  const radar = useMemo(
    () => buildRadarProfile(radarScope, decodedName, { compareName: compareName || null }),
    [radarScope, decodedName, compareName]
  )

  // Player duels, by opponent's country -- match_duels.json is comparable
  // in size to match_players.json (already loaded unconditionally above),
  // so it's idle-loaded rather than competing with first-paint bandwidth.
  const idle = useIdle()
  const { data: duelData } = useData(idle ? 'match_duels' : null)

  // Names available to compare against -- every player who has at least
  // one bucket in the subject's most recent season, so the suggestion list
  // always matches who could actually plot a second polygon. Not restricted
  // to qualified peers (see buildRadarProfile's bar) -- a thin comparison is
  // still meaningful, same as the subject themself being shown unqualified.
  const compareOptions = useMemo(() => {
    const ids = new Set()
    for (const r of radarScope) {
      if (r.id !== decodedName) ids.add(r.id)
    }
    return [...ids].sort((a, b) => a.localeCompare(b))
  }, [radarScope, decodedName])

  function commitCompare() {
    setCompareName(compareInput.trim())
  }
  function clearCompare() {
    setCompareInput('')
    setCompareName('')
  }

  // Every one of this player's per-agent buckets, across every year --
  // player_agents.json is a deliberately lean schema (see export_from_db.py)
  // -- only maps/rounds/rating/ACS/kills/deaths are tracked per (player,
  // agent, event, week), so KAST/ADR/HS%/multi-kills/econ aren't available
  // broken out by agent the way they are on the Players table.
  const agentRecords = useMemo(
    () => (agentData ? expandBuckets(agentData, 'p', (b) => b.p === decodedName) : []),
    [agentData, decodedName]
  )

  // Most Played Agent card + the role badge next to the player's name both
  // pin to the most recent season, same rule as the rest of the header --
  // NOT the Agents table's own year/event pickers below, which the user
  // can switch independently without the header cards jumping around
  // underneath them.
  const agentRecordsRecentYear = useMemo(
    () => agentRecords.filter((r) => r.year === recentYear),
    [agentRecords, recentYear]
  )
  const mostPlayedAgent = useMemo(() => {
    const grouped = new Map()
    for (const r of agentRecordsRecentYear) {
      if (!grouped.has(r.ag)) grouped.set(r.ag, [])
      grouped.get(r.ag).push(r)
    }
    let best = null
    for (const [agent, buckets] of grouped) {
      const s = aggregateAgentBuckets(buckets)
      if (!s || !s.mapsPlayed) continue
      if (!best || s.mapsPlayed > best.mapsPlayed) best = { agent, ...s }
    }
    return best
  }, [agentRecordsRecentYear])

  const role = useMemo(
    () => rolesInScope(agentRecordsRecentYear).get(decodedName) ?? null,
    [agentRecordsRecentYear, decodedName]
  )

  // The Agents table's own scope controls -- the one part of this page
  // that's still user-adjustable, per direct request. Two independent
  // pickers, both small and both scoped to this table alone:
  //   - a year picker (FilterChips, same as everywhere else on the site)
  //   - a multi-select event search (EventPicker) -- more than one event
  //     can be added into scope at once, ORed together below
  // Any committed events take priority over the year chips when both are
  // "set" -- the chips grey out (see the wrapper below) as the visual cue
  // that they're not the thing currently driving the table.
  const [agentYear, setAgentYear] = useState(null)
  const [agentEventOverrides, setAgentEventOverrides] = useState([])
  useEffect(() => {
    setAgentYear(null)
    setAgentEventOverrides([])
  }, [decodedName])

  const agentYearOptions = useMemo(
    () => [...new Set(agentRecords.map((r) => r.year))].sort((a, b) => a - b),
    [agentRecords]
  )
  const effectiveAgentYear = agentYear ?? recentYear

  // Every event this player has at least one AGENT bucket in, most recent
  // first (by raw event id -- ids increase with time within a season and
  // 2026's range sits entirely above 2025's, confirmed in
  // export_from_db.py's own verification notes -- so this needs no
  // separate date lookup).
  const agentEventOptions = useMemo(() => {
    const latestIdByEvent = new Map()
    for (const r of agentRecords) {
      const cur = latestIdByEvent.get(r.event)
      if (cur === undefined || r.e > cur) latestIdByEvent.set(r.event, r.e)
    }
    return [...latestIdByEvent.entries()].sort((a, b) => b[1] - a[1]).map(([evt]) => evt)
  }, [agentRecords])

  function addAgentEvent(evt) {
    setAgentEventOverrides((prev) => (prev.includes(evt) ? prev : [...prev, evt]))
  }
  function removeAgentEvent(evt) {
    setAgentEventOverrides((prev) => prev.filter((e) => e !== evt))
  }

  const agentInScope = useMemo(() => {
    if (agentEventOverrides.length) {
      const set = new Set(agentEventOverrides)
      return agentRecords.filter((r) => set.has(r.event))
    }
    return effectiveAgentYear === 'All' ? agentRecords : agentRecords.filter((r) => r.year === effectiveAgentYear)
  }, [agentRecords, effectiveAgentYear, agentEventOverrides])

  const agentRows = useMemo(() => {
    const grouped = new Map()
    for (const r of agentInScope) {
      if (!grouped.has(r.ag)) grouped.set(r.ag, [])
      grouped.get(r.ag).push(r)
    }
    const out = []
    for (const [agent, buckets] of grouped) {
      const s = aggregateAgentBuckets(buckets)
      if (!s || !s.mapsPlayed) continue
      out.push({ agent, ...s })
    }
    return out.sort((a, b) => b.mapsPlayed - a.mapsPlayed)
  }, [agentInScope])

  // "Overall" row pinned above the per-agent breakdown: aggregateAgentBuckets
  // over the SAME ungrouped agentInScope rows the per-agent rows are built
  // from (not a re-sum of the already-divided per-agent percentages), so
  // it's exactly consistent with the per-agent rows -- Maps/Rounds/wins
  // sum exactly, Win%/Rating/etc. are the true rounds-weighted totals
  // rather than an average-of-averages.
  const agentOverall = useMemo(() => {
    const s = aggregateAgentBuckets(agentInScope)
    return s ? { agent: 'Overall', ...s } : null
  }, [agentInScope])

  const agentScopeLabel = agentEventOverrides.length === 1
    ? eventLabel(agentEventOverrides[0])
    : agentEventOverrides.length > 1
      ? `${agentEventOverrides.length} events`
      : effectiveAgentYear

  // Match history. The scoreboard rows carry no event/week of their own,
  // so the filtering happens on the match records (which expandMatchRows
  // gives the same facet fields as every bucket record) and the scoreboard
  // map is a pure lookup keyed by match id.
  const playersByMatch = useMemo(() => groupMatchPlayers(matchPlayerData), [matchPlayerData])

  // Every match this player appeared in -- derived from the scoreboard rows
  // rather than from their buckets, so a match can only appear if there's a
  // box score behind it. Feeds both Match history (paginated, see
  // `sortedMatchRows`/`matchLimit` below) and the Performances strip
  // directly -- neither is scoped to recentYear the way the rest of the
  // page is.
  const allMatchRows = useMemo(() => {
    if (!matchData || !matchPlayerData) return []
    const mine = new Set()
    for (const r of matchPlayerData.rows) if (r.p === decodedName) mine.add(r.m)
    return expandMatchRows(matchData).filter((m) => mine.has(m.id))
  }, [matchData, matchPlayerData, decodedName])

  // Career-wide, same as allMatchRows/Performances/Match history above --
  // not scoped to recentYear, since narrowing to one season would hide
  // real duel history against opponents faced in earlier years for no
  // clear benefit (same reasoning ComparePlayers.jsx's own h2h duels
  // already settled on).
  const duelMatchIds = useMemo(() => new Set(allMatchRows.map((m) => m.id)), [allMatchRows])
  // Per-opponent duel records, grouped by opponent country -- an
  // intermediate step only. Nothing renders this shape directly any more
  // (the "Duels by country" chart that once did was removed); it exists
  // purely to feed aggregateKdByCountry() below.
  const duelGroups = useMemo(
    () => (duelData?.rows && data
      ? aggregatePlayerDuelsByOpponent(duelData.rows, duelMatchIds, decodedName, data.meta)
      : []),
    [duelData, duelMatchIds, decodedName, data]
  )
  // Same underlying duel data as duelGroups above, collapsed to one K/D
  // per country -- this player's own K/D specifically against opponents
  // from that country, not that country's general skill level.
  const countryKdBars = useMemo(() => aggregateKdByCountry(duelGroups), [duelGroups])

  // Match history newest-first, across every year -- no longer pinned to
  // recentYear like the rest of the page. Paginated 30 at a time rather
  // than rendered in full, since a long career can run to hundreds of
  // matches; `matchLimit` resets whenever the profile switches players.
  const sortedMatchRows = useMemo(
    () => [...allMatchRows].sort(
      (a, b) => (b.ts || b.date || '').localeCompare(a.ts || a.date || '') || b.id - a.id
    ),
    [allMatchRows]
  )
  const [matchLimit, setMatchLimit] = useState(30)
  useEffect(() => {
    setMatchLimit(30)
  }, [decodedName])
  const visibleMatchRows = useMemo(
    () => sortedMatchRows.slice(0, matchLimit),
    [sortedMatchRows, matchLimit]
  )

  // Highest-kill series across this player's ENTIRE match history -- the
  // analogue of rft.gg's "Most Kills in 1 Game" card. Deliberately built
  // from the unpaginated `allMatchRows`, not `visibleMatchRows`: unlike
  // every other stat on this page, a career-best record shouldn't disappear
  // or shrink just because it falls past the current "Load more" page --
  // it's a fixed fact about the player, not a scoped aggregate. Series
  // totals, not per-map, and necessarily so: match_players.json is one row
  // per player per MATCH, and the site no longer ships a per-map breakdown
  // at all (those files were dropped when match pages became vlr.gg links).
  // Ties keep the earliest match.
  const bestKillMatch = useMemo(() => {
    let best = null
    for (const m of allMatchRows) {
      const row = playersByMatch.get(m.id)?.find((r) => r.p === decodedName)
      if (!row || row.k == null) continue
      if (!best || row.k > best.kills) {
        best = {
          id: m.id,
          date: m.date,
          kills: row.k,
          maps: row.mp,
          agents: row.ag || [],
          opponent: m.team1 === row.t ? m.team2 : m.team1,
        }
      }
    }
    return best
  }, [allMatchRows, playersByMatch, decodedName])

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  const meta = data?.meta?.[decodedName]
  const displayTeam = meta ? teamInScope(filtered, meta.team) : null

  const agentColumns = [
    {
      // DataTable applies its own py-1.5 to every cell regardless of
      // noPadding (that flag only drops horizontal padding) -- the inner
      // span's own py-2 was stacking on top of that, doubling up to ~14px
      // of top/bottom padding on this row alone. Dropped to py-1 so the
      // bigger icon/text still gets a little of its own room without
      // compounding with the table's row padding.
      key: 'agent', label: 'Agent', align: 'left', noPadding: true, width: 130,
      format: (v) => (
        <span className="flex items-center gap-2.5 px-4 py-1">
          <AgentIcon agent={v} size={30} />
          <span className="font-body font-medium text-[14px]">{v}</span>
        </span>
      ),
    },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'RND', align: 'right', format: (v) => num(v) },
    {
      key: 'winPct', label: 'Win%', align: 'right', colorScale: true,
      format: (v, r) => (r.mapsPlayed ? pct(v, 0) : '—'),
    },
    { key: 'avgRating', label: 'R', align: 'right', colorScale: true, width: 70, format: (v) => rating(v) },
    { key: 'avgAcs', label: 'ACS', align: 'right', colorScale: true, format: (v) => num(v, 0) },
    { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v ? v.toFixed(2) : '—') },
    { key: 'avgKast', label: 'KAST', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'avgAdr', label: 'ADR', align: 'right', colorScale: true, format: (v) => num(v, 1) },
    { key: 'kpr', label: 'KPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'apr', label: 'APR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fkpr', label: 'FKPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fdpr', label: 'FDPR', align: 'right', colorScale: true, colorInvert: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'avgHsPct', label: 'HS%', align: 'right', colorScale: true, format: (v) => pct(v) },
  ]

  if (!meta) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/players" className="text-sm text-accent-bright hover:underline">← Back to Players</Link>
        <p className="text-muted text-sm">No player found matching "{decodedName}".</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/players" className="text-sm text-muted hover:text-ink w-fit">← Back to Players</Link>

      <div className="flex items-stretch gap-4">
        <div className="w-16 rounded-xl bg-surface2 border border-hairline flex items-center justify-center shrink-0">
          <Flag countryCode={meta.countryCode} countryName={meta.countryName} size={28} />
        </div>
        <div className="flex flex-col justify-center gap-1">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold text-ink">{decodedName}</h1>
            {role && (
              <span
                className="text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-surface2 text-muted"
                title="Inferred from the agents played in the player's most recent season -- Valorant has no position field"
              >
                {role}
              </span>
            )}
          </div>
          <Link
            to={`/teams/${encodeURIComponent(displayTeam)}`}
            className="text-muted text-sm hover:text-accent-bright w-fit"
          >
            <TeamLogo team={displayTeam} size={22} />
          </Link>
        </div>
      </div>

      {stats && stats.mapsPlayed > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Headline rating + qualitative tier + map record. */}
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-6 py-5 flex flex-col gap-1">
            <span className="text-muted text-xs font-medium tracking-wide uppercase">
              Avg Rating 2.0
            </span>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="font-display text-3xl font-semibold text-ink">
                {rating(stats.avgRating)}
              </span>
              {ratingTier(stats.avgRating) && (
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${ratingTier(stats.avgRating).tone}`}
                >
                  {ratingTier(stats.avgRating).label}
                </span>
              )}
            </div>
            <span className="text-muted text-xs">
              {stats.mapsWon}W – {stats.mapsLost}L · {pct(stats.winPct, 0)} map win rate
            </span>
          </div>

          {/* Most-played agent. */}
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-6 py-5 flex flex-col gap-1">
            <span className="text-muted text-xs font-medium tracking-wide uppercase">
              Most Played
            </span>
            {mostPlayedAgent ? (
              <>
                <div className="flex items-center gap-2.5">
                  <AgentIcon agent={mostPlayedAgent.agent} size={30} />
                  <span className="font-display text-2xl font-semibold text-ink">
                    {mostPlayedAgent.agent}
                  </span>
                </div>
                <span className="text-muted text-xs">
                  {num(mostPlayedAgent.mapsPlayed)}{' '}
                  {mostPlayedAgent.mapsPlayed === 1 ? 'map' : 'maps'} ·{' '}
                  {pct(mostPlayedAgent.winPct, 0)} win rate · {rating(mostPlayedAgent.avgRating)} rating
                </span>
              </>
            ) : (
              <span className="font-display text-2xl font-semibold text-muted">—</span>
            )}
          </div>

          {/* Best series by kills -- career-wide, not scoped to recentYear. */}
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-6 py-5 flex flex-col gap-1">
            <span className="text-muted text-xs font-medium tracking-wide uppercase">
              Most Kills in a Match
            </span>
            {bestKillMatch ? (
              <>
                <a
                  href={vlrMatchUrl(bestKillMatch.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View this match on vlr.gg"
                  className="flex items-baseline gap-2.5 hover:text-accent-bright transition-colors w-fit"
                >
                  <span className="font-display text-3xl font-semibold text-ink">
                    {num(bestKillMatch.kills)}
                  </span>
                  <span className="text-muted text-xs">
                    over {bestKillMatch.maps} {bestKillMatch.maps === 1 ? 'map' : 'maps'}
                  </span>
                </a>
                <span className="text-muted text-xs flex items-center gap-1.5 flex-wrap">
                  vs <TeamLogo team={bestKillMatch.opponent} size={16} />
                  {bestKillMatch.agents.length > 0 && (
                    <span className="flex items-center gap-1">
                      {/* Keyed by index, not agent name: `ag` is one entry
                          per MAP of the series, so a player who ran the
                          same agent on both maps of a 2-0 legitimately
                          has it twice. */}
                      · {bestKillMatch.agents.map((a, i) => (
                        <AgentIcon key={`${a}-${i}`} agent={a} size={16} />
                      ))}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span className="font-display text-3xl font-semibold text-muted">—</span>
            )}
          </div>
        </div>
      )}

      {allMatchRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-sm font-semibold text-ink">Performances</h3>
          <p className="text-muted text-xs">
            One bar per match, oldest to newest — bar height and colour are that series'
            Rating 2.0. Most recent 30 matches, across every season.
          </p>
          <PerformanceStrip
            matches={allMatchRows}
            playersByMatch={playersByMatch}
            playerName={decodedName}
          />
        </div>
      )}

      {agentRecords.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-display text-sm font-semibold text-ink">Agents</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Year chips only make sense as a scope control while no
                  event is selected -- once one is, the events themselves
                  are the scope, so the chips are dropped entirely rather
                  than left visible-but-dimmed and non-interactive. */}
              {agentEventOverrides.length === 0 && (
                <FilterChips
                  options={['All', ...agentYearOptions]}
                  value={effectiveAgentYear}
                  onChange={setAgentYear}
                />
              )}
              <EventPicker
                options={agentEventOptions}
                selected={agentEventOverrides}
                onAdd={addAgentEvent}
                onRemove={removeAgentEvent}
              />
            </div>
          </div>
          {agentRows.length > 0 ? (
            <DataTable
              columns={agentColumns}
              rows={agentRows}
              summaryRow={agentOverall}
              defaultSortKey="mapsPlayed"
            />
          ) : (
            <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-6 text-center">
              <p className="text-muted text-sm">No agent data for {agentScopeLabel}.</p>
            </div>
          )}
        </div>
      )}

      {radar && (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
            <h3 className="font-display text-sm font-semibold text-ink">Performance profile</h3>

            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: '#FF4655' }} />
              <span className="text-xs text-ink font-medium">{decodedName}</span>
              <span className="text-muted text-xs">vs</span>
              <input
                list="radar-compare-options"
                value={compareInput}
                onChange={(e) => setCompareInput(e.target.value)}
                onBlur={commitCompare}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitCompare(); e.currentTarget.blur() }
                }}
                placeholder="Compare a player…"
                className="w-40 bg-surface2 border border-hairline rounded-md px-2.5 py-1 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-muted"
              />
              <datalist id="radar-compare-options">
                {compareOptions.map((n) => <option key={n} value={n} />)}
              </datalist>
              {radar.compareName && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: '#FFD47D' }} />
                  <button
                    type="button"
                    onClick={clearCompare}
                    className="text-muted hover:text-ink text-xs leading-none"
                    title="Clear comparison"
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          </div>

          <p className="text-muted text-xs mb-4">
            Each spoke is its own scale — position is percentile within qualified players (rounds
            played ≥ half the scope's median, min 20) in the {recentYear} season, not an absolute
            value. Hover a point for rank.
            {!radar.subjectQualified && ` Small sample for ${decodedName} — below the qualification bar in this scope.`}
            {radar.compareName && radar.compareQualified === false && ` Small sample for ${radar.compareName} — below the qualification bar in this scope.`}
            {compareName && compareName === decodedName && ' Pick a different player to compare against.'}
            {radar.compareMissing && ` No data for "${compareName}" in this scope.`}
          </p>

          <div className="max-w-xl mx-auto">
            <RadarChart axes={radar.axes} />
          </div>
        </div>
      )}

      {countryKdBars.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-sm font-semibold text-ink">K/D by country</h3>
          <p className="text-muted text-xs">
            {decodedName}'s own K/D in kill duels against opponents from each country, across every
            match — not that country's own skill level, just how {decodedName} personally does
            against players from there.
          </p>
          <CountryKdChart bars={countryKdBars} />
        </div>
      )}

      {!stats ? (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">No maps in this scope.</p>
        </div>
      ) : (
        <>
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-4">Totals</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Kills" value={num(stats.totalKills)} />
              <Stat label="Deaths" value={num(stats.totalDeaths)} />
              <Stat label="Assists" value={num(stats.totalAssists)} />
              <Stat label="First Kills" value={num(stats.totalFirstKills)} />
              <Stat label="First Deaths" value={num(stats.totalFirstDeaths)} />
              <Stat label="2K" value={num(stats.total2k)} />
              <Stat label="3K" value={num(stats.total3k)} />
              <Stat label="4K" value={num(stats.total4k)} />
              <Stat label="Ace" value={num(stats.totalAce)} />
              <Stat label="Clutches Won" value={num(stats.totalClutches)} />
              <Stat label="Plants" value={stats.utilMaps ? num(stats.totalPlants) : '—'} />
              <Stat label="Defuses" value={stats.utilMaps ? num(stats.totalDefuses) : '—'} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Match history</h3>
            <p className="text-muted text-xs">
              {decodedName}'s line in every match — click a row for the full scoreboard.
            </p>
            <MatchHistory
              matches={visibleMatchRows}
              playersByMatch={playersByMatch}
              perspective={{ type: 'player', name: decodedName }}
            />
            {matchLimit < sortedMatchRows.length && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMatchLimit((l) => Math.min(l + 30, sortedMatchRows.length))}
                className="self-center hover:border-accent-bright/40 hover:text-accent-bright"
              >
                Load more ({sortedMatchRows.length - matchLimit} more)
              </Button>
            )}
          </div>

          {meta.isChina && (
            <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
              China-region matches don't publish multi-kill, clutch, or economy data on VLR, so those
              totals read 0 here if this player's {recentYear} season was based in China, even if
              they also competed internationally.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
      <span className="font-body text-lg text-ink font-medium">{value}</span>
    </div>
  )
}
