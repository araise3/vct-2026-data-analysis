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
import CountryKdChart from '../components/CountryKdChart'
import DataTable from '../components/DataTable'
import MatchHistory from '../components/MatchHistory'
import PerformanceStrip from '../components/PerformanceStrip'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import AgentIcon from '../components/AgentIcon'
import PlayerStatSummary from '../components/PlayerStatSummary'
import EventLogo from '../components/EventLogo'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { dynamicQualify, dynamicQualifyThreshold } from '../components/LeaderCard'
import { rating, pct, num, eventLabel, trackerProfileUrl } from '../lib/format'
import trackerLinks from '../lib/trackerLinks.json'

// Mirrors rft.gg's own player-page tab row (Overview/Matches/Champions/
// Career) minus Career -- this site has no per-season team-history dataset
// to build an equivalent of rft.gg's roster-timeline tab from.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Match statistics' },
  { id: 'agents', label: 'Agents' },
]

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
    // wasn't worth the extra scroll-listener churn. Scrolling INSIDE the
    // menu itself must not count, though -- `scroll` doesn't bubble, but a
    // capture-phase window listener still sees it regardless of source, so
    // without this guard a long account list would close on its own scroll
    // (same bug fixed in Select.jsx's identical listener).
    function onScrollOrResize(e) {
      if (trackerMenuRef.current && e.target instanceof Node && trackerMenuRef.current.contains(e.target)) return
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
  const tabs = TABS

  // Every one of this player's own buckets, across every year/competition --
  // the page-wide multi-facet FilterPanel (region/event/phase/week/split/
  // competition + date range) this used to run through was built for list
  // pages with dozens of entities in scope at once; on a single player's
  // profile it was mostly empty chip groups. Replaced with this page's own
  // pair of Season/Event dropdowns instead (see below) -- a single shared
  // scope control governing every tab (Overview/Matches/Agents), matching
  // rft.gg's own player page (one tournament + one year picker sitting
  // above its tabs, driving all of them). This also folds in what used to
  // be the Agents table's own separate, independent year/event picker
  // (previously a deliberate multi-select-events control scoped ONLY to
  // that table, per an earlier direct request) -- unified here per a later
  // direct request that the whole page respond to one real season/event
  // scope rather than staying pinned to the most recent season everywhere
  // else. That does mean an Agents-only multi-event comparison is no
  // longer expressible in one view (the shared picker is single-select,
  // same as rft.gg's own), the one real tradeoff of the unification.
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
  // wide like the header cards below it, not scoped to the Season/Event
  // picker -- a trophy won two seasons ago doesn't stop being real once the
  // page narrows to a single season.

  // Season/Event scope -- `selectedYear` of `null` means "default to the
  // most recent season" (recentYear), same default the old fixed pin used;
  // `'All'` means career-wide. `selectedEvent` of `'Overall'` means no
  // event-level narrowing beyond the year. Picking an event always wins
  // over the year (an event fully determines its own season), and picking
  // a year resets any event selection -- same override relationship the
  // old Agents-only picker used, just promoted to the whole page now.
  const [selectedYear, setSelectedYear] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState('Overall')
  const [activeTab, setActiveTab] = useState('overview')
  useEffect(() => {
    setSelectedYear(null)
    setSelectedEvent('Overall')
    setActiveTab('overview')
  }, [decodedName])

  const effectiveYear = selectedYear ?? recentYear

  const yearOptions = useMemo(
    () => [...new Set(records.map((r) => r.year))].sort((a, b) => b - a),
    [records]
  )

  // Events available for the Event dropdown -- scoped to the currently
  // selected year (so it never offers an event that would silently produce
  // an empty page), or every event this player has ever played if the year
  // picker itself is set to 'All'. Most recent first, by raw event id (see
  // the identical pattern this replaces, agentEventOptions, for why event
  // id -- not a date lookup -- is a safe sort key here).
  const eventOptions = useMemo(() => {
    const pool = selectedYear === 'All' ? records : records.filter((r) => r.year === effectiveYear)
    const latestIdByEvent = new Map()
    for (const r of pool) {
      const cur = latestIdByEvent.get(r.event)
      if (cur === undefined || r.e > cur) latestIdByEvent.set(r.event, r.e)
    }
    return [...latestIdByEvent.entries()].sort((a, b) => b[1] - a[1]).map(([evt]) => evt)
  }, [records, selectedYear, effectiveYear])

  function handleYearChange(y) {
    setSelectedYear(y)
    setSelectedEvent('Overall')
  }

  const yearSelectOptions = useMemo(
    () => [{ value: 'All', label: 'All' }, ...yearOptions.map((y) => ({ value: y, label: String(y) }))],
    [yearOptions]
  )
  const eventSelectOptions = useMemo(
    () => [{ value: 'Overall', label: 'Overall' }, ...eventOptions.map((evt) => ({ value: evt, label: eventLabel(evt) }))],
    [eventOptions]
  )

  // The buckets actually in scope for Overview/Agents -- everything below
  // that used to read `filtered`/pin to `recentYear` now reads this.
  const scopedRecords = useMemo(() => {
    if (selectedEvent !== 'Overall') return records.filter((r) => r.event === selectedEvent)
    return selectedYear === 'All' ? records : records.filter((r) => r.year === effectiveYear)
  }, [records, selectedYear, effectiveYear, selectedEvent])

  const stats = useMemo(
    () => aggregatePlayerBuckets(scopedRecords),
    [scopedRecords]
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
  // Population = every player with a bucket in the same season the
  // Season/Event picker currently resolves to (populationYear -- the
  // selected event's own year if one's picked, else the selected year,
  // else recentYear as the fallback for a career-wide 'All' scope, since a
  // percentile needs SOME single season to compare within), gated by the
  // same round-count qualification bar Records.jsx's "Most consistent"
  // card and Player of the Month already use (`dynamicQualify`/
  // `dynamicQualifyThreshold` from LeaderCard.jsx) -- without it, a 1-map
  // call-up with a lucky ace would sit at a false 100th percentile and skew
  // the whole distribution.
  const populationYear = useMemo(
    () => (scopedRecords.length ? Math.max(...scopedRecords.map((r) => r.year)) : recentYear),
    [scopedRecords, recentYear]
  )
  const populationStats = useMemo(() => {
    if (!data || !populationYear) return []
    const yearRecords = expandBuckets(data, 'p').filter((r) => r.year === populationYear)
    const byPlayer = groupByEntity(yearRecords)
    const rows = []
    for (const buckets of byPlayer.values()) {
      const s = aggregatePlayerBuckets(buckets)
      if (s) rows.push(s)
    }
    return rows
  }, [data, populationYear])

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
    const kd = metric('kd', 'K/D', stats.kd, (v) => num(v, 2))
    const hsPct = metric('avgHsPct', 'HS%', stats.avgHsPct, (v) => pct(v, 1))
    const winPct = metric('winPct', 'Win %', stats.winPct, (v) => pct(v, 1))
    const kast = metric('avgKast', 'KAST', stats.avgKast, (v) => pct(v, 0))
    const acs = metric('avgAcs', 'ACS', stats.avgAcs, (v) => num(v, 0))
    // A genuinely different per-ROUND stat from the Win % pill above (which
    // is per-MAP) -- see aggregatePlayerBuckets' own roundWinPct comment
    // for why they can't share a value (a 13-11 map win is only 54% on
    // rounds). Used to be a relabeled copy of winPct because pro data had
    // no rounds-won field to compute the real thing from; export_from_db.py
    // now derives it from each map's own final score. `stats.roundWinPct`
    // is null (not 0) for any player whose scope predates that field's
    // backfill, so this correctly drops out of scoreMetrics below like any
    // other missing percentile rather than showing a false 0%.
    const roundWinPct = metric('roundWinPct', 'Round Win %', stats.roundWinPct, (v) => pct(v, 1))

    const scoreMetrics = [roundWinPct, kast, acs, adr].filter((m) => m.percentile != null)
    if (!scoreMetrics.length) return null
    const avgPercentile = scoreMetrics.reduce((sum, m) => sum + m.percentile, 0) / scoreMetrics.length
    return {
      pills: [rating_, kd, hsPct, winPct],
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
  //
  // Scoped to the SUBJECT's own current Act (actShort) -- player_act_stats.json
  // holds one row per player with no per-Act history, so right after an Act
  // rolls over the file is a mix of accounts already reset to the new Act
  // (a handful of matches so far) and accounts still sitting on the old one
  // (their full prior-Act total, untouched until they next queue). Without
  // this filter, a fresh e11a5 player's 4-match sample got compared against
  // a qualification bar derived from an e11a4 straggler's 120-match total --
  // real bug found live the day Act 5 started: every fresh-Act profile's
  // entire Tracker Score panel silently vanished (failed the bogus 20-match
  // bar) rather than comparing against the much smaller, honest pool of
  // players who'd actually played e11a5 so far.
  const rankedPopulationStats = useMemo(() => {
    if (!actStatsData?.players || !actStats) return []
    return Object.values(actStatsData.players).filter((r) => r.actShort === actStats.actShort)
  }, [actStatsData, actStats])

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
    // No sample-size qualification bar -- removed per direct request. Every
    // linked account counts toward the comparison pool and every account
    // gets a Tracker Score, regardless of how few matches they've played
    // this Act (most visible right after an Act rolls over, when almost
    // everyone's sample is small).
    const qualified = rankedPopulationStats
    if (qualified.length < 2) return null

    const metric = (statKey, label, value, format) => ({
      statKey, label, value, format, percentile: percentileOf(qualified.map((r) => r[statKey]).filter((v) => v != null), value),
    })
    const acs = metric('acs', 'ACS', actStats.acs, (v) => num(v, 1))
    const adr = metric('adr', 'ADR', actStats.adr, (v) => num(v, 1))
    const kd = metric('kd', 'K/D', actStats.kd, (v) => num(v, 2))
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
      pills: [adr, kd, hsPct, winPct],
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

  // The role badge next to the player's name, and the Agents tab's table,
  // both now read the SAME page-level Season/Event scope everything else
  // does (see scopedRecords above) rather than a separate local picker.
  const agentScoped = useMemo(() => {
    if (selectedEvent !== 'Overall') return agentRecords.filter((r) => r.event === selectedEvent)
    return selectedYear === 'All' ? agentRecords : agentRecords.filter((r) => r.year === effectiveYear)
  }, [agentRecords, selectedYear, effectiveYear, selectedEvent])

  const role = useMemo(
    () => rolesInScope(agentScoped).get(decodedName) ?? null,
    [agentScoped, decodedName]
  )

  const agentRows = useMemo(() => {
    const grouped = new Map()
    for (const r of agentScoped) {
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
  }, [agentScoped])

  // "Overall" row pinned above the per-agent breakdown: aggregateAgentBuckets
  // over the SAME ungrouped agentScoped rows the per-agent rows are built
  // from (not a re-sum of the already-divided per-agent percentages), so
  // it's exactly consistent with the per-agent rows -- Maps/Rounds/wins
  // sum exactly, Win%/Rating/etc. are the true rounds-weighted totals
  // rather than an average-of-averages.
  const agentOverall = useMemo(() => {
    const s = aggregateAgentBuckets(agentScoped)
    return s ? { agent: 'Overall', ...s } : null
  }, [agentScoped])

  const agentScopeLabel = selectedEvent !== 'Overall'
    ? eventLabel(selectedEvent)
    : (selectedYear === 'All' ? 'this career' : effectiveYear)

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

  // Matches actually in scope -- same Season/Event scope as
  // scopedRecords/agentScoped above, now that this page has a real, shared
  // scope control instead of the old fixed "always career-wide" rule.
  // `allMatchRows` itself stays career-wide (it's the pool this filters
  // from); nothing downstream reads it directly any more.
  const scopedMatchRows = useMemo(() => {
    if (selectedEvent !== 'Overall') return allMatchRows.filter((m) => m.event === selectedEvent)
    return selectedYear === 'All' ? allMatchRows : allMatchRows.filter((m) => m.year === effectiveYear)
  }, [allMatchRows, selectedYear, effectiveYear, selectedEvent])

  // One row per MAP (not per series) for the Performances strip -- see
  // playerMapPerformance.js. Empty until team_map_detail.json lands
  // (idle-loaded), same graceful-until-ready pattern every idle-loaded
  // section on this page already follows.
  const mapPerformanceRows = useMemo(
    () => buildPlayerMapPerformance(scopedMatchRows, matchPlayerData, teamMapDetailData, decodedName),
    [scopedMatchRows, matchPlayerData, teamMapDetailData, decodedName]
  )

  const duelMatchIds = useMemo(() => new Set(scopedMatchRows.map((m) => m.id)), [scopedMatchRows])
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

  // Match history newest-first, within the current Season/Event scope.
  // Paginated 30 at a time rather than rendered in full, since a long
  // career can run to hundreds of matches; `matchLimit` resets whenever
  // the profile switches players OR the scope narrows/widens (a stale
  // limit from a much longer list otherwise just means "everything" on a
  // freshly-narrowed one, which reads as broken pagination).
  const sortedMatchRows = useMemo(
    () => [...scopedMatchRows].sort(
      (a, b) => (b.ts || b.date || '').localeCompare(a.ts || a.date || '') || b.id - a.id
    ),
    [scopedMatchRows]
  )
  const [matchLimit, setMatchLimit] = useState(30)
  useEffect(() => {
    setMatchLimit(30)
  }, [decodedName, selectedYear, selectedEvent])
  const visibleMatchRows = useMemo(
    () => sortedMatchRows.slice(0, matchLimit),
    [sortedMatchRows, matchLimit]
  )


  if (loading) return <div className="text-muted text-sm">Loading…</div>

  const meta = data?.meta?.[decodedName]
  const displayTeam = meta ? teamInScope(scopedRecords, meta.team) : null

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

      {/* One merged card for the header info AND the tab row/Season-Event
          pickers below it -- a literal 1:1 structural copy of rft.gg's own
          player-page header (a single `rounded-md bg-background border
          overflow-hidden` box containing the info block, a `border-t`
          hairline divider, then the tabs+selects row -- NOT two separate
          stacked elements, which is what an earlier pass here got wrong).
          The padding/gap that used to live on this outer div now lives on
          the inner content wrapper instead, so the divider and tab row can
          sit flush against the card's own edges the way rft.gg's does. */}
      <div className="relative flex flex-col bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm overflow-hidden">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
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

        </div>

        {/* Divider -- flush against the card's own edges, same as rft.gg's
            bare `border-t` between its header block and tab row (no gap on
            either side, unlike everything above it which uses this card's
            gap-4). */}
        <div className="border-t border-hairline" />

        {/* Tab row + Season/Event scope, INSIDE the same card as the header
            above -- one shared pair of ghost dropdowns (Select.jsx's
            `variant="ghost"`) driving every tab below, not a per-tab
            control. `flex-col-reverse md:flex-row` mirrors rft.gg's own
            responsive order: the pickers sit above the (horizontally
            scrollable) tab strip on narrow widths, side-by-side with it on
            desktop. Event options are already narrowed to the selected
            year (or every year if the year picker itself is 'All'), so
            this can never land on a combination with nothing in it. */}
        <div className="flex flex-col-reverse items-center md:flex-row md:justify-between gap-2 sm:gap-4 px-3 sm:px-6 pt-1 pb-2 sm:pb-0">
          <div className="flex items-center gap-1 max-w-full overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`shrink-0 px-3 pt-2 pb-3 text-xs font-semibold border-0 border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'text-ink border-accent-bright'
                    : 'text-muted border-transparent hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Select variant="ghost" value={effectiveYear} onChange={handleYearChange} options={yearSelectOptions} />
            <Select
              variant="ghost"
              value={selectedEvent}
              onChange={setSelectedEvent}
              options={eventSelectOptions}
              renderIcon={(v) => (v !== 'Overall' ? <EventLogo event={v} size={14} /> : null)}
            />
          </div>
        </div>
      </div>

      {activeTab === 'overview' && <>
      {stats && stats.mapsPlayed > 0 && <PlayerStatSummary perf={perf} stats={stats} actStats={actStats} showRanked={showRanked} setStatSource={setStatSource} />}

      {scopedMatchRows.length > 0 && (
        <PerformanceStrip rows={mapPerformanceRows} />
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

          {meta.isChina && (
            <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
              China-region matches don't publish multi-kill, clutch, or economy data on VLR, so those
              totals read 0 here for any of this scope based in China, even if {decodedName} also
              competed internationally.
            </div>
          )}
        </>
      )}
      </>}

      {activeTab === 'matches' && (
        sortedMatchRows.length === 0 ? (
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
            <p className="text-muted text-sm">No matches in this scope.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
        )
      )}

      {activeTab === 'agents' && (
        agentRows.length > 0 ? (
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
        )
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
