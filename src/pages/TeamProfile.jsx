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
import RosterTimeline from '../components/RosterTimeline'
import DataTable from '../components/DataTable'
import { rating, pct, num, eventLabel } from '../lib/format'
import { buildEventDateOrder } from '../lib/rosterTimeline'
import { coachAt } from '../lib/coaches'

// win_condition values as scraped straight from VLR's round-end icon
// filename (elim.webp -> "elim", etc.) -- labeled/ordered for display.
const WIN_CONDITION_ORDER = ['elim', 'defuse', 'boom', 'time']
const WIN_CONDITION_LABELS = { elim: 'Elimination', defuse: 'Defuse', boom: 'Spike detonated', time: 'Time expired' }

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
  const headCoaches = useMemo(
    () => (liquipediaData?.teams?.[decodedName]?.coaches ?? [])
      .filter((c) => (c.role || '').toLowerCase().includes('head coach'))
      .sort((a, b) => (a.joinDate || '').localeCompare(b.joinDate || '')),
    [liquipediaData, decodedName]
  )
  const { data: matchData } = useData('match_results')
  const { data: teamMapData } = useData('team_map_buckets')
  // match_players.json (3.9MB) feeds only the roster timeline's split-seat
  // chronology (see rosterTimeline.js's buildPlayerEventDates) -- idle-
  // loaded like Players.jsx's own player_agents fetch, so it doesn't
  // compete with the page's primary data for bandwidth/parse time on
  // first paint. The timeline itself already renders correctly without it
  // (a split seat falls back to its old maps-descending order) until it
  // lands a beat later.
  const idle = useIdle()
  const { data: matchPlayerData } = useData(idle ? 'match_players' : null)

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
  const rosterIsCurrent = useMemo(
    () => filtered.some((r) => r.year === latestYear),
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

  // Paginated 30 at a time, same as PlayerProfile's Match history -- a
  // franchise slot's history can now run back to LOCK//IN 2023 (see the
  // roster-timeline entries in project-history), long enough that rendering
  // every row at once made this section the tallest thing on the page.
  // `matchLimit` resets whenever the profile switches teams.
  const sortedMatchRows = useMemo(
    () => [...matchRows].sort(
      (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id
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

  return (
    <div className="flex flex-col gap-6">
      <Link to="/teams" className="text-sm text-muted hover:text-ink w-fit">← Back to Teams</Link>

      <div className="flex items-stretch gap-4">
        <div className="w-16 rounded-xl bg-surface2 border border-hairline flex items-center justify-center shrink-0">
          <TeamLogo team={decodedName} size={44} showName={false} />
        </div>
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-2xl font-semibold text-ink">{decodedName}</h1>
          <p className="text-muted text-sm">{meta.region}</p>
        </div>
      </div>

      {/* Whole-page scope control: a Year (or "All"), replaced entirely by
          hand-picked Events the moment any are added -- see the comment on
          `inScope` above for why. Replaces the old multi-facet FilterPanel
          (Competition/Region/Split/Phase-Week/date-range) sitewide-style
          control with the simpler model PlayerProfile's Agent table already
          uses, per direct request. */}
      <div className="flex items-center gap-2 flex-wrap">
        {eventOverrides.length === 0 && (
          <FilterChips options={['All', ...yearOptions]} value={effectiveYear} onChange={setYear} />
        )}
        <EventPicker
          options={eventOptions}
          selected={eventOverrides}
          onAdd={addEvent}
          onRemove={removeEvent}
        />
      </div>

      {/* Match-stat sections (KPIs/Map Stats/round curve/win conditions/
          rating trend/match history) stay gated on `stats.mapsPlayed` --
          Roster identity (Coaching Staff + Players, below) and its timeline
          deliberately are NOT: Coaching Staff comes from Liquipedia's
          always-current snapshot (unrelated to whatever scope is selected)
          and RosterTimeline already reads the team's full, unfiltered
          history on its own (see its own comment on why it isn't scoped at
          all). Both used to sit inside this same gate, so picking a scope
          with zero matches for this team hid the coach and roster too, even
          though neither one actually depends on this scope being non-empty. */}
      {!stats || !stats.mapsPlayed ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No maps for {scopeLabel}.</p>
          <button onClick={resetScope} className="text-accent-bright text-sm hover:underline mt-2">
            Reset scope
          </button>
        </div>
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
        </>
      )}

      <RosterTable
        team={decodedName}
        rows={roster}
        liquipedia={liquipediaData?.teams?.[decodedName]}
        matches={matchRows}
        coaches={coachesInScope}
        asOfDate={asOfDate}
        rosterIsCurrent={rosterIsCurrent}
      />

      {playerData && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold text-ink">Roster timeline of {decodedName}</h2>
          <RosterTimeline
            playerBuckets={playerData}
            team={decodedName}
            matchResultsRows={matchData?.rows}
            matchPlayersRows={matchPlayerData?.rows}
            headCoaches={headCoaches}
          />
        </div>
      )}

      {stats && stats.mapsPlayed > 0 && (
        <>
          {Object.keys(stats.winConditions || {}).length > 0 && (
            <div className="bg-surface border border-hairline rounded-2xl p-5">
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
              <button
                type="button"
                onClick={() => setMatchLimit((l) => Math.min(l + 30, sortedMatchRows.length))}
                className="self-center text-xs font-medium text-muted hover:text-accent-bright transition-colors px-4 py-2 rounded-lg border border-hairline hover:border-accent-bright/40"
              >
                Load more ({sortedMatchRows.length - matchLimit} more)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
