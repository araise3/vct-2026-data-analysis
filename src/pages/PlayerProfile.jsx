import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateAgentBuckets, teamInScope,
  expandMatchRows, groupMatchPlayers, groupByEntity,
} from '../lib/entityBuckets'
import { rolesInScope } from '../lib/peerComparison'
import { aggregatePlayerDuelsByOpponent, aggregateKdByCountry } from '../lib/playerDuels'
import { buildPlayerMapPerformance } from '../lib/playerMapPerformance'
import { buildTrophyWinners, playerTrophies } from '../lib/trophies'
import CountryKdChart from '../components/CountryKdChart'
import TrophyCase from '../components/TrophyCase'
import FilterChips from '../components/FilterChips'
import EventPicker from '../components/EventPicker'
import DataTable from '../components/DataTable'
import MatchHistory from '../components/MatchHistory'
import PerformanceStrip from '../components/PerformanceStrip'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import AgentIcon from '../components/AgentIcon'
import Button from '../components/ui/Button'
import { dynamicQualify, dynamicQualifyThreshold } from '../components/LeaderCard'
import { rating, pct, num, ratingTier, eventLabel, birthDateLabel, trackerProfileUrl } from '../lib/format'
import trackerLinks from '../lib/trackerLinks.json'

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
  // scraper/vlr_player_photos_scraper.py's own manifest -- {handleLower:
  // "player_photos/{handle}.png"}, present only for a player VLR itself has
  // a real (non-placeholder) avatar on file for. Absent entirely for most
  // players until that scraper's been run; the header below falls back to
  // the SVG placeholder exactly as it did before this existed.
  const { data: photosData } = useData('player_photos')
  const photoPath = photosData?.[decodedName.toLowerCase()]
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false)
  useEffect(() => {
    setPhotoLoadFailed(false)
  }, [decodedName])
  // This player's PERSONAL ranked-ladder stats for the current VALORANT Act,
  // via their linked Riot account -- built by data_prep/fetch_act_stats.py
  // (see its docstring for why HenrikDev's API rather than tracker.gg's, and
  // why these have to be summed from match records). Present only for the
  // handful of players with a resolved tracker link, so the overview card's
  // source toggle below only appears when there's actually something to
  // toggle TO. Deliberately kept as a separate, clearly-labelled view rather
  // than merged into the pro numbers: these are solo ladder games against a
  // completely different population, and averaging them together would be
  // meaningless.
  const { data: actStatsData } = useData('player_act_stats')
  const actStats = actStatsData?.players?.[decodedName.toLowerCase()]
  const [statSource, setStatSource] = useState('pro')
  useEffect(() => {
    setStatSource('pro')
  }, [decodedName])
  // Guards the case where the file loads (or the player changes) while
  // 'ranked' is selected but this player has no Act stats -- without this
  // the card would render an empty ranked view instead of falling back.
  const showRanked = statSource === 'ranked' && !!actStats
  // Hand-curated handle -> [{puuid, riotId}, ...] map for the tracker.gg
  // link(s), see trackerLinks.json's own comment for why this can't be
  // sourced from either scraper. A static import (like teamLogos.json), not
  // a useData fetch -- this is source-committed lookup data, not a
  // pipeline-generated public/data file. A player can have more than one
  // known account (main + smurf/alt), so this is a list -- the first entry
  // is treated as the "main" one, any further entries render behind a
  // dropdown (see trackerMenuOpen below). Each `riotId` is kept fresh by
  // data_prep/resolve_tracker_puuids.py (run daily by CI) re-resolving
  // `puuid` -- Riot's own permanent per-account id -- back to the player's
  // CURRENT Name#Tag, so a rename doesn't quietly break the link.
  const trackerAccounts = trackerLinks[decodedName.toLowerCase()] ?? []
  const [trackerMenuOpen, setTrackerMenuOpen] = useState(false)
  // The dropdown itself renders through a portal into document.body (see
  // the createPortal call below) rather than as a normal descendant of the
  // header card -- that card has `overflow-hidden` (needed to clip the
  // headshot's blurred halo to the card's rounded corners), which was also
  // silently clipping any dropdown item that fell past the card's own
  // bottom edge. Portaling escapes that ancestor's overflow/stacking
  // context entirely instead of fighting it with z-index. Two refs:
  // trackerTriggerRef covers the visible button pair (for position + the
  // "is this click on the trigger" half of outside-click detection),
  // trackerMenuRef covers the portaled panel (the other half).
  const [trackerMenuPos, setTrackerMenuPos] = useState(null)
  const trackerTriggerRef = useRef(null)
  const trackerMenuRef = useRef(null)
  useEffect(() => {
    if (!trackerMenuOpen) return
    function onDocMouseDown(e) {
      if (
        trackerTriggerRef.current && !trackerTriggerRef.current.contains(e.target) &&
        trackerMenuRef.current && !trackerMenuRef.current.contains(e.target)
      ) setTrackerMenuOpen(false)
    }
    // Closes on scroll/resize rather than re-tracking position -- the menu
    // is short-lived (pick an account, it closes itself) so a live-follow
    // wasn't worth the extra scroll-listener churn.
    function onScrollOrResize() {
      setTrackerMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [trackerMenuOpen])
  useEffect(() => {
    setTrackerMenuOpen(false)
  }, [decodedName])

  function toggleTrackerMenu() {
    if (!trackerMenuOpen && trackerTriggerRef.current) {
      const rect = trackerTriggerRef.current.getBoundingClientRect()
      setTrackerMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setTrackerMenuOpen((o) => !o)
  }
  // Same Liquipedia infobox fetch as realName above, see
  // liquipedia_player_names_scraper.py -- a separate file rather than a
  // second field on player_real_names.json since a birth date is a
  // structurally different kind of value (needs its own null-safe date
  // formatting, not just a display string).
  const { data: birthdatesData } = useData('player_birthdates')
  const birthDate = birthdatesData?.[decodedName.toLowerCase()]

  // Every one of this player's own buckets, across every year/competition --
  // the page-wide multi-facet FilterPanel (region/event/phase/week/split/
  // competition + date range) this used to run through was built for list
  // pages with dozens of entities in scope at once; on a single player's
  // profile it was mostly empty chip groups. Replaced with one fixed rule
  // instead: everything below except the Agents table (its own small
  // year/event picker, see below) pins to this player's most recent season.
  const records = useMemo(
    () => (data ? expandBuckets(data, 'p', (b) => b.p === decodedName) : []),
    [data, decodedName]
  )

  const recentYear = useMemo(
    () => (records.length ? Math.max(...records.map((r) => r.year)) : null),
    [records]
  )

  // Trophy case -- every Kickoff/Masters/Champions/LOCK//IN this player's
  // own buckets show them on the champion team for, derived straight from
  // match_results.json's real Grand Final results (see trophies.js). Career-
  // wide like the header cards below it, not scoped to recentYear -- a
  // trophy won two seasons ago doesn't stop being real once the page
  // narrows to the current year.
  const allTrophies = useMemo(() => buildTrophyWinners(matchData), [matchData])
  const myTrophies = useMemo(() => playerTrophies(records, allTrophies), [records, allTrophies])

  const filtered = useMemo(
    () => records.filter((r) => r.year === recentYear),
    [records, recentYear]
  )

  const stats = useMemo(
    () => aggregatePlayerBuckets(filtered),
    [filtered]
  )

  // Tracker Score -- tracker.gg's own composite performance rating (see
  // https://tracker.gg/valorant/articles/tracker-score-our-new-performance-rating):
  // a 0-1000 number built from 4 stats (their Valorant picks: Win%, KAST,
  // ACS, Damage Delta/Round), each scored on how this player performs
  // RELATIVE TO THE WHOLE PLAYER POPULATION rather than as a raw value,
  // then averaged. Two things in that source article that had to be
  // adapted rather than copied verbatim:
  //   - Their per-stat WEIGHTING is explicitly undisclosed ("based on a
  //     combination of intuition... and a more boring detailed analysis")
  //     -- there's no published formula to match, so this weights all 4
  //     equally, the only defensible default absent real numbers.
  //   - "Damage Delta per Round" (damage dealt minus the OPPOSING team's
  //     average that round) isn't a stat this pipeline tracks at all --
  //     only plain ADR is exported per player. ADR stands in for it here.
  // This is an adaptation of the published CONCEPT for this site's own
  // data, not a port of tracker.gg's own (also non-public) implementation.
  //
  // Population = every player with a bucket in this player's own
  // recentYear (same "current season" scope everything else on this page
  // uses), gated by the same round-count qualification bar Records.jsx's
  // "Most consistent" card and Player of the Month already use
  // (`dynamicQualify`/`dynamicQualifyThreshold` from LeaderCard.jsx) --
  // without it, a 1-map call-up with a lucky ace would sit at a false
  // 100th percentile and skew the whole distribution.
  const populationStats = useMemo(() => {
    if (!data || !recentYear) return []
    const yearRecords = expandBuckets(data, 'p').filter((r) => r.year === recentYear)
    const byPlayer = groupByEntity(yearRecords)
    const rows = []
    for (const buckets of byPlayer.values()) {
      const s = aggregatePlayerBuckets(buckets)
      if (s) rows.push(s)
    }
    return rows
  }, [data, recentYear])

  const trackerScore = useMemo(() => {
    if (!stats || !populationStats.length) return null
    // `fixed` is required -- every other call site in this codebase passes
    // one (dynamicQualifyThreshold's own default leaves it undefined,
    // which silently produces NaN via Math.min(undefined, ...) and an
    // always-empty qualified population, caught live while testing this).
    // 150 rounds (~6-7 maps) matches Teams.jsx's own atkRounds/defRounds
    // bar for a full-season round-count qualification.
    const threshold = dynamicQualifyThreshold(populationStats, 'roundsPlayed', { fixed: 150 })
    // This player's own sample must clear the same bar the population does
    // -- a small-sample player shouldn't get a headline score built off a
    // handful of maps, qualified population or not.
    if (stats.roundsPlayed < threshold) return null
    const qualified = populationStats.filter((r) => r.roundsPlayed >= threshold)
    if (qualified.length < 2) return null

    const percentileOf = (key, value) => {
      const pool = qualified.map((r) => r[key]).filter((v) => v != null)
      if (!pool.length || value == null) return null
      const below = pool.filter((v) => v < value).length
      return (below / pool.length) * 100
    }

    // `statKey`, not `key` -- these objects get spread as JSX props below
    // (`<TrackerScoreMetric {...m} />`), and React treats a literal `key`
    // field inside a spread props object as an error-worthy footgun (it
    // looks like it's setting the reconciliation key but silently isn't),
    // caught live via a real console warning while testing this.
    const metrics = [
      { statKey: 'winPct', label: 'Win %', value: stats.winPct, format: (v) => pct(v, 0) },
      { statKey: 'avgKast', label: 'KAST', value: stats.avgKast, format: (v) => pct(v, 0) },
      { statKey: 'avgAcs', label: 'ACS', value: stats.avgAcs, format: (v) => num(v, 0) },
      { statKey: 'avgAdr', label: 'ADR', value: stats.avgAdr, format: (v) => num(v, 0) },
    ].map((m) => ({ ...m, percentile: percentileOf(m.statKey, m.value) }))

    const scored = metrics.filter((m) => m.percentile != null)
    if (!scored.length) return null
    const avgPercentile = scored.reduce((sum, m) => sum + m.percentile, 0) / scored.length
    return { score: Math.round(avgPercentile * 10), metrics: scored }
  }, [stats, populationStats])

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

  // The role badge next to the player's name pins to the most recent
  // season, same rule as the rest of the header -- NOT the Agents table's
  // own year/event pickers below, which the user can switch independently
  // without the header jumping around underneath them.
  const agentRecordsRecentYear = useMemo(
    () => agentRecords.filter((r) => r.year === recentYear),
    [agentRecords, recentYear]
  )

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

      <div className="relative flex flex-col gap-4 bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-4 py-4 sm:px-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          {/* Real photo when scraper/vlr_player_photos_scraper.py's manifest
              has one for this handle (a minority of players -- most of VLR
              itself only has the shared placeholder silhouette, which this
              site treats the same as "no photo known" rather than
              downloading and showing VLR's own placeholder art). Falls back
              to this SVG silhouette otherwise, which also reserves the frame
              rather than silently omitting it. `photoLoadFailed` covers a
              stale manifest entry pointing at a file that's since been
              removed/renamed -- caught via onError rather than trusted blind,
              since this is committed data that can drift from the actual
              contents of public/player_photos/. The blurred halo (echoing
              rft.gg's own header photo treatment) only renders behind the
              EMPTY placeholder -- behind a real photo it read as a red glare
              bleeding past the frame's edges rather than a nice glow, since
              a real photo has its own colors/edges the halo just fights
              with instead of complementing. */}
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0">
            {!(photoPath && !photoLoadFailed) && (
              <div className="absolute inset-0 rounded-xl bg-accent/25 blur-2xl" aria-hidden="true" />
            )}
            <div className="relative w-full h-full rounded-xl bg-surface2 border border-hairline flex items-center justify-center overflow-hidden">
              {photoPath && !photoLoadFailed ? (
                <img
                  src={`${import.meta.env.BASE_URL}${photoPath}`}
                  alt={decodedName}
                  className="w-full h-full object-cover"
                  onError={() => setPhotoLoadFailed(true)}
                />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 sm:w-12 sm:h-12 text-muted/40" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 20.5c0-4.42 3.58-7.5 8-7.5s8 3.08 8 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink truncate">{decodedName}</h1>
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

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          {trackerAccounts.length > 0 && (
            <div className="relative flex items-stretch" ref={trackerTriggerRef}>
              <Button
                as="a"
                href={trackerProfileUrl(trackerAccounts[0].riotId)}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="sm"
                title={`tracker.gg profile for ${trackerAccounts[0].riotId}`}
                className={trackerAccounts.length > 1 ? 'rounded-r-none border-r-0' : ''}
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
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                </svg>
                Tracker.gg
              </Button>
              {trackerAccounts.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={toggleTrackerMenu}
                    title={`${trackerAccounts.length - 1} more account${trackerAccounts.length > 2 ? 's' : ''}`}
                    className="rounded-l-none"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`w-3.5 h-3.5 transition-transform ${trackerMenuOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </Button>
                  {trackerMenuOpen && trackerMenuPos && createPortal(
                    <div
                      ref={trackerMenuRef}
                      style={{ position: 'fixed', top: trackerMenuPos.top, right: trackerMenuPos.right }}
                      className="z-50 min-w-[200px] bg-surface border border-hairline rounded-lg shadow-depth-md overflow-hidden"
                    >
                      {trackerAccounts.map((acct, i) => (
                        <a
                          key={acct.riotId}
                          href={trackerProfileUrl(acct.riotId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setTrackerMenuOpen(false)}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-ink hover:bg-surface2 transition-colors"
                        >
                          <span className="truncate">{acct.riotId}</span>
                          <span className="text-[9px] uppercase tracking-wide text-muted shrink-0">
                            {i === 0 ? 'Main' : 'Alt'}
                          </span>
                        </a>
                      ))}
                    </div>,
                    document.body
                  )}
                </>
              )}
            </div>
          )}
          <Button
            as={Link}
            to={`/compare?a=${encodeURIComponent(decodedName)}`}
            variant="outline"
            size="sm"
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
        </div>

        <TrophyCase trophies={myTrophies} />
      </div>

      {stats && stats.mapsPlayed > 0 && (
        // tracker.gg-style "overview" card -- one unified dark panel with a
        // brand-colored left rail, a row of headline stats (Rating/ACS/K-D/
        // Win%, tracker.gg's own DMG-Round/K-D/HS%/Win% quartet with Rating
        // 2.0 swapped in for DMG/Round -- this site treats Rating as the
        // single most important number the same way tracker.gg treats raw
        // damage), a denser secondary grid, and a Tracker Score footer --
        // replacing the previous 3 separate cards (Avg Rating / Most Played
        // / Most Kills). Most Played Agent and Most Kills were dropped
        // entirely rather than folded in somewhere else -- neither has a
        // real equivalent on tracker.gg's own overview (confirmed against
        // the reference screenshot), and Most Played Agent duplicates the
        // Agents table's own top row (sorted by mapsPlayed) further down
        // anyway.
        <div className="relative bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1 bg-grad-accent" aria-hidden="true" />
          <div className="pl-4 pr-3 py-3 sm:pl-5 sm:pr-5 sm:py-4 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* Source toggle -- only rendered when this player actually has
                  linked-account Act stats, so it never appears as a dead
                  control. Labels name the POPULATION each view describes
                  ("Pro matches" vs "Ranked"), not the data source, since the
                  distinction that matters to a reader is which games these
                  numbers come from. */}
              {actStats ? (
                <div className="flex items-center gap-0.5 p-0.5 bg-surface2 rounded-lg">
                  {[
                    { id: 'pro', label: 'Pro matches' },
                    { id: 'ranked', label: 'Ranked' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setStatSource(opt.id)}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                        (opt.id === 'ranked') === showRanked
                          ? 'bg-selected text-white'
                          : 'text-muted hover:text-ink'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                {showRanked ? (
                  <span className="text-muted text-xs">
                    {actStats.actShort ? `Act ${actStats.actShort} · ` : ''}
                    {actStats.wins}W – {actStats.losses}L
                    {actStats.draws ? ` – ${actStats.draws}D` : ''}
                    {actStats.winPct != null ? ` · ${pct(actStats.winPct, 0)} win` : ''}
                  </span>
                ) : (
                  <>
                    {ratingTier(stats.avgRating) && (
                      <span
                        className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${ratingTier(stats.avgRating).tone}`}
                      >
                        {ratingTier(stats.avgRating).label}
                      </span>
                    )}
                    <span className="text-muted text-xs">
                      {stats.mapsWon}W – {stats.mapsLost}L · {pct(stats.winPct, 0)} win
                    </span>
                  </>
                )}
              </div>
            </div>

            {showRanked ? (
              <>
                {/* No Rating 2.0 here, deliberately -- it's a VLR-computed
                    stat that only exists for scraped pro matches, with no
                    equivalent in Riot's own match data. Showing a blank or
                    borrowed value would imply the two views are the same
                    four measurements. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 md:gap-x-0 md:divide-x md:divide-hairline">
                  <PrimaryStat label="ACS" value={actStats.acs != null ? num(actStats.acs, 0) : '—'} />
                  <PrimaryStat label="K/D Ratio" value={actStats.kd != null ? actStats.kd.toFixed(2) : '—'} />
                  <PrimaryStat label="Win %" value={actStats.winPct != null ? pct(actStats.winPct, 0) : '—'} />
                  <PrimaryStat label="HS %" value={actStats.hsPct != null ? pct(actStats.hsPct, 1) : '—'} />
                </div>

                <div className="grid grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-3 pt-3 border-t border-hairline">
                  <Stat label="Matches" value={num(actStats.matches)} />
                  <Stat label="Wins" value={num(actStats.wins)} />
                  <Stat label="Losses" value={num(actStats.losses)} />
                  <Stat label="Kills" value={num(actStats.kills)} />
                  <Stat label="Deaths" value={num(actStats.deaths)} />
                  <Stat label="Assists" value={num(actStats.assists)} />
                  <Stat label="ADR" value={actStats.adr != null ? num(actStats.adr, 1) : '—'} />
                  <Stat label="KPR" value={actStats.kpr != null ? actStats.kpr.toFixed(2) : '—'} />
                  <Stat label="KDA" value={actStats.kda != null ? actStats.kda.toFixed(2) : '—'} />
                  <Stat label="Rounds" value={num(actStats.rounds)} />
                  <Stat label="Avg Kills" value={actStats.avgKills != null ? num(actStats.avgKills, 1) : '—'} />
                  <Stat label="Headshots" value={num(actStats.headshots)} />
                </div>

                <p className="text-muted text-[10px] leading-relaxed pt-1">
                  Personal competitive ladder stats for {actStats.riotId}
                  {actStats.region ? ` (${actStats.region.toUpperCase()})` : ''} this Act, via their
                  linked Riot account — solo queue games, not pro matches, so these aren't comparable
                  with the numbers above.
                </p>
              </>
            ) : (
              <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 md:gap-x-0 md:divide-x md:divide-hairline">
              <PrimaryStat label="Rating 2.0" value={rating(stats.avgRating)} />
              <PrimaryStat label="ACS" value={num(stats.avgAcs, 0)} />
              <PrimaryStat label="K/D Ratio" value={stats.kd ? stats.kd.toFixed(2) : '—'} />
              <PrimaryStat label="Win %" value={pct(stats.winPct, 0)} />
            </div>

            <div className="grid grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-3 pt-3 border-t border-hairline">
              <Stat label="Wins" value={num(stats.mapsWon)} />
              <Stat label="KAST" value={pct(stats.avgKast)} />
              <Stat label="ADR" value={num(stats.avgAdr, 1)} />
              <Stat label="Kills" value={num(stats.totalKills)} />
              <Stat label="Deaths" value={num(stats.totalDeaths)} />
              <Stat label="Assists" value={num(stats.totalAssists)} />
              <Stat label="HS%" value={pct(stats.avgHsPct)} />
              <Stat label="First Kills" value={num(stats.totalFirstKills)} />
              <Stat label="First Deaths" value={num(stats.totalFirstDeaths)} />
              <Stat label="Clutches" value={num(stats.totalClutches)} />
              <Stat label="2K" value={num(stats.total2k)} />
              <Stat label="3K" value={num(stats.total3k)} />
            </div>
              </>
            )}

            {/* Tracker Score is computed as percentiles against this site's
                own PRO player population, so it's meaningless next to ranked
                ladder numbers -- hidden rather than recomputed for a
                population this site doesn't have. */}
            {!showRanked && trackerScore && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-3 border-t border-hairline">
                <div className="flex items-center gap-2.5 shrink-0 sm:w-36">
                  <TrackerScoreBadge score={trackerScore.score} />
                  <div className="flex flex-col">
                    <span className="text-muted text-[10px] uppercase tracking-wide">Tracker Score</span>
                    <span className="font-display text-lg font-bold text-ink">
                      {trackerScore.score}
                      <span className="text-muted text-xs font-normal">/1000</span>
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
                  {trackerScore.metrics.map((m) => (
                    <TrackerScoreMetric key={m.statKey} {...m} />
                  ))}
                </div>
              </div>
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

// The overview card's headline row -- bigger/bolder than Stat above, and
// padded for the md:divide-x rail between items (only active at md+, where
// this is guaranteed a single row of 4; see that grid's own comment on why
// the divider is skipped on the 2x2 mobile layout).
function PrimaryStat({ label, value }) {
  return (
    <div className="flex flex-col gap-1 md:px-4 md:first:pl-0 md:last:pr-0">
      <span className="text-muted text-[10px] font-medium tracking-wide uppercase truncate">{label}</span>
      <span className="font-display text-2xl font-semibold text-ink">{value}</span>
    </div>
  )
}

// Tracker Score tier lookup -- see the trackerScore useMemo's own comment
// for what's being adapted from tracker.gg's article and why. Colors
// mirror the article's own scheme (S=Blue, A=Green, B=Yellow, C=Grey,
// D=Rose); this site has no "blue" token, so the existing slate-blue
// `selected` color (already reserved for "this is the standout/active
// one" elsewhere -- see tailwind.config.js) stands in for it. Percentile
// cutoffs (90/75/50/25) are an even split, not a reverse-engineered exact
// match -- tracker.gg doesn't publish theirs either.
function trackerTier(percentile) {
  if (percentile == null) return null
  if (percentile >= 90) return { label: 'S', tone: 'text-selected-bright bg-selected/15' }
  if (percentile >= 75) return { label: 'A', tone: 'text-good bg-good/10' }
  if (percentile >= 50) return { label: 'B', tone: 'text-mid bg-mid/10' }
  if (percentile >= 25) return { label: 'C', tone: 'text-muted bg-surface2' }
  return { label: 'D', tone: 'text-bad bg-bad/10' }
}

function TrackerScoreBadge({ score }) {
  const tier = trackerTier(score / 10)
  return (
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-display font-bold shrink-0 ${tier ? tier.tone : 'text-muted bg-surface2'}`}
      title="Tracker Score tier"
    >
      {tier ? tier.label : '—'}
    </div>
  )
}

function TrackerScoreMetric({ label, value, format, percentile }) {
  const tier = trackerTier(percentile)
  const topPct = percentile == null ? null : Math.max(0.1, 100 - percentile)
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted text-[10px] uppercase tracking-wide truncate">{label}</span>
        {tier && (
          <span className={`text-[9px] font-semibold px-1 rounded shrink-0 ${tier.tone}`}>{tier.label}</span>
        )}
      </div>
      <span className="font-body text-sm text-ink font-medium">{format(value)}</span>
      {topPct != null && (
        <>
          <div className="h-1 rounded-full bg-surface2 overflow-hidden">
            <div className="h-full bg-grad-accent rounded-full" style={{ width: `${Math.max(4, percentile)}%` }} />
          </div>
          <span className="text-muted text-[9px]">Top {topPct.toFixed(1)}%</span>
        </>
      )}
    </div>
  )
}
