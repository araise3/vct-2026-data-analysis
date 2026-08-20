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
import DataTable from '../components/DataTable'
import MatchHistory from '../components/MatchHistory'
import PerformanceStrip from '../components/PerformanceStrip'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import AgentIcon from '../components/AgentIcon'
import RankIcon from '../components/RankIcon'
import EventLogo from '../components/EventLogo'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { dynamicQualify, dynamicQualifyThreshold } from '../components/LeaderCard'
import { rating, pct, num, eventLabel, birthDateLabel, trackerProfileUrl } from '../lib/format'
import trackerLinks from '../lib/trackerLinks.json'

// Mirrors rft.gg's own player-page tab row (Overview/Matches/Champions/
// Career) minus Career -- this site has no per-season team-history dataset
// to build an equivalent of rft.gg's roster-timeline tab from.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
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
  const allTrophies = useMemo(() => buildTrophyWinners(matchData), [matchData])
  const myTrophies = useMemo(() => playerTrophies(records, allTrophies), [records, allTrophies])

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
            {TABS.map((t) => (
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
      {stats && stats.mapsPlayed > 0 && (
        // tracker.gg-style "overview" card. The two inner pieces (GiantStat,
        // the Tracker Score sub-card) keep tracker.gg's own real CSS custom
        // properties (--color-surface-1 #0f1923, --color-surface-3 #2c3f52,
        // --border-radius 0.5rem, etc, pulled from a saved copy of the
        // actual page) for a literal 1:1 match there -- but this OUTER
        // wrapper uses this site's own default card background/border
        // (bg-grad-surface/border-hairline, same as the Performances panel
        // right below it) per direct instruction, rather than tracker.gg's
        // real page background, so the card sits inside this site's own
        // visual language instead of looking like a patch of a different
        // site. No brand-color left rail either (removed per direct
        // instruction). Structure (a rank/RR/leaderboard + W-L strip --
        // ranked only, pro matches have no personal rank -- 4 "giant" stat
        // pills with a percentile fill bar each, and a Tracker Score
        // footer) still comes from that same real page, restricted to only
        // the stats this site actually has data for. No secondary stat grid
        // (dropped per earlier direct instruction) -- Most Played Agent and
        // Most Kills stay gone too (no equivalent on tracker.gg's real
        // page; Most Played Agent duplicates the Agents table's own top row
        // further down anyway).
        <div className="relative bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm overflow-hidden">
          <div className="pl-4 pr-3 py-3 sm:pl-5 sm:pr-5 sm:py-4 flex flex-col gap-4">
            {/* Rank plate (left) + Source toggle (right) share one row --
                the toggle used to sit on its own line above this, moved
                down to line up with the rank plate per direct request. See
                RankPlate's own comment for what the plate itself is built
                from and why the Act tag lives there now rather than up
                here next to the toggle. Ranked view only -- there's no
                "rank" for a pro-match aggregate -- and absent entirely (not
                a dash-filled placeholder) when the account has no rank on
                file at all (e.g. genuinely unranked this Act); the row
                still holds its height via the toggle alone in either
                case. */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              {showRanked && actStats.rank ? (
                <RankPlate rank={actStats.rank} actShort={actStats.actShort} />
              ) : (
                <span />
              )}

              {/* Source toggle -- only rendered when this player actually
                  has linked-account Act stats, so it never appears as a
                  dead control. Labels name the POPULATION each view
                  describes ("Pro" vs "Ranked"), not the data source, since
                  that's the distinction that matters to a reader. Alone in
                  this corner now that the Act badge moved into the rank
                  cluster above. */}
              {actStats && (
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
              )}
            </div>

            {/* First 3 pills stay equal-width to each other; Win % still
                gets extra room for the docked donut+legend block at its own
                right edge (see WinRateStat's comment), but less of it than
                the first pass -- that version's stacked bar needed the full
                width of a much wider column (1.6fr), the compact donut
                doesn't, so 1fr/1fr/1fr/1.6fr shrank to 1.1fr/1.1fr/1.1fr/1.3fr
                per direct request: the 0.3fr this frees up goes back into
                the first three pills (+0.1fr each) instead of sitting
                unused as extra Win % whitespace. Single column below sm
                (each card, WinRateStat included, is legible full-width on
                mobile without an awkward odd-one-out span), 2x2 at sm,
                widened 4-across from md up. Tightened from gap-2 to gap-1.5
                per direct request. */}
            {perf && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1.1fr_1.1fr_1.1fr_1.3fr] gap-1.5">
                {perf.pills.slice(0, 3).map((m) => (
                  <GiantStat key={m.statKey} {...m} />
                ))}
                <WinRateStat
                  {...perf.pills[3]}
                  wins={showRanked ? actStats.wins : stats.mapsWon}
                  losses={showRanked ? actStats.losses : stats.mapsLost}
                  draws={showRanked ? actStats.draws : undefined}
                />
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
                inside JSX rather than a dedicated stylesheet). No tier-
                colored border around the score cell either (dropped per
                direct instruction -- the real page's own 1px gradient-to-
                transparent technique there, tinted by whatever tier this
                player's score happens to be, read as an unwanted colored
                outline around the whole card). */}
            {perf && (
              <div className="relative bg-[#0f1923] rounded-lg overflow-hidden">
                <div className="absolute inset-0 rounded-lg border border-white/[0.075] pointer-events-none z-10" aria-hidden="true" />
                <div className="bg-[#1b2733] rounded-lg grid grid-cols-1 sm:grid-cols-[min-content_1fr]">
                  <div className="flex items-center bg-[#1b2733] rounded-lg sm:rounded-r-none px-4 sm:px-7 py-3 w-full h-full">
                    <TrackerScoreBadge score={perf.score} />
                    <div className="flex flex-col ml-5 whitespace-nowrap">
                      <span className="text-muted text-sm font-medium">Tracker Score</span>
                      <span className="font-display text-2xl font-bold text-ink">
                        {perf.score}
                        <sup className="text-ink/75 text-xs">/1000</sup>
                      </span>
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
          </div>
        </div>
      )}

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

// Real (if approximated) per-tier VALORANT competitive rank colors -- the
// game's own rank icons are famously color-coded (Iron gray through
// Radiant's pale gold-white) but rankIcons.json only carries an icon path,
// no color, so this is a hand-picked hex per base tier eyedropped off the
// real rank badges rather than an exact palette pull -- same "close, not
// pixel-perfect" honesty as trackerTier's own percentile cutoffs below.
// Keyed by BASE tier name (rank strips its own trailing " 1"/"2"/"3" --
// "Diamond 2" and "Diamond 3" share one color, matching how the game
// itself only recolors per major rank, not per division). Used to tint the
// rank plate's icon glow and its Act tag so the whole cluster reads as one
// tier-colored unit instead of a gray icon next to plain white text.
const RANK_TIER_COLORS = {
  iron: '#565a5e',
  bronze: '#a3714a',
  silver: '#9fb6ba',
  gold: '#e8c15a',
  platinum: '#3fa9a3',
  diamond: '#c46fe0',
  ascendant: '#39c47a',
  immortal: '#b23458',
  radiant: '#eee8b0',
}
function rankTierColor(tier) {
  if (!tier) return null
  const base = tier.toLowerCase().replace(/\s*\d+$/, '').trim()
  return RANK_TIER_COLORS[base] ?? null
}

// The rank cluster, rebuilt as a self-contained tier-tinted plate -- its
// own dark sub-panel (bg-[#11161f], hairline border) rather than a bare
// icon+text cluster sitting directly on the overview card's background,
// matching this card's own nested-panel language (the Tracker Score footer
// further down does the same: a darker sub-surface bounded by its own
// border). rankTierColor threads through THREE places here -- the ambient
// blurred glow behind the icon, the icon's own drop-shadow, and the Act
// tag's text color -- so "this rank" and "this Act" read as one tier-
// colored unit instead of a gray icon sitting next to plain white text
// with an unrelated badge bolted on. Falls back to a plain muted Act tag
// and no glow for any tier not in RANK_TIER_COLORS (only "unranked"/
// "unrated" hit this in practice) rather than rendering broken color math.
function RankPlate({ rank, actShort }) {
  const tierColor = rankTierColor(rank.tier)
  return (
    <div className="relative flex items-center gap-3.5 pl-3.5 pr-5 py-2.5 rounded-xl bg-[#11161f] border border-white/[0.06] overflow-hidden">
      {tierColor && (
        <div
          className="absolute -left-8 -top-8 w-28 h-28 rounded-full blur-2xl opacity-25 pointer-events-none"
          style={{ backgroundColor: tierColor }}
          aria-hidden="true"
        />
      )}
      <div
        className="relative shrink-0"
        style={tierColor ? { filter: `drop-shadow(0 0 8px ${tierColor}99)` } : undefined}
      >
        <RankIcon tier={rank.tier} size={48} />
      </div>
      <div className="relative flex flex-col gap-0.5 min-w-0">
        {actShort && (
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tierColor ?? '#9ba1b0' }}>
            Act {actShort}
          </span>
        )}
        <span className="font-display text-sm font-semibold text-ink truncate">{rank.tier}</span>
        <span className="flex items-baseline gap-1.5 flex-wrap">
          <span className="flex items-baseline gap-1">
            <span className="font-display text-lg font-bold text-ink">{num(rank.rr)}</span>
            <span className="text-ink/60 text-[10px] font-bold">RR</span>
          </span>
          {rank.leaderboardRank != null && (
            <span className="text-muted text-[10px]">· #{num(rank.leaderboardRank)} leaderboard</span>
          )}
        </span>
      </div>
    </div>
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

// The tier badge -- a pentagon "gem" crest per direct instruction/reference
// markup: a dark-filled pentagon, all 5 edges double-stroked (a muted base
// pass, then the tier's own color on top of 4 of the 5 -- the top edge
// deliberately stays muted-only, matching the reference exactly), 5 small
// corner notches for the faceted-gem look, and the tier letter centered
// (the reference's own center graphic is an external asset this repo
// doesn't have, so the letter stands in for it). Replaces an earlier
// 6-point star version that, per direct feedback, read as a Star of David
// rather than a rating medal -- not the intended association at all, hence
// this replacement rather than a tweak.
function TrackerScoreBadge({ score }) {
  const tier = trackerTier(score / 10)
  const light = tier?.light ?? '#a7c6cc'
  return (
    <div className="relative w-14 h-[3.73rem] shrink-0" style={{ filter: `drop-shadow(0 0 8px ${light}99)` }} title="Tracker Score tier">
      <svg viewBox="0 0 60 64" className="w-full h-full" aria-hidden="true">
        <polygon points="44.11,10.58 52.83,37.42 30.00,54.00 7.17,37.42 15.89,10.58" fill="#080e1a" />
        <line x1="44.11" y1="10.58" x2="52.83" y2="37.42" stroke="#1a2535" strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="52.83" y1="37.42" x2="30.00" y2="54.00" stroke="#1a2535" strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="30.00" y1="54.00" x2="7.17" y2="37.42" stroke="#1a2535" strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="7.17" y1="37.42" x2="15.89" y2="10.58" stroke="#1a2535" strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="15.89" y1="10.58" x2="44.11" y2="10.58" stroke="#1a2535" strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="44.11" y1="10.58" x2="52.83" y2="37.42" stroke={light} strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="52.83" y1="37.42" x2="30.00" y2="54.00" stroke={light} strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="30.00" y1="54.00" x2="7.17" y2="37.42" stroke={light} strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="7.17" y1="37.42" x2="15.89" y2="10.58" stroke={light} strokeWidth="3.5" strokeLinecap="butt" />
        <line x1="44.99" y1="9.37" x2="41.76" y2="13.82" stroke="#080e1a" strokeWidth="1.5" strokeLinecap="butt" />
        <line x1="54.25" y1="37.88" x2="49.02" y2="36.18" stroke="#080e1a" strokeWidth="1.5" strokeLinecap="butt" />
        <line x1="30.00" y1="55.50" x2="30.00" y2="50.00" stroke="#080e1a" strokeWidth="1.5" strokeLinecap="butt" />
        <line x1="5.75" y1="37.88" x2="10.98" y2="36.18" stroke="#080e1a" strokeWidth="1.5" strokeLinecap="butt" />
        <line x1="15.01" y1="9.37" x2="18.24" y2="13.82" stroke="#080e1a" strokeWidth="1.5" strokeLinecap="butt" />
        <text x="30" y="35.5" textAnchor="middle" fontSize="16" fontWeight="800" fill="#ffffff" fontFamily="inherit">
          {tier ? tier.label : '—'}
        </text>
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
// (track = --color-background, the darkest token; fill = tracker.gg's own
// real --color-accent, #bfbdb6 -- a neutral gray, confirmed by eyedropper
// against a screenshot of the real page, and genuinely NOT the same as
// their --color-action red used elsewhere) sized to the stat's own
// percentile, a normal-weight/normal-case label (NOT the
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
            className="absolute bottom-0 left-0 right-0 bg-[#bfbdb6] rounded-full"
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

// The Win % pill, widened (see its md:1.6fr grid column above) to also
// carry the map/match record that used to live in a separate WldBadge up
// in the card's top-right corner. First pass put that record in a stacked
// bar UNDER the value -- reverted per direct feedback ("add something on
// the right where the space is gained, not underneath the stat"): the gap
// this card gains over its 3 siblings is horizontal, on its right edge, so
// the record now docks there instead, as its own block separated by a
// hairline divider -- label/value/percentile keep the exact left-aligned
// layout every other GiantStat pill uses, untouched by the wider column.
function WinRateStat({ label, value, format, percentile, wins, losses, draws }) {
  const topPct = percentile == null ? null : Math.max(0.1, 100 - percentile)
  const isLeader = topPct != null && topPct <= 3
  const total = (wins ?? 0) + (losses ?? 0) + (draws ?? 0)
  return (
    <div className="flex items-stretch gap-4 bg-[#1b2733] rounded-lg px-5 py-3 shadow-[0_3px_6px_rgba(0,0,0,0.15)]">
      <div className="relative w-1 shrink-0 bg-[#0F141A] rounded-full overflow-hidden">
        {percentile != null && (
          <div
            className="absolute bottom-0 left-0 right-0 bg-[#bfbdb6] rounded-full"
            style={{ height: `${Math.max(4, percentile)}%` }}
          />
        )}
      </div>
      <div className="flex flex-col justify-center min-w-0 flex-1">
        <span className="text-muted text-base font-medium truncate">{label}</span>
        <span className="font-display text-xl font-bold text-ink">{value != null ? format(value) : '—'}</span>
        {topPct != null && (
          <span className={`text-[10px] font-medium ${isLeader ? '' : 'text-muted'}`} style={isLeader ? { color: '#cbb765' } : undefined}>
            Top {topPct.toFixed(1)}%
          </span>
        )}
      </div>
      {/* The record block itself: a small win/loss/draw donut ring plus a
          W/L/D legend, both fed by the same total-and-outcome numbers so
          they never disagree. Center of the ring carries the map/match
          COUNT (`total`) rather than repeating the win percentage already
          shown as this pill's own headline value -- a number not shown
          anywhere else on the card, so the ring earns its place instead of
          just re-illustrating Win % a second time. */}
      {total > 0 && (
        <div className="flex items-center gap-3 pl-4 border-l border-white/[0.07] shrink-0">
          <WinLossDonut wins={wins} losses={losses} draws={draws} total={total} />
          <div className="flex flex-col gap-0.5 text-[10px] font-bold tabular-nums">
            <span className="text-good">{num(wins)}W</span>
            <span className="text-bad">{num(losses)}L</span>
            {draws ? <span className="text-mid">{num(draws)}D</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}

// Win/loss(/draw) donut ring -- three (or two, Pro side has no draws)
// stroke segments around one circle, each sized to its outcome's own share
// of `total` (same `strokeDasharray`/`strokeDashoffset` technique behind
// every SVG donut chart; the whole ring is rotated -90deg first so the
// first segment starts at 12 o'clock instead of SVG's default 3 o'clock).
// Colors are the literal good/bad/mid hex values from tailwind.config.js,
// not Tailwind fill/stroke classes -- this codebase has no prior instance
// of a token-color stroke utility, and TrackerScoreBadge right above this
// already establishes raw hex as how an SVG stroke/fill in this file
// consumes these tokens. The center label is the map/match COUNT, not a
// repeat of Win % -- see WinRateStat's own comment for why.
function WinLossDonut({ wins, losses, draws, total }) {
  if (!total) return null
  const size = 40
  const strokeWidth = 6
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const segments = [
    { v: wins, color: '#4ac97e' },
    { v: losses, color: '#f7665e' },
    ...(draws ? [{ v: draws, color: '#ffd47d' }] : []),
  ].filter((s) => s.v > 0)
  let cumulative = 0
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={`${wins}W ${losses}L${draws ? ` ${draws}D` : ''}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#0F141A" strokeWidth={strokeWidth} />
        {segments.map((s, i) => {
          const len = (s.v / total) * c
          const dashoffset = -cumulative
          cumulative += len
          return (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={dashoffset}
            />
          )
        })}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-[11px] font-bold text-ink">
        {total}
      </span>
    </div>
  )
}
