import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import { HIDDEN_BY_DEFAULT_EVENTS } from '../lib/useFacetedFilter'
import {
  expandBuckets, aggregateTeamBuckets, aggregatePlayerBuckets, groupByEntity,
  expandMatchRows, aggregateTeamMapBuckets, summarizeTeamMapStats,
} from '../lib/entityBuckets'
import FilterChips from '../components/FilterChips'
import EventPicker from '../components/EventPicker'
import KpiCard from '../components/KpiCard'
import MatchHistory from '../components/MatchHistory'
import TeamLogo from '../components/TeamLogo'
import RosterTable from '../components/RosterTable'
import TeamRatingSection from '../components/TeamRatingSection'
import DataTable from '../components/DataTable'
import CompositionsTable from '../components/CompositionsTable'
import AgentIcon from '../components/AgentIcon'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { buildTeamMapRows, aggregateCompositions, aggregateCompositionPlayers } from '../lib/compositions'
import { aggregateTeamVetoStats } from '../lib/vetoStats'
import mapIcons from '../lib/mapIcons.json'
import teamLogos from '../lib/teamLogos.json'
import { rating, pct, num, eventLabel } from '../lib/format'
import { buildEventDateOrder } from '../lib/rosterTimeline'
import { coachAt } from '../lib/coaches'

// win_condition values as scraped straight from VLR's round-end icon
// filename (elim.webp -> "elim", etc.) -- labeled/ordered for display.
const WIN_CONDITION_ORDER = ['elim', 'defuse', 'boom', 'time']
const WIN_CONDITION_LABELS = { elim: 'Elimination', defuse: 'Defuse', boom: 'Spike detonated', time: 'Time expired' }

// Mirrors PlayerProfile's own tab row (Overview/Matches/Agents), split
// wider to cover what a TEAM page actually has instead of forcing all of
// it under one "Overview": Map Stats + Map Picks & Bans get their own
// "Maps" tab and Compositions gets "Agents" (a team's compositions ARE its
// agent picks) rather than piling five sections into a single scrolling
// tab the way this page used to.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Match statistics' },
  { id: 'maps', label: 'Maps' },
  { id: 'agents', label: 'Agents' },
  { id: 'roster', label: 'Roster' },
]

// Shared fallback for the four tabs whose content depends on `stats`
// (everything except Roster, which reads Liquipedia's own always-current
// roster snapshot instead -- see the comment above RosterTable below).
function ScopeEmptyState({ scopeLabel, onReset }) {
  return (
    <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
      <p className="text-muted text-sm">No maps for {scopeLabel}.</p>
      <button onClick={onReset} className="text-accent-bright text-sm hover:underline mt-2">
        Reset scope
      </button>
    </div>
  )
}

export default function TeamProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data: teamData, loading: teamsLoading } = useData('team_buckets')
  const { data: playerData, loading: playersLoading } = useData('player_buckets')
  const { data: liquipediaData } = useData('liquipedia_rosters')
  // Head Coach ONLY (Assistant Coach/Analyst/etc. dropped), computed once
  // here rather than separately inside both RosterTable (the Coaching
  // Staff card) and RosterTimeline (its coach column) since both need the
  // same underlying list. `liquipedia_rosters.json`'s `coaches` now
  // carries BOTH active and former Head Coaches (build_liquipedia_data.py
  // used to throw former ones away at the build step; see its own comment)
  // -- this is that full history, sorted oldest-first, feeding
  // RosterTimeline's succession chain (deliberately unscoped -- see that
  // component's own comment) AND, further down, whichever of these
  // actually covered the page's currently selected scope (coachesInScope,
  // computed once `filtered` exists below) for the Coaching Staff card.
  const headCoaches = useMemo(() => {
    const coaches = liquipediaData?.teams?.[decodedName]?.coaches ?? []
    const named = coaches.filter((c) => (c.role || '').toLowerCase().includes('head coach'))
    // Some orgs' Liquipedia pages never use the literal "Head Coach" label at
    // all -- their lead coach is just listed as plain "Coach" (confirmed for
    // 7 teams: Paper Rex's alecks since 2021, MIBR's fRoD, ENVY's Stunner,
    // Trace Esports' destroyeR, Attacking Soul Esports/Totoro Gaming/BESTIA's
    // sole coach -- all had zero rendered Coaching Staff/roster-timeline
    // coach column before this fallback). Only applied when a team has NO
    // "Head Coach"-labeled entry at all: for a team that DOES have one,
    // plain "Coach" is a genuinely different, subordinate staff role and
    // must not be folded in -- e.g. KIWOOM DRX's real Head Coach "termi" has
    // run alongside two separate plain-"Coach" staff for the same period,
    // and blindly matching "Coach" there would add two fake extra head
    // coaches. Verified across the full dataset: a plain "Coach" entry never
    // date-overlaps a "Head Coach" entry on any team that has both, so this
    // fallback can't introduce that same ambiguity for the 7 teams it does
    // apply to.
    const pool = named.length
      ? named
      : coaches.filter((c) => (c.role || '').trim().toLowerCase() === 'coach')
    return pool.sort((a, b) => (a.joinDate || '').localeCompare(b.joinDate || ''))
  }, [liquipediaData, decodedName])
  const { data: matchData } = useData('match_results')
  const { data: teamMapData } = useData('team_map_buckets')
  // match_players.json feeds the roster timeline's split-seat chronology
  // (see rosterTimeline.js's buildPlayerEventDates) and, below, the
  // Compositions section's per-map agent join (lib/compositions.js) --
  // idle-loaded like Players.jsx's own player_agents fetch, so it doesn't
  // compete with the page's primary data for bandwidth/parse time on first
  // paint. The timeline already renders correctly without it (a split seat
  // falls back to its old maps-descending order) until it lands a beat
  // later; Compositions simply doesn't render its section until it does.
  const idle = useIdle()
  const { data: matchPlayerData } = useData(idle ? 'match_players' : null)
  // Raw per-(match, map, team) ATK/DEF round counts + each player's own
  // per-map performance stats -- see its own comment in export_from_db.py.
  // Only needed for the Compositions section's player-stats dropdown (which
  // agent's own rating/ACS/etc sit behind one selected composition); the
  // composition list itself (games/share/Win%/RD) doesn't touch it. Idle-
  // loaded alongside match_players.json for the same reason -- optional in
  // buildTeamMapRows (degrades to null playerStats if not yet loaded), so
  // the dropdown just shows no numbers yet rather than blocking anything.
  const { data: teamMapDetailData } = useData(idle ? 'team_map_detail' : null)

  // Every bucket belonging to this team, across every year -- the base the
  // page's Year/Event scope control (below) is built from. The one event
  // this site hides by default sitewide (see HIDDEN_BY_DEFAULT_EVENTS' own
  // comment -- a scrappy 2023 China qualifier bracket of amateur teams) is
  // excluded unconditionally here rather than toggleable: the old
  // FilterPanel's checkbox for re-including it went away along with the
  // rest of that panel (see below), and no current franchise team's page
  // needs it back.
  const records = useMemo(
    () => (teamData
      ? expandBuckets(teamData, 't', (b) => b.t === decodedName)
        .filter((r) => !HIDDEN_BY_DEFAULT_EVENTS.has(r.event))
      : []),
    [teamData, decodedName]
  )

  // Scope control: a single Year (or "All"), replaced entirely by hand-
  // picked Events the moment any are added -- the same model as
  // PlayerProfile's Agent-table picker (FilterChips + EventPicker, events
  // override the year chip rather than adding to it), just driving the
  // WHOLE page here instead of one table. Direct request, replacing the
  // page-wide FilterPanel (Competition/Region/Split/Phase-Week/date-range)
  // entirely -- none of those survive. Resets when switching teams.
  const [year, setYear] = useState(null)
  const [eventOverrides, setEventOverrides] = useState([])
  useEffect(() => {
    setYear(null)
    setEventOverrides([])
  }, [decodedName])

  // Header tab row (TABS above) -- resets to Overview on team switch, same
  // as every other per-team UI state on this page (year/eventOverrides
  // above, matchLimit/selectedCompMap below).
  const [activeTab, setActiveTab] = useState('overview')
  useEffect(() => {
    setActiveTab('overview')
  }, [decodedName])

  const yearOptions = useMemo(
    () => [...new Set(records.map((r) => r.year))].sort((a, b) => a - b),
    [records]
  )
  // This team's own most recent season -- not a hardcoded 2026, since a
  // team that folded before 2026 (or hasn't debuted yet) still has its own
  // "current" season to default to.
  const latestYear = useMemo(
    () => (records.length ? Math.max(...records.map((r) => r.year)) : null),
    [records]
  )
  const effectiveYear = year ?? latestYear

  // Every event this team has at least one bucket in, most recent first (by
  // raw event id -- ids increase with time within and across seasons, see
  // export_from_db.py's own verification notes -- so this needs no separate
  // date lookup).
  const eventOptions = useMemo(() => {
    const latestIdByEvent = new Map()
    for (const r of records) {
      const cur = latestIdByEvent.get(r.event)
      if (cur === undefined || r.e > cur) latestIdByEvent.set(r.event, r.e)
    }
    return [...latestIdByEvent.entries()].sort((a, b) => b[1] - a[1]).map(([evt]) => evt)
  }, [records])

  function addEvent(evt) {
    setEventOverrides((prev) => (prev.includes(evt) ? prev : [...prev, evt]))
  }
  function removeEvent(evt) {
    setEventOverrides((prev) => prev.filter((e) => e !== evt))
  }
  function resetScope() {
    setYear(null)
    setEventOverrides([])
  }

  // Does a record belong to the current scope? Once any events are added
  // they take over entirely (OR'd together) and the year chip stops
  // applying -- matching PlayerProfile's Agent-table picker exactly.
  // useCallback (not a plain function) so every useMemo below that filters
  // by it can list `inScope` itself as a dependency instead of duplicating
  // this same two-line predicate three times.
  const inScope = useCallback((r) => (
    eventOverrides.length
      ? eventOverrides.includes(r.event)
      : effectiveYear === 'All' || r.year === effectiveYear
  ), [effectiveYear, eventOverrides])

  const filtered = useMemo(() => records.filter(inScope), [records, inScope])

  // Single reference date for the WHOLE roster's status badges (see
  // RosterTable's findStintAt) -- the latest date actually in the
  // selected scope, so picking a whole season (or a specific end-of-year
  // event like Champions) shows the roster the way it stood AT THAT
  // POINT, not each player's own last-active date. Direct request: a
  // player who started early in the season and was benched before the
  // scope's own last event should read as BENCHED for that scope, not
  // STARTER just because STARTER is what they were during the weeks they
  // personally played. `filtered` already carries a real per-day `date`
  // (team buckets are keyed per calendar day, see expandBuckets), so this
  // is just its max.
  const asOfDate = useMemo(() => {
    let max = null
    for (const r of filtered) {
      if (r.date && (!max || r.date > max)) max = r.date
    }
    return max
  }, [filtered])

  // Does the selected scope reach this team's own most recent season?
  // Liquipedia only ever describes the CURRENT roster (plus a former-
  // players log), so `findStintAt`'s "as of asOfDate" matching in
  // RosterTable is only meaningful when the scope's end actually sits
  // near the present -- for a purely historical scope (e.g. Year=2023 on
  // a team still active in 2026) it's answering a question nobody asked
  // ("was this person confirmed-departed as of some arbitrary date years
  // ago") instead of the simpler one that's actually wanted: who has real
  // stats for this team in this scope. RosterTable uses this to switch
  // from the Liquipedia-whitelisted/status-badged view to a plain
  // stats-only roster (every player in `roster` below, no filtering, no
  // STARTER/BENCHED/captain) for that case -- direct request, since
  // per-bucket team tagging (see `roster`'s own comment) already handles
  // mid-season transfers correctly with no Liquipedia data needed at all.
  // `latestYear` is null for a team with literally zero completed matches
  // (real case: Play-Ins participants who have a team_buckets `meta` entry
  // -- this site already knows their name/region from the schedule -- but
  // haven't played their first VCT-scoped match yet, e.g. Sharper Esports,
  // BESTIA). That's not a "purely historical scope" in the sense this
  // variable exists to detect -- there IS no history, past or present, to
  // fall back to -- so it should read as "current" (there's only one
  // possible roster to show: whatever Liquipedia says right now) rather
  // than "historical" (which would show the plain stats-only branch, i.e.
  // nothing at all, since `roster` below is also necessarily empty).
  const rosterIsCurrent = useMemo(
    () => latestYear === null || filtered.some((r) => r.year === latestYear),
    [filtered, latestYear]
  )

  // Which head coach(es) actually covered the currently selected Year/
  // Event scope -- the Coaching Staff card used to always show whoever is
  // coaching the team RIGHT NOW regardless of scope, so picking a past
  // year (or an event from before the current coach's tenure) still
  // showed today's coach, which is the same "always show today's state"
  // bug the Players table below used to have too (see RosterTable.jsx's
  // own comment on `currentRows` for how that one's fixed now). Reuses
  // `coachAt`, the same per-event covering-coach
  // lookup RosterTimeline's own coach column already runs, against every
  // DISTINCT event actually present in `filtered` -- so a scope spanning
  // a coaching change (e.g. selecting two years that had different
  // coaches) correctly surfaces every coach who covered part of it, not
  // just one.
  //
  // Direct request, mirroring `rosterIsCurrent`'s split for the player
  // table above: an ONGOING-season scope should show only whoever is
  // coaching the team right now (a single row, not the season's whole
  // coaching-change history), while a purely historical scope still lists
  // every coach who covered any part of it. `currentCoach` is whichever
  // head coach has no `leaveDate` (still in the role) -- ties broken
  // toward the most recent `joinDate`, matching `coachAt`'s own tie-break
  // for a same-day handover, though in practice Liquipedia only ever
  // leaves one Head Coach entry open at a time.
  const currentCoach = useMemo(() => {
    const active = headCoaches.filter((c) => !c.leaveDate)
    if (!active.length) return null
    return active.reduce((a, b) => (b.joinDate > a.joinDate ? b : a))
  }, [headCoaches])
  const eventDateForCoach = useMemo(
    () => buildEventDateOrder(matchData?.rows || []),
    [matchData]
  )
  const coachesInScope = useMemo(() => {
    if (!headCoaches.length) return []
    if (rosterIsCurrent) return currentCoach ? [currentCoach] : []
    const dated = [...new Set(filtered.map((r) => r.e))]
      .map((id) => eventDateForCoach.get(id))
      .filter(Boolean)
      .sort()
    const seen = new Set()
    const out = []
    for (const date of dated) {
      const c = coachAt(date, headCoaches)
      // Keyed on id+joinDate, not just id -- a coach who left and later
      // came back is two genuinely separate stints, and should get its
      // own row rather than being silently deduped into one.
      const key = c && `${c.id}|${c.joinDate}`
      if (c && !seen.has(key)) {
        seen.add(key)
        out.push(c)
      }
    }
    return out
  }, [filtered, headCoaches, eventDateForCoach, rosterIsCurrent, currentCoach])

  const scopeLabel = eventOverrides.length === 1
    ? eventLabel(eventOverrides[0])
    : eventOverrides.length > 1
      ? `${eventOverrides.length} events`
      : effectiveYear === 'All' ? 'All years' : effectiveYear

  const stats = useMemo(() => aggregateTeamBuckets(filtered), [filtered])

  // Map Stats table -- team_map_buckets.json is scoped/expanded exactly
  // like team_buckets.json (same event/week/day grain, plus a map name
  // dimension), so it goes through the same `inScope` predicate directly
  // rather than through `filtered` itself (same pattern MatchHistory's
  // matchRows below uses for a second, differently-shaped dataset).
  //
  // Expanded once per team (not per scope change) so changing the Year/
  // Event picker only re-runs the cheap `inScope` pass over this team's own
  // few dozen rows, rather than re-expanding all 5,618 buckets in the file
  // first.
  const teamMapRecords = useMemo(
    () => (teamMapData
      ? expandBuckets(teamMapData, 't', (b) => b.t === decodedName)
        .filter((r) => !HIDDEN_BY_DEFAULT_EVENTS.has(r.event))
      : []),
    [teamMapData, decodedName]
  )

  const mapStats = useMemo(
    () => aggregateTeamMapBuckets(teamMapRecords.filter(inScope)),
    [teamMapRecords, inScope]
  )

  const mapStatsOverall = useMemo(() => summarizeTeamMapStats(mapStats), [mapStats])

  const mapStatsColumns = useMemo(() => [
    { key: 'map', label: 'Map', align: 'left' },
    { key: 'mapsPlayed', label: 'Played', align: 'right', format: (v) => num(v) },
    { key: 'winPct', label: 'Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'atkWinPct', label: 'ATK Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'defWinPct', label: 'DEF Win%', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'pistolWinPct', label: 'Pistol Win%', align: 'right', colorScale: true, format: (v, row) => (row.pistolRounds ? pct(v) : '—') },
    { key: 'wins', label: 'W', align: 'right', format: (v) => num(v) },
    { key: 'losses', label: 'L', align: 'right', format: (v) => num(v) },
    { key: 'roundsWon', label: 'RW', align: 'right', format: (v) => num(v) },
    { key: 'roundsLost', label: 'RL', align: 'right', format: (v) => num(v) },
    { key: 'atkStart', label: 'ATK 1st', align: 'right', format: (v) => num(v) },
    { key: 'defStart', label: 'DEF 1st', align: 'right', format: (v) => num(v) },
    // How often this map goes to OT at all -- distinct from the "OT" column
    // right after it, which is the team's win record *once* it gets there.
    { key: 'otPct', label: 'OT%', align: 'right', format: (v, row) => (row.mapsPlayed ? pct(v) : '—') },
    { key: 'otMaps', label: 'OT', align: 'right', format: (v, row) => (row.otMaps ? `${row.otWon}/${row.otMaps}` : '—') },
  ], [])

  // Every player bucket belonging to THIS team, expanded once per team
  // rather than once per scope change (the roster memo below depends on
  // `filtered`, so leaving the expansion inside it re-walked all 10,894
  // buckets in player_buckets.json on every chip click -- ~8ms of pure
  // rework for a set that can't change unless the file or the team does).
  //
  // Filtered by each BUCKET's own team field, not the player's single
  // static meta.team -- a player who switches teams mid-season (e.g.
  // Cloud: GIANTX -> FNATIC for Stage 2) has buckets under BOTH teams,
  // and meta.team only ever reflects whichever team their first-ever
  // match happened to be for. Using meta.team here meant Cloud was
  // completely absent from FNATIC's roster despite having real,
  // correctly-team-tagged Stage 2 buckets -- and would show as
  // permanently on GIANTX even after leaving. Filtering per-bucket
  // means a mid-season transfer correctly shows up on BOTH team pages,
  // each only for the buckets that actually belong to it.
  const teamPlayerRecords = useMemo(
    () => (playerData ? expandBuckets(playerData, 'p', (b) => b.t === decodedName) : []),
    [playerData, decodedName]
  )

  // Roster reflects the same scope: apply the team's active Year/Event
  // selection to the player buckets, keeping only this team's players.
  const roster = useMemo(() => {
    if (!playerData) return []
    // (event|week) -> [earliest, latest] date THIS team actually played
    // in that week. Player buckets are keyed per (player, event, week)
    // with no day dimension of their own -- `d` on that schema is
    // Deaths, not a date -- so a player's active window has to come from
    // the team's own buckets, which are keyed per calendar day and do
    // carry a real date string.
    const weekDates = new Map()
    for (const r of filtered) {
      if (typeof r.d !== 'string') continue
      const k = `${r.e}|${r.w}`
      const cur = weekDates.get(k)
      weekDates.set(k, cur ? [cur[0] < r.d ? cur[0] : r.d, cur[1] > r.d ? cur[1] : r.d] : [r.d, r.d])
    }
    const scopedKeys = new Set(filtered.map((r) => `${r.e}|${r.w}`))
    // teamPlayerRecords is already narrowed to this team's buckets (see
    // above); all that's left here is the current scope.
    const recs = teamPlayerRecords.filter((r) => scopedKeys.has(`${r.e}|${r.w}`))
    const out = []
    for (const [player, buckets] of groupByEntity(recs)) {
      const s = aggregatePlayerBuckets(buckets)
      if (!s || !s.mapsPlayed) continue
      const m = playerData.meta[player]
      // meta is deliberately VCT-only at the export layer (see
      // export_from_db.py's players.json section) -- a player who only
      // ever played EWC has real bucket data here but no meta entry, so
      // this has to be skipped rather than assumed present, matching the
      // same guard every other page reading player meta already has
      // (Overview/Players/Records.jsx).
      if (!m) continue
      let firstDate = null, lastDate = null
      for (const b of buckets) {
        const win = weekDates.get(`${b.e}|${b.w}`)
        if (!win) continue
        if (!firstDate || win[0] < firstDate) firstDate = win[0]
        if (!lastDate || win[1] > lastDate) lastDate = win[1]
      }
      out.push({
        player, ...s,
        countryCode: m.countryCode, countryName: m.countryName,
        firstDate, lastDate,
      })
    }
    // Share of the team's own maps in scope -- the denominator is the
    // team's map count, not the roster's busiest player, so a team
    // where everyone rotated doesn't get a spurious 100% at the top.
    const teamMaps = stats?.mapsPlayed ?? 0
    for (const p of out) {
      p.mapShare = teamMaps ? Math.min(1, p.mapsPlayed / teamMaps) : null
    }
    return out.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
  }, [playerData, teamPlayerRecords, filtered, stats])

  // Match history, filtered by the same scope as everything else on the
  // page. Matched on team1/team2 rather than on the scoreboard rows' own
  // team, so a match still lists even if its box score was never
  // published -- its match page then shows the empty-state.
  //
  // No match_players.json is loaded for this: MatchHistory only reads
  // playersByMatch on a *player* perspective (to resolve which team that
  // player was on for each match, since a transfer changes it). A team
  // perspective already knows whose row it is, so fetching that 3.9MB file
  // and building its 10,974-row Map here produced nothing that was read.
  const teamMatches = useMemo(
    () => expandMatchRows(matchData)
      .filter((m) => m.team1 === decodedName || m.team2 === decodedName)
      .filter((m) => !HIDDEN_BY_DEFAULT_EVENTS.has(m.event)),
    [matchData, decodedName]
  )

  const matchRows = useMemo(() => teamMatches.filter(inScope), [teamMatches, inScope])

  // Pick/ban record, from match_results.json's own `veto` array on each
  // match in `matchRows` -- no separate fetch, `matchData` already carries
  // it. Only matches VLR rendered a veto note for contribute (see
  // aggregateTeamVetoStats's own comment); `matchesWithVeto` lets the
  // caption below say how much of the current scope that actually covers,
  // same pattern as the Pistol Win% KPI's "No economy data" fallback above.
  const vetoStats = useMemo(() => aggregateTeamVetoStats(matchRows, decodedName), [matchRows, decodedName])

  const vetoColumns = useMemo(() => [
    { key: 'map', label: 'Map', align: 'left' },
    { key: 'banned', label: 'Banned', align: 'right', format: (v) => num(v) },
    { key: 'picked', label: 'Picked', align: 'right', format: (v) => num(v) },
    { key: 'decider', label: 'Decider', align: 'right', format: (v) => num(v) },
    {
      key: 'pickWinPct', label: 'Win% (own pick)', align: 'right', colorScale: true,
      format: (v, row) => (row.picked ? pct(v) : '—'),
    },
  ], [])

  // Compositions section: same match_results + match_players join
  // AgentCompositions.jsx runs (see lib/compositions.js), narrowed to this
  // one team's own composition rows. The join itself runs once per data
  // load regardless of team (matches decodedName-independent memo below);
  // only the flatMap-and-filter into this team's rows re-runs on a team or
  // scope change. `matchRows` above is already both team-matched AND
  // Year/Event-scoped, so reusing it here (rather than re-deriving from
  // `records`) keeps this section on the same scope as the rest of the
  // page for free.
  const compByMatch = useMemo(
    () => buildTeamMapRows(matchData, matchPlayerData, teamMapDetailData),
    [matchData, matchPlayerData, teamMapDetailData]
  )
  const teamCompRows = useMemo(() => {
    const out = []
    for (const m of matchRows) {
      const rows = compByMatch.get(m.id)
      if (!rows) continue
      for (const r of rows) if (r.team === decodedName) out.push(r)
    }
    return out
  }, [compByMatch, matchRows, decodedName])

  const compMapsInScope = useMemo(() => {
    const counts = new Map()
    for (const r of teamCompRows) counts.set(r.map, (counts.get(r.map) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([map]) => map)
  }, [teamCompRows])

  // No "All maps" option, same reasoning as AgentCompositions.jsx: a
  // composition is inherently a per-map thing. Resets to null (-> falls
  // back to this team's most-played map) whenever the team changes, same
  // as `year`/`eventOverrides` above.
  const [selectedCompMap, setSelectedCompMap] = useState(null)
  useEffect(() => {
    setSelectedCompMap(null)
  }, [decodedName])
  const effectiveCompMap = compMapsInScope.includes(selectedCompMap) ? selectedCompMap : compMapsInScope[0]

  const compRows = useMemo(
    () => teamCompRows.filter((r) => r.map === effectiveCompMap),
    [teamCompRows, effectiveCompMap]
  )
  const compositions = useMemo(() => aggregateCompositions(compRows), [compRows])
  const cappedComps = compositions.comps.slice(0, 50)
  const hiddenCompsCount = compositions.comps.length - cappedComps.length

  const compPlayerColumns = useMemo(() => [
    { key: 'player', label: 'Player', align: 'left', format: (v) => <span className="text-ink text-xs font-medium">{v}</span> },
    {
      key: 'agent', label: 'Agent', align: 'left', noPadding: true,
      format: (v) => (
        <span className="flex items-center gap-2 px-3 py-1">
          <AgentIcon agent={v} size={22} />
          <span className="text-ink text-xs font-medium">{v}</span>
        </span>
      ),
    },
    { key: 'games', label: 'Games', align: 'right', format: (v) => num(v) },
    { key: 'rating', label: 'R', align: 'right', colorScale: true, format: (v) => rating(v) },
    { key: 'acs', label: 'ACS', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : num(v, 0)) },
    { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'kast', label: 'KAST', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : pct(v)) },
    { key: 'adr', label: 'ADR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : num(v, 1)) },
    { key: 'kpr', label: 'KPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'apr', label: 'APR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fkpr', label: 'FKPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fdpr', label: 'FDPR', align: 'right', colorScale: true, colorInvert: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  ], [])

  // Per-row expanded detail for the Compositions table below: an arrow on
  // each composition row that opens a nested table of exactly the players
  // who ran that composition and which agent each one played, rather than a
  // separate dropdown+table elsewhere on the page driving a second,
  // disconnected view. Only rows whose OWN comp matches the expanded one --
  // not just anything on the selected map -- so this shows the performance
  // of the players who actually ran THIS 5-agent set, not the map's agent
  // pool at large (that's the Agent impact tab's job instead). Computed
  // on demand per expanded row (DataTable only calls this for rows that are
  // actually open), not memoized across all 50 compositions up front.
  const renderCompositionPlayers = useCallback((compRow) => {
    const players = aggregateCompositionPlayers(
      compRows.filter((r) => r.comp.join('|') === compRow.comp.join('|'))
    )
    return <DataTable columns={compPlayerColumns} rows={players} defaultSortKey="games" />
  }, [compRows, compPlayerColumns])

  // Paginated 30 at a time, same as PlayerProfile's Match history -- a
  // franchise slot's history can now run back to LOCK//IN 2023 (see the
  // roster-timeline entries in project-history), long enough that rendering
  // every row at once made this section the tallest thing on the page.
  // `matchLimit` resets whenever the profile switches teams.
  const sortedMatchRows = useMemo(
    () => [...matchRows].sort(
      (a, b) => (b.ts || b.date || '').localeCompare(a.ts || a.date || '') || b.id - a.id
    ),
    [matchRows]
  )
  const [matchLimit, setMatchLimit] = useState(30)
  useEffect(() => {
    setMatchLimit(30)
  }, [decodedName])
  const visibleMatchRows = useMemo(
    () => sortedMatchRows.slice(0, matchLimit),
    [sortedMatchRows, matchLimit]
  )

  if (teamsLoading || playersLoading) return <div className="text-muted text-sm">Loading…</div>

  const meta = teamData?.meta?.[decodedName]
  if (!meta) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/teams" className="text-sm text-accent-bright hover:underline">← Back to Teams</Link>
        <p className="text-muted text-sm">No team found matching "{decodedName}".</p>
      </div>
    )
  }

  // Header card's TrophyCase, mirroring PlayerProfile's own
  // (buildTrophyWinners + a narrowing step) -- teams need no narrowing
  // step, since trophies.js already keys each entry by the champion TEAM
  // directly. Career-wide (every year this team has ever won, unfiltered by
  // the page's active scope), same as PlayerProfile's trophy case.
  const hasLogo = !!teamLogos[decodedName]?.logo

  return (
    <div className="flex flex-col gap-6">
      <Link to="/teams" className="text-sm text-muted hover:text-ink w-fit">← Back to Teams</Link>

      {/* One merged card for the header info AND the scope-control row below
          it -- a literal structural copy of PlayerProfile's own header card
          (info block, hairline divider, then a controls row, all inside one
          `rounded-2xl bg-grad-surface border overflow-hidden` box), with
          each piece mapped onto what a TEAM has rather than a player:
          logo instead of photo, region instead of flag/realname/role/
          birthdate, no right-side action row (no team-compare page or
          external tracker-style profile link exists to put there), and the
          same TrophyCase strip -- trophies.js's `team` field already names
          the champion team directly, so this needs no player-roster
          narrowing step the way PlayerProfile's `playerTrophies` does. */}
      <div className="relative flex flex-col bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm overflow-hidden">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          {/* Same halo treatment as PlayerProfile's photo frame, and the
              same reason it's conditional: bg-accent/25 blur-2xl reads as a
              nice glow behind an EMPTY placeholder box but as a red glare
              bleeding past the frame's edges behind a real image. Every team
              this page can render already has real logo art in
              teamLogos.json (it's committed lookup data, not a scraper
              manifest that can come up empty for who's currently on
              screen), so `hasLogo` only ever turns the halo off in practice
              -- kept conditional anyway rather than deleted outright, same
              as PlayerProfile keeps its own check despite most players
              having a photo, so a future team missing from that file still
              gets the placeholder treatment instead of a bare glow-less box. */}
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0">
            {!hasLogo && (
              <div className="absolute inset-0 rounded-xl bg-accent/25 blur-2xl" aria-hidden="true" />
            )}
            <div className="relative w-full h-full rounded-xl bg-surface2 border border-hairline flex items-center justify-center overflow-hidden">
              <TeamLogo team={decodedName} size={56} showName={false} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink truncate">{decodedName}</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-muted text-sm">
              <span>{meta.region}</span>
            </div>
          </div>
        </div>

        </div>

        {/* Divider -- flush against the card's own edges, same as
            PlayerProfile's bare `border-t` between its header block and its
            tab row. */}
        <div className="border-t border-hairline" />

        {/* Tab row + scope controls, INSIDE the same card as the header
            above -- byte-for-byte the same row PlayerProfile uses (tabs
            left, Select pair right, `flex-col-reverse` on mobile so the
            controls sit above the tab strip on narrow widths). The scope
            control itself is still a Year (or "All") replaced entirely by
            hand-picked Events the moment any are added -- see the comment
            on `inScope` above for why -- just positioned where
            PlayerProfile's own Select pair sits rather than left-aligned
            with nothing to its left. */}
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
            {eventOverrides.length === 0 && (
              <Select variant="ghost" options={['All', ...yearOptions]} value={effectiveYear} onChange={setYear} />
            )}
            <EventPicker
              options={eventOptions}
              selected={eventOverrides}
              onAdd={addEvent}
              onRemove={removeEvent}
            />
          </div>
        </div>
      </div>

      {activeTab === 'overview' && <>
        {/* Glicko-2 season rating. Sits outside the `stats.mapsPlayed` gate
            below on purpose: it reads match_results, not the team_buckets
            this page's other stats aggregate, so it still has something to
            say for a scope those come up empty for -- and it renders nothing
            at all when the team has no rated season, so an empty gap isn't a
            risk. Passed the year only, never eventOverrides: see the
            component's own comment on why a Glicko rating can't be scoped
            narrower than a whole run. */}
        {matchData && (
          <TeamRatingSection
            matchData={matchData}
            team={decodedName}
            year={typeof effectiveYear === 'number' ? effectiveYear : null}
          />
        )}

        {!stats || !stats.mapsPlayed ? (
          <ScopeEmptyState scopeLabel={scopeLabel} onReset={resetScope} />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <KpiCard
                label="Matches"
                value={`${stats.matchesWon}–${stats.matchesPlayed - stats.matchesWon}`}
                sub={pct(stats.matchWinPct)}
              />
              <KpiCard label="Avg Player Rating" value={rating(stats.avgRating)} />
              <KpiCard
                label="Pistol Win%"
                value={stats.pistolWon ? pct(stats.pistolWinPct) : '—'}
                sub={stats.pistolWon ? `${stats.pistolWon}/${stats.pistolPlayed}` : 'No economy data (China)'}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                label="Comebacks"
                value={stats.comebackMaps ? `${stats.comebackWon}/${stats.comebackMaps}` : '—'}
                sub="Won after facing a 3+ round deficit"
              />
              <KpiCard
                label="Post-Pistol Anti-Eco"
                value={stats.postPistolAntiEcoRounds ? pct(stats.postPistolAntiEcoWinPct) : '—'}
                sub="Rounds 2 & 14, after winning the pistol"
              />
              <KpiCard
                label="Bonus Round"
                value={stats.bonusRounds ? pct(stats.bonusWinPct) : '—'}
                sub="Rounds 3 & 15, after winning the pistol AND round 2/14"
              />
              <KpiCard
                label="Anti-Eco Win%"
                value={stats.antiEcoRounds ? pct(stats.antiEcoWinPct) : '—'}
                sub={stats.antiEcoRounds ? `${stats.antiEcoRounds} rounds` : 'No economy data'}
              />
            </div>

            {Object.keys(stats.winConditions || {}).length > 0 && (
              <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5">
                <h3 className="font-display text-sm font-semibold text-ink mb-1">
                  How this team closes out rounds
                </h3>
                <p className="text-muted text-xs mb-4">
                  Share of this team's round wins by how the round ended.
                </p>
                <div className="flex gap-4 flex-wrap">
                  {WIN_CONDITION_ORDER.filter((k) => stats.winConditions[k]).map((k) => {
                    const n = stats.winConditions[k]
                    const total = Object.values(stats.winConditions).reduce((a, b) => a + b, 0)
                    return (
                      <div key={k} className="flex flex-col items-center gap-1 min-w-[80px]">
                        <div className="text-2xl font-display font-semibold text-ink">
                          {Math.round((n / total) * 100)}%
                        </div>
                        <div className="text-muted text-xs capitalize">{WIN_CONDITION_LABELS[k] || k}</div>
                        <div className="text-muted/70 text-[11px]">{n} rounds</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </>}

      {activeTab === 'matches' && (
        !stats || !stats.mapsPlayed ? (
          <ScopeEmptyState scopeLabel={scopeLabel} onReset={resetScope} />
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Match history</h3>
            <p className="text-muted text-xs">
              Every {decodedName} match in scope — click a row for map scores and the full scoreboard.
            </p>
            <MatchHistory
              matches={visibleMatchRows}
              perspective={{ type: 'team', name: decodedName }}
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

      {activeTab === 'maps' && (
        !stats || !stats.mapsPlayed ? (
          <ScopeEmptyState scopeLabel={scopeLabel} onReset={resetScope} />
        ) : (
          <>
            {mapStats.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-sm font-semibold text-ink">Map Stats</h3>
                <p className="text-muted text-xs">
                  {decodedName}'s record on every map played in scope.
                </p>
                <DataTable
                  columns={mapStatsColumns}
                  rows={mapStats}
                  summaryRow={mapStatsOverall}
                  defaultSortKey="winPct"
                />
              </div>
            )}

            {vetoStats.matchesWithVeto > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-sm font-semibold text-ink">Map Picks & Bans</h3>
                <p className="text-muted text-xs">
                  {decodedName}'s veto record across {vetoStats.matchesWithVeto} of {matchRows.length} match
                  {matchRows.length === 1 ? '' : 'es'} in scope with pick/ban data.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <KpiCard
                    label="Own Picks Win%"
                    value={vetoStats.ownPick.maps ? pct(vetoStats.ownPick.winPct) : '—'}
                    sub={vetoStats.ownPick.maps ? `${vetoStats.ownPick.wins}–${vetoStats.ownPick.maps - vetoStats.ownPick.wins} maps` : 'No own picks played'}
                  />
                  <KpiCard
                    label="Opponent Picks Win%"
                    value={vetoStats.oppPick.maps ? pct(vetoStats.oppPick.winPct) : '—'}
                    sub={vetoStats.oppPick.maps ? `${vetoStats.oppPick.wins}–${vetoStats.oppPick.maps - vetoStats.oppPick.wins} maps` : 'No opponent picks played'}
                  />
                  <KpiCard
                    label="Decider Win%"
                    value={vetoStats.decider.maps ? pct(vetoStats.decider.winPct) : '—'}
                    sub={vetoStats.decider.maps ? `${vetoStats.decider.wins}–${vetoStats.decider.maps - vetoStats.decider.wins} maps` : 'No deciders played'}
                  />
                </div>
                <DataTable
                  columns={vetoColumns}
                  rows={vetoStats.byMap}
                  defaultSortKey="picked"
                />
              </div>
            )}
          </>
        )
      )}

      {activeTab === 'agents' && (
        !stats || !stats.mapsPlayed ? (
          <ScopeEmptyState scopeLabel={scopeLabel} onReset={resetScope} />
        ) : (
          matchPlayerData && compMapsInScope.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-display text-sm font-semibold text-ink">Compositions</h3>
              <p className="text-muted text-xs">
                {decodedName}'s most-played 5-agent compositions and win rates on the map
                selected below, in scope.
              </p>
              <FilterChips
                options={compMapsInScope}
                value={effectiveCompMap}
                onChange={setSelectedCompMap}
                getBg={(opt) => mapIcons[opt]}
              />
              <p className="text-muted text-xs">
                Click the arrow on a row to see which player ran each agent, and their own
                numbers, within that specific composition.
              </p>
              <CompositionsTable
                rows={cappedComps}
                hiddenCount={hiddenCompsCount}
                renderExpanded={renderCompositionPlayers}
              />
            </div>
          )
        )
      )}

      {/* Roster identity (Coaching Staff + Players) and its timeline
          deliberately are NOT gated on `stats.mapsPlayed` the way the tabs
          above are: Coaching Staff comes from Liquipedia's always-current
          snapshot (unrelated to whatever scope is selected) and
          RosterTimeline already reads the team's full, unfiltered history
          on its own (see its own comment on why it isn't scoped at all). */}
      {activeTab === 'roster' && <>
        <RosterTable
          team={decodedName}
          rows={roster}
          liquipedia={liquipediaData?.teams?.[decodedName]}
          matches={matchRows}
          asOfDate={asOfDate}
          rosterIsCurrent={rosterIsCurrent}
        />

      </>}
    </div>
  )
}
