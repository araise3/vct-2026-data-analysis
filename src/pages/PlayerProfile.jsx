import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
import RankIcon from '../components/RankIcon'
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
  //   - "Damage Delta per Round" is Damage Dealt minus Damage RECEIVED,
  //     averaged per round (confirmed against tracker.gg's own live
  //     tooltip -- a self-contained per-player stat, not a comparison
  //     against the opposing team, which was this comment's own earlier,
  //     wrong assumption before that got checked). Pro-match data (VLR)
  //     never captured damage received at all, only damage dealt (ADR) --
  //     confirmed no such field exists anywhere in export_from_db.py's
  //     pipeline -- so ADR still has to stand in for it HERE specifically.
  //     Ranked (HenrikDev) data has both dealt and received per match, so
  //     rankedPerf below computes the REAL formula instead of substituting.
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

  // Percentile of `value` within `pool` -- share of the qualified
  // population strictly below it, as a 0-100 float (never rounded here;
  // Tracker Score's own "use decimals" requirement means the ONLY rounding
  // in this whole computation happens once, at the very end, on the final
  // 0-1000 score -- every percentile and every intermediate average stays
  // full-precision float). Shared by both the giant stat pills and Tracker
  // Score, pro and ranked alike, so "Top X%" always means the same thing
  // wherever it's shown.
  function percentileOf(pool, value) {
    if (!pool.length || value == null) return null
    const below = pool.filter((v) => v < value).length
    return (below / pool.length) * 100
  }

  // One player-performance bundle per view: the 4 giant stat pills PLUS
  // Tracker Score, built from the same qualified population and the same
  // percentileOf() so a stat's percentile never disagrees between the pill
  // showing it and Tracker Score's own breakdown of it (ADR and Win % each
  // appear in both places). `statKey`, not `key`, on every metric object --
  // spread into TrackerScoreMetric below, and React treats a literal `key`
  // inside a spread props object as an error-worthy footgun (it looks like
  // it's setting the reconciliation key but silently isn't) -- caught live
  // via a real console warning while first building this.
  //
  // PRO: percentiles against every pro player with a bucket in this
  // player's own recentYear (this site's real pro-match population),
  // gated by the same round-count qualification bar Records.jsx's "Most
  // consistent" card and Player of the Month already use. Pills are
  // Rating/ADR/HS%/Win% -- tracker.gg's own quartet is DMG-Round/K-D/HS%/
  // Win%, but swapped to lead with Rating 2.0 (this site's own headline
  // number) and drop K/D in favour of directly showing ADR, per direct
  // instruction. Tracker Score itself keeps tracker.gg's published 4
  // inputs (Win%/KAST/ACS/DDΔ-Round), with ADR standing in for DDΔ/Round
  // specifically because pro (VLR) data has no damage-received field to
  // compute the real formula from -- see populationStats' own comment
  // above for why. A DIFFERENT set from the pills, same as tracker.gg's
  // real page (its pills and its Tracker Score row don't show the same 4
  // stats either).
  const proPerf = useMemo(() => {
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

    const metric = (statKey, label, value, format) => ({
      statKey, label, value, format, percentile: percentileOf(qualified.map((r) => r[statKey]).filter((v) => v != null), value),
    })
    const rating_ = metric('avgRating', 'Rating', stats.avgRating, (v) => rating(v))
    const adr = metric('avgAdr', 'ADR', stats.avgAdr, (v) => num(v, 1))
    const hsPct = metric('avgHsPct', 'HS%', stats.avgHsPct, (v) => pct(v, 1))
    const winPct = metric('winPct', 'Win %', stats.winPct, (v) => pct(v, 1))
    const kast = metric('avgKast', 'KAST', stats.avgKast, (v) => pct(v, 0))
    const acs = metric('avgAcs', 'ACS', stats.avgAcs, (v) => num(v, 0))
    // Same stat/percentile as the Win % pill above, but tracker.gg's own
    // Tracker Score row specifically labels it "Round Win %" (confirmed
    // against a screenshot of the real thing) -- a separate metric object
    // rather than reusing `winPct` so the two labels can differ without
    // one of the two renders being wrong.
    const roundWinPct = { ...winPct, statKey: 'roundWinPct', label: 'Round Win %' }

    const scoreMetrics = [roundWinPct, kast, acs, adr].filter((m) => m.percentile != null)
    if (!scoreMetrics.length) return null
    const avgPercentile = scoreMetrics.reduce((sum, m) => sum + m.percentile, 0) / scoreMetrics.length
    return {
      pills: [rating_, adr, hsPct, winPct],
      scoreMetrics,
      score: Math.round(avgPercentile * 10),
    }
  }, [stats, populationStats])

  // Every other tracked player's OWN linked-account ranked stats -- the
  // population Ranked Tracker Score / pill percentiles are measured
  // against. Not this site's pro population (that's a different game
  // entirely from a stats standpoint -- solo ladder vs coordinated pro
  // play) and not the general Valorant playerbase (this site has no access
  // to that; the closest honest comparison group available is "other pros'
  // own ranked accounts, the only ranked data this pipeline has at all").
  const rankedPopulationStats = useMemo(
    () => (actStatsData?.players ? Object.values(actStatsData.players) : []),
    [actStatsData]
  )

  // RANKED: same shape as proPerf, all 4 Tracker Score inputs including
  // KAST -- HenrikDev's match-history response has no dedicated `kast`
  // field, but it DOES carry the raw `kills[]`/`rounds[]` arrays (round
  // number, timestamps, killer/victim/assistants) needed to derive it
  // ourselves; see fetch_act_stats.py's own comment on _round_kast_participants
  // for the derivation. `kast` is therefore null (not 0) for any player
  // fetched before that derivation was added, until a --full re-run
  // backfills it -- filtered out of scoreMetrics below like any other
  // missing percentile, so the row degrades to 3 stats for those players
  // rather than showing a wrong 0%. Score's 3rd input is the REAL
  // "DDΔ/Round" formula (Damage Dealt minus Damage RECEIVED, per round --
  // confirmed against tracker.gg's own tooltip), computed properly here
  // since HenrikDev's match data has both halves -- unlike proPerf above,
  // which has to fall back to plain ADR because pro (VLR) data never
  // captured damage received at all. Pills stay ACS/ADR/HS%/Win% though
  // (ADR, not DDΔ) -- tracker.gg's own real page shows Damage/Round as a
  // PILL and DDΔ/Round in the Tracker Score row, two different stats shown
  // in two different places, and this mirrors that split rather than
  // picking one. ACS stands in for Rating in the lead pill slot, since
  // Rating 2.0 has no ranked-ladder equivalent either.
  const rankedPerf = useMemo(() => {
    if (!actStats || !rankedPopulationStats.length) return null
    const threshold = dynamicQualifyThreshold(rankedPopulationStats, 'matches', { fixed: 20 })
    if (actStats.matches < threshold) return null
    const qualified = rankedPopulationStats.filter((r) => r.matches >= threshold)
    if (qualified.length < 2) return null

    const metric = (statKey, label, value, format) => ({
      statKey, label, value, format, percentile: percentileOf(qualified.map((r) => r[statKey]).filter((v) => v != null), value),
    })
    const acs = metric('acs', 'ACS', actStats.acs, (v) => num(v, 1))
    const adr = metric('adr', 'ADR', actStats.adr, (v) => num(v, 1))
    const hsPct = metric('hsPct', 'HS%', actStats.hsPct, (v) => pct(v, 1))
    const winPct = metric('winPct', 'Win %', actStats.winPct, (v) => pct(v, 1))
    const kast = metric('kast', 'KAST', actStats.kast, (v) => pct(v, 1))
    const ddDelta = metric('ddDelta', 'DDΔ/Round', actStats.ddDelta, (v) => num(v, 0))
    // A genuinely different per-ROUND stat from the Win % pill above (which
    // is per-MATCH) -- see fetch_act_stats.py's derive() for why they can't
    // share a value (a team going 13-11 is a match win at 54% on rounds).
    const roundWinPct = metric('roundWinPct', 'Round Win %', actStats.roundWinPct, (v) => pct(v, 1))

    const scoreMetrics = [roundWinPct, kast, acs, ddDelta].filter((m) => m.percentile != null)
    if (!scoreMetrics.length) return null
    const avgPercentile = scoreMetrics.reduce((sum, m) => sum + m.percentile, 0) / scoreMetrics.length
    return {
      pills: [acs, adr, hsPct, winPct],
      scoreMetrics,
      score: Math.round(avgPercentile * 10),
    }
  }, [actStats, rankedPopulationStats])

  const perf = showRanked ? rankedPerf : proPerf

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
        // tracker.gg-style "overview" card. Colors/radius on this card and
        // its two children below (GiantStat, the Tracker Score sub-card)
        // are tracker.gg's own real CSS custom properties -- pulled straight
        // out of a saved copy of the actual page's <style id="trn-title-
        // styles"> block (--color-surface-1 #0f1923, --color-surface-3
        // #2c3f52, --border-radius 0.5rem, etc), not approximated from this
        // site's own surface/hairline tokens, per direct instruction for a
        // literal 1:1 match rather than "inspired by." Structure (a brand
        // rail, a rank/RR/leaderboard + W-L strip -- ranked only, pro
        // matches have no personal rank -- 4 "giant" stat pills with a
        // percentile fill bar each, and a Tracker Score footer) still comes
        // from that same real page, restricted to only the stats this site
        // actually has data for. No secondary stat grid (dropped per
        // earlier direct instruction) -- Most Played Agent and Most Kills
        // stay gone too (no equivalent on tracker.gg's real page; Most
        // Played Agent duplicates the Agents table's own top row further
        // down anyway).
        <div className="relative bg-[#0f1923] border border-white/5 rounded-lg shadow-depth-sm overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1 bg-grad-accent" aria-hidden="true" />
          <div className="pl-4 pr-3 py-3 sm:pl-5 sm:pr-5 sm:py-4 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* Source toggle -- only rendered when this player actually has
                  linked-account Act stats, so it never appears as a dead
                  control. Labels name the POPULATION each view describes
                  ("Pro" vs "Ranked"), not the data source, since that's the
                  distinction that matters to a reader. */}
              {actStats ? (
                <div className="flex items-center gap-0.5 p-0.5 bg-surface2 rounded-lg">
                  {[
                    { id: 'pro', label: 'Pro' },
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
              {/* W-L record only -- Win % dropped from this corner per direct
                  instruction (it's already one of the 4 pills below now, so
                  showing it twice was redundant). Colored W/L/D (good/bad/
                  muted tokens, same ones the rest of the site already uses
                  for win-loss) instead of one flat muted string -- a wall of
                  uniformly gray text read as lifeless next to the rest of
                  this card. */}
              <div className="flex items-center gap-2">
                {showRanked ? (
                  <>
                    {actStats.actShort && (
                      <span className="text-muted text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface2">
                        Act {actStats.actShort}
                      </span>
                    )}
                    <WldBadge wins={actStats.wins} losses={actStats.losses} draws={actStats.draws} />
                  </>
                ) : (
                  <>
                    {ratingTier(stats.avgRating) && (
                      <span
                        className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${ratingTier(stats.avgRating).tone}`}
                      >
                        {ratingTier(stats.avgRating).label}
                      </span>
                    )}
                    <WldBadge wins={stats.mapsWon} losses={stats.mapsLost} />
                  </>
                )}
              </div>
            </div>

            {/* Rank/RR/leaderboard -- tracker.gg's own rank badge + level
                cluster, minus Level (not requested, and this pipeline
                doesn't fetch account level) and minus the W-L ring (removed
                per direct instruction -- the W-L record is already shown as
                text in the corner above). The rank badge itself is a real
                tier icon (data_prep/fetch_rank_icons.py, sourced from
                valorant-api.com and cached locally same as agent icons --
                see that script's own docstring), not just text -- silently
                absent via RankIcon's own null-return if this tier name
                somehow isn't in the lookup, rather than leaving a broken
                <img>. Ranked view only -- there's no "rank" for a pro-match
                aggregate. Absent entirely (not a dash-filled placeholder)
                when the account has no rank on file at all (e.g. genuinely
                unranked this Act). */}
            {showRanked && actStats.rank && (
              <div className="flex items-center gap-4 pb-1">
                <RankIcon tier={actStats.rank.tier} size={40} />
                <div className="flex flex-col gap-1">
                  <span className="text-muted text-sm font-medium">{actStats.rank.tier}</span>
                  <span className="flex items-baseline gap-1">
                    <span className="font-display text-lg font-medium text-ink">{num(actStats.rank.rr)}</span>
                    <span className="text-ink/75 text-xs font-bold">RR</span>
                  </span>
                  {actStats.rank.leaderboardRank != null && (
                    <span className="text-muted text-[10px]">#{num(actStats.rank.leaderboardRank)} leaderboard</span>
                  )}
                </div>
              </div>
            )}

            {perf && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {perf.pills.map((m) => (
                  <GiantStat key={m.statKey} {...m} />
                ))}
              </div>
            )}

            {/* Tracker Score footer -- rebuilt against tracker.gg's own real
                markup/CSS (a saved "Webpage, Complete" copy, not a guess):
                .performance-score (bg surface-1, border-radius) wrapping
                .performance-score__container (bg surface-2, CSS GRID with
                "score stats" areas -- min-content + 1fr, stacking to one
                column below sm), a subtle 7.5%-white border overlay, and
                the crest/label/value cluster on the left with the 4-stat
                grid on the right. The "+" dividers are DOM siblings here
                (real page does it as a `:before` pseudo-element referencing
                a CDN plus-icon SVG at the same 16px/rounded-full size --
                same visual result, this is just how it has to be done from
                inside JSX rather than a dedicated stylesheet). */}
            {perf && (
              <div className="relative bg-[#0f1923] rounded-lg overflow-hidden">
                <div className="absolute inset-0 rounded-lg border border-white/[0.075] pointer-events-none z-10" aria-hidden="true" />
                <div className="bg-[#1b2733] rounded-lg grid grid-cols-1 sm:grid-cols-[min-content_1fr]">
                  <div
                    className="flex items-center px-4 sm:px-7 py-3 sm:py-0"
                    style={{ backgroundImage: `linear-gradient(to right, ${trackerTier(perf.score / 10)?.light ?? '#a7c6cc'}, transparent)`, padding: '1px' }}
                  >
                    <div className="flex items-center bg-[#1b2733] rounded-lg sm:rounded-r-none px-4 sm:px-7 py-3 w-full sm:w-auto">
                      <TrackerScoreBadge score={perf.score} />
                      <div className="flex flex-col ml-5 whitespace-nowrap">
                        <span className="text-muted text-sm font-medium">Tracker Score</span>
                        <span className="font-display text-2xl font-bold text-ink">
                          {perf.score}
                          <sup className="text-ink/75 text-xs">/1000</sup>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4">
                    {perf.scoreMetrics.map((m, i) => (
                      <div key={m.statKey} className="relative">
                        {i > 0 && (
                          <span
                            className="hidden sm:flex absolute -left-2 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-4 h-4 rounded-full bg-[#0f1923]"
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-white/70"><path d="M19,13H13v6H11V13H5V11h6V5h2v6h6Z" /></svg>
                          </span>
                        )}
                        <TrackerScoreMetric {...m} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {showRanked && (
              <p className="text-muted text-[10px] leading-relaxed">
                Personal competitive ladder stats for {actStats.riotId}
                {actStats.region ? ` (${actStats.region.toUpperCase()})` : ''} this Act, via their
                linked Riot account — solo queue games, not pro matches, so these aren't comparable
                with the numbers above.
              </p>
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

// Wins/losses(/draws) as colored counts (good/bad/muted -- the same tokens
// every other win-loss indicator on the site already uses) instead of one
// flat muted string. `draws` is optional -- the Pro corner has no concept
// of a drawn map, so it's simply never passed there.
function WldBadge({ wins, losses, draws }) {
  return (
    <span className="flex items-center gap-1 text-xs font-semibold">
      <span className="text-good">{num(wins)}W</span>
      <span className="text-muted/40">–</span>
      <span className="text-bad">{num(losses)}L</span>
      {draws ? (
        <>
          <span className="text-muted/40">–</span>
          <span className="text-muted">{num(draws)}D</span>
        </>
      ) : null}
    </span>
  )
}

// Tracker Score tier lookup -- colors are tracker.gg's own REAL per-tier
// `--color-tier` values, pulled verbatim out of a saved copy of the site's
// real stylesheet (.score--tier-S/A/B/C/D), not approximated: S=#3ecbff,
// A=#5ee790, B=#e6bc5c, C=#a7c6cc, D=#bf868f. `tone` is the same color as an
// arbitrary-value Tailwind text class (TrackerScoreMetric's tier letter is
// plain colored text on the real page, not a background chip -- see that
// component below). `dark`/`glow` are TrackerScoreBadge's own gradient/glow
// inputs (raw hex/rgb -- box-shadow and SVG fill can't consume a Tailwind
// class). Percentile cutoffs (90/75/50/25) are an even split, not a
// reverse-engineered exact match -- tracker.gg doesn't publish theirs.
function trackerTier(percentile) {
  if (percentile == null) return null
  if (percentile >= 90) return { label: 'S', tone: 'text-[#3ecbff]', light: '#3ecbff', dark: '#1f6b8c', glow: '62,203,255' }
  if (percentile >= 75) return { label: 'A', tone: 'text-[#5ee790]', light: '#5ee790', dark: '#2f7a52', glow: '94,231,144' }
  if (percentile >= 50) return { label: 'B', tone: 'text-[#e6bc5c]', light: '#e6bc5c', dark: '#8a6b30', glow: '230,188,92' }
  if (percentile >= 25) return { label: 'C', tone: 'text-[#a7c6cc]', light: '#a7c6cc', dark: '#5c6f74', glow: '167,198,204' }
  return { label: 'D', tone: 'text-[#bf868f]', light: '#bf868f', dark: '#6b454c', glow: '191,134,143' }
}

// The tier badge -- a colored medallion (SVG, gradient-filled in the tier's
// own real color, soft outer glow) evoking the same "rating medal" idea as
// tracker.gg's own crest (their real .score__emblem is a bespoke Illustrator
// asset, a 5-point rosette around a diamond gem, colored per tier) without
// tracing their exact artwork, per direct instruction. This is a 6-point
// star/rosette around a small gem instead -- close enough to read as the
// same "badge of honor" genre, deliberately not the same shape. `useId`
// keeps the gradient's id collision-safe if this ever renders more than
// once on a page (e.g. a future compare view) -- two SVGs sharing a literal
// id would have the second silently reuse the first's gradient definition.
function TrackerScoreBadge({ score }) {
  const tier = trackerTier(score / 10)
  const light = tier?.light ?? '#a7c6cc'
  const dark = tier?.dark ?? '#5c6f74'
  const glow = tier?.glow ?? '167,198,204'
  const gradId = `ts-badge-${useId()}`
  return (
    <div
      className="relative w-14 h-14 shrink-0"
      style={{ filter: `drop-shadow(0 0 8px rgba(${glow}, 0.65))` }}
      title="Tracker Score tier"
    >
      <svg viewBox="0 0 24 24" className="w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={light} />
            <stop offset="100%" stopColor={dark} />
          </linearGradient>
        </defs>
        <polygon
          points="12,1.5 15,6.8 21.09,6.75 18,12 21.09,17.25 15,17.2 12,22.5 9,17.2 2.91,17.25 6,12 2.91,6.75 9,6.8"
          fill={`url(#${gradId})`}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="0.3"
        />
        <circle cx="12" cy="12" r="3.4" fill="rgba(13,15,19,0.35)" stroke="rgba(255,255,255,0.6)" strokeWidth="0.4" />
      </svg>
    </div>
  )
}

// tracker.gg's real `.stat`: centered column (label, big value, percentile
// line), a background gradient from --color-surface-1 at the top to the
// tier color at 20% opacity at the bottom, and a fixed-width (not
// percentile-sized -- confirmed against the real CSS, there is no
// percentage-fill bar here at all, this site's earlier version invented
// one) 3rem tier-colored accent bar along the very bottom edge. The tier
// letter is plain colored text next to "· Top X%", not a background chip --
// also corrected to match the real page.
function TrackerScoreMetric({ label, value, format, percentile }) {
  const tier = trackerTier(percentile)
  const topPct = percentile == null ? null : Math.max(0.1, 100 - percentile)
  const bg = tier
    ? { backgroundImage: `linear-gradient(to bottom, #0f1923, rgba(${tier.glow}, 0.2))` }
    : undefined
  return (
    <div
      className="relative flex flex-col items-center justify-center text-center gap-1 py-3 px-2 min-w-0 border-l border-[#0f1923] first:border-l-0"
      style={bg}
    >
      <span className="text-muted text-sm font-medium truncate max-w-full">{label}</span>
      <span className="font-display text-2xl font-bold text-ink">{format(value)}</span>
      {topPct != null && (
        <span className="text-ink/75 text-[10px]">
          {tier && <span className="font-semibold" style={{ color: tier.light }}>{tier.label}</span>}
          {tier ? ' · ' : ''}Top {topPct.toFixed(1)}%
        </span>
      )}
      {tier && (
        <span
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 rounded-t"
          style={{ backgroundColor: tier.light }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}

// tracker.gg's real `.stat.giant`: bg surface-2, a 4px vertical fill bar
// (track = --color-background, the darkest token, fill = accent) sized to
// the stat's own percentile, a normal-weight/normal-case label (NOT the
// small-caps micro-label this site uses everywhere else -- confirmed
// against the real CSS, `.stat .numbers .name` carries no text-transform),
// a big bold value, and a "Top X%" line -- gold (`#cbb765`, tracker.gg's
// own real literal value for this, not a design token) once the percentile
// clears an approximate "elite" cutoff, same as the real page's
// `rank--leader` class (exact cutoff isn't published; 3% is this site's own
// read of a handful of examples in a saved copy of the real page).
function GiantStat({ label, value, format, percentile }) {
  const topPct = percentile == null ? null : Math.max(0.1, 100 - percentile)
  const isLeader = topPct != null && topPct <= 3
  return (
    <div className="flex items-stretch gap-4 bg-[#1b2733] rounded-lg px-5 py-3 shadow-[0_3px_6px_rgba(0,0,0,0.15)]">
      <div className="relative w-1 shrink-0 bg-[#0F141A] rounded-full overflow-hidden">
        {percentile != null && (
          <div
            className="absolute bottom-0 left-0 right-0 bg-accent rounded-full"
            style={{ height: `${Math.max(4, percentile)}%` }}
          />
        )}
      </div>
      <div className="flex flex-col justify-center min-w-0">
        <span className="text-muted text-base font-medium truncate">{label}</span>
        <span className="font-display text-xl font-bold text-ink">{value != null ? format(value) : '—'}</span>
        {topPct != null && (
          <span className={`text-[10px] font-medium ${isLeader ? '' : 'text-muted'}`} style={isLeader ? { color: '#cbb765' } : undefined}>
            Top {topPct.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}
