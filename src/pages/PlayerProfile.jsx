import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateAgentBuckets, teamInScope,
  expandMatchRows, groupMatchPlayers,
} from '../lib/entityBuckets'
import { rolesInScope } from '../lib/peerComparison'
import { aggregatePlayerDuelsByOpponent, aggregateKdByCountry } from '../lib/playerDuels'
import { buildPlayerMapPerformance } from '../lib/playerMapPerformance'
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
import { rating, pct, num, ratingTier, vlrMatchUrl, eventLabel, birthDateLabel } from '../lib/format'
import { useFollowed } from '../lib/useFollowed'

export default function PlayerProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data, loading } = useData('player_buckets')
  const { data: agentData } = useData('player_agents')
  const { data: matchData } = useData('match_results')
  const { data: matchPlayerData } = useData('match_players')
  // Real name, from each player's own Liquipedia page (see
  // scraper/liquipedia_player_names_scraper.py) -- a small file, so it
  // loads unconditionally rather than idle-deferred. Keyed lowercase there
  // since Liquipedia's own page-title casing ("Basic") doesn't reliably
  // match this site's own player-name casing ("basic", sourced from VLR).
  const { data: realNamesData } = useData('player_real_names')
  const realName = realNamesData?.[decodedName.toLowerCase()]
  // Same Liquipedia infobox fetch as realName above, see
  // liquipedia_player_names_scraper.py -- a separate file rather than a
  // second field on player_real_names.json since a birth date is a
  // structurally different kind of value (needs its own null-safe date
  // formatting, not just a display string).
  const { data: birthdatesData } = useData('player_birthdates')
  const birthDate = birthdatesData?.[decodedName.toLowerCase()]

  // No accounts on a static site -- "Follow" persists per-browser via
  // localStorage instead of a server-side watchlist. See useFollowed.js.
  const [followed, toggleFollowed] = useFollowed('players', decodedName)

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

  // Player duels, by opponent's country -- match_duels.json is comparable
  // in size to match_players.json (already loaded unconditionally above),
  // so it's idle-loaded rather than competing with first-paint bandwidth.
  const idle = useIdle()
  const { data: duelData } = useData(idle ? 'match_duels' : null)
  // Per-map (not per-series) rating for the Performances strip -- see
  // playerMapPerformance.js's own comment for why this needs a third file
  // (team_map_detail.json) joined in alongside match_results/match_players.
  // Comparable in size to match_duels.json, so idle-loaded the same way.
  const { data: teamMapDetailData } = useData(idle ? 'team_map_detail' : null)

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

  // One row per MAP (not per series) for the Performances strip -- see
  // playerMapPerformance.js. Empty until team_map_detail.json lands
  // (idle-loaded), same graceful-until-ready pattern every idle-loaded
  // section on this page already follows.
  const mapPerformanceRows = useMemo(
    () => buildPlayerMapPerformance(allMatchRows, matchPlayerData, teamMapDetailData, decodedName),
    [allMatchRows, matchPlayerData, teamMapDetailData, decodedName]
  )

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

      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-4 py-4 sm:px-6 overflow-hidden">
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          {/* Headshot placeholder -- this site's scraper pipeline has no
              player-photo source (VLR doesn't expose one in a scrapable way),
              so this reserves the frame rather than silently omitting it.
              Swap the SVG for a real <img src={meta.photo}> if a photo source
              is ever added. The blurred halo behind it echoes rft.gg's own
              header photo treatment, just without a real image to blur. */}
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0">
            <div className="absolute inset-0 rounded-xl bg-accent/25 blur-2xl" aria-hidden="true" />
            <div className="relative w-full h-full rounded-xl bg-surface2 border border-hairline flex items-center justify-center overflow-hidden">
              <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 sm:w-12 sm:h-12 text-muted/40" aria-hidden="true">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 20.5c0-4.42 3.58-7.5 8-7.5s8 3.08 8 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink truncate">{decodedName}</h1>
              <button
                type="button"
                onClick={toggleFollowed}
                aria-pressed={followed}
                title={followed ? 'Unfollow' : 'Follow'}
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border transition-colors shrink-0 ${
                  followed
                    ? 'border-accent/40 text-accent-bright bg-accent/10'
                    : 'border-hairline text-muted hover:text-ink hover:border-accent/40'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill={followed ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
                </svg>
                {followed ? 'Following' : 'Follow'}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-muted text-sm">
              <span className="flex items-center gap-1.5">
                <Flag countryCode={meta.countryCode} countryName={meta.countryName} size={14} />
                {realName || meta.countryName}
              </span>
              {displayTeam && (
                <>
                  <span className="text-hairline">·</span>
                  <Link
                    to={`/teams/${encodeURIComponent(displayTeam)}`}
                    className="flex items-center hover:text-accent-bright transition-colors"
                  >
                    <TeamLogo team={displayTeam} size={18} />
                  </Link>
                </>
              )}
              {role && (
                <>
                  <span className="text-hairline">·</span>
                  <span
                    // text-sm, not text-xs -- this row's font-size/line-height
                    // is otherwise uniform across every item (flag+realname,
                    // team, birthdate), all sized by the shared `text-sm` on
                    // the row itself. A smaller size here alone shrank this
                    // span's own line box, which the row's flex centering
                    // then visibly nudged out of line with its neighbors.
                    className="uppercase tracking-wide font-medium"
                    title="Inferred from the agents played in the player's most recent season -- Valorant has no position field"
                  >
                    {role}
                  </span>
                </>
              )}
              {birthDate && (
                <>
                  <span className="text-hairline">·</span>
                  <span className="flex items-center gap-1.5">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5 opacity-70"
                      aria-hidden="true"
                    >
                      <path d="M8 2v4" />
                      <path d="M16 2v4" />
                      <rect width="18" height="18" x="3" y="4" rx="2" />
                      <path d="M3 10h18" />
                    </svg>
                    {birthDateLabel(birthDate)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <Button
          as={Link}
          to={`/compare?a=${encodeURIComponent(decodedName)}`}
          variant="outline"
          size="sm"
          className="self-start sm:self-center shrink-0"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <circle cx="5" cy="6" r="3" />
            <path d="M12 6h5a2 2 0 0 1 2 2v7" />
            <path d="m15 9-3-3 3-3" />
            <circle cx="19" cy="18" r="3" />
            <path d="M12 18H7a2 2 0 0 1-2-2V9" />
            <path d="m9 15 3 3-3 3" />
          </svg>
          Compare
        </Button>
      </div>

      {stats && stats.mapsPlayed > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {/* Headline rating + qualitative tier + map record. */}
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-muted text-[10px] font-medium tracking-wide uppercase truncate">
              Avg Rating 2.0
            </span>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-display text-xl font-semibold text-ink">
                {rating(stats.avgRating)}
              </span>
              {ratingTier(stats.avgRating) && (
                <span
                  className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${ratingTier(stats.avgRating).tone}`}
                >
                  {ratingTier(stats.avgRating).label}
                </span>
              )}
            </div>
            <span className="text-muted text-[10px] truncate">
              {stats.mapsWon}W – {stats.mapsLost}L · {pct(stats.winPct, 0)} win
            </span>
          </div>

          {/* Most-played agent. */}
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-muted text-[10px] font-medium tracking-wide uppercase truncate">
              Most Played
            </span>
            {mostPlayedAgent ? (
              <>
                <div className="flex items-center gap-1.5 min-w-0">
                  <AgentIcon agent={mostPlayedAgent.agent} size={20} />
                  <span className="font-display text-lg font-semibold text-ink truncate">
                    {mostPlayedAgent.agent}
                  </span>
                </div>
                <span className="text-muted text-[10px] truncate">
                  {num(mostPlayedAgent.mapsPlayed)}{' '}
                  {mostPlayedAgent.mapsPlayed === 1 ? 'map' : 'maps'} ·{' '}
                  {pct(mostPlayedAgent.winPct, 0)} win
                </span>
              </>
            ) : (
              <span className="font-display text-lg font-semibold text-muted">—</span>
            )}
          </div>

          {/* Best series by kills -- career-wide, not scoped to recentYear. */}
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-muted text-[10px] font-medium tracking-wide uppercase truncate">
              Most Kills
            </span>
            {bestKillMatch ? (
              <>
                <a
                  href={vlrMatchUrl(bestKillMatch.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View this match on vlr.gg"
                  className="flex items-baseline gap-1.5 hover:text-accent-bright transition-colors w-fit"
                >
                  <span className="font-display text-xl font-semibold text-ink">
                    {num(bestKillMatch.kills)}
                  </span>
                  <span className="text-muted text-[10px] truncate">
                    over {bestKillMatch.maps} {bestKillMatch.maps === 1 ? 'map' : 'maps'}
                  </span>
                </a>
                <span className="text-muted text-[10px] flex items-center gap-1 truncate">
                  vs <TeamLogo team={bestKillMatch.opponent} size={14} />
                </span>
              </>
            ) : (
              <span className="font-display text-xl font-semibold text-muted">—</span>
            )}
          </div>
        </div>
      )}

      {allMatchRows.length > 0 && (
        <PerformanceStrip rows={mapPerformanceRows} />
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
