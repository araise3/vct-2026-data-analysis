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
import TrendChart from '../components/TrendChart'

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
  // -- `headCoaches` is that full history, sorted oldest-first, feeding
  // RosterTimeline's succession chain; `headCoach` narrows it to whichever
  // one is currently active, for the Coaching Staff card and its win-rate
  // (a fixed "since NOW's coach took over" fact, not a historical one).
  const headCoaches = useMemo(
    () => (liquipediaData?.teams?.[decodedName]?.coaches ?? [])
      .filter((c) => (c.role || '').toLowerCase().includes('head coach'))
      .sort((a, b) => (a.joinDate || '').localeCompare(b.joinDate || '')),
    [liquipediaData, decodedName]
  )
  const headCoach = useMemo(
    () => headCoaches.find((c) => c.status === 'active') ?? null,
    [headCoaches]
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
  // "current" season both to default to and to compare a selected scope
  // against (see rosterIsCurrent below).
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

  const scopeLabel = eventOverrides.length === 1
    ? eventLabel(eventOverrides[0])
    : eventOverrides.length > 1
      ? `${eventOverrides.length} events`
      : effectiveYear === 'All' ? 'All years' : effectiveYear

  // Whether the currently selected scope includes this team's most recent
  // season -- decides whether RosterTable enforces its "must be on
  // Liquipedia's CURRENT roster" whitelist (see that component's own
  // comment). That whitelist exists to hide players who've since left but
  // still have real stats in a wide-enough scope; applied unconditionally,
  // though, it also hid a HISTORICAL season's real roster whenever none of
  // today's players happened to be on the team back then (e.g. picking
  // Year=2023 on a team whose entire 2023 lineup has since turned over --
  // every 2023 player got filtered out, leaving "No players in this scope"
  // despite the team having real matches that year). A purely-historical
  // scope shows that season's actual roster instead, so the whitelist only
  // applies once the scope reaches back to the present.
  const rosterIsCurrent = useMemo(
    () => latestYear != null && filtered.some((r) => r.year === latestYear),
    [filtered, latestYear]
  )

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

  // Round-number win curve. TrendChart plots against dates, so round
  // numbers are mapped onto arbitrary consecutive days purely as an
  // x-axis -- the spacing is what matters, not the actual dates. Index 24
  // is the OT catch-all (see aggregateTeamBuckets), labeled accordingly.
  const roundCurve = useMemo(() => {
    if (!stats) return []
    const out = []
    for (let i = 0; i < 25; i++) {
      const played = stats.roundsPlayedByNum[i]
      if (!played) continue
      out.push({
        date: `2000-01-${String(i + 1).padStart(2, '0')}`,
        label: i === 24 ? 'OT' : `Round ${i + 1}`,
        value: stats.roundsWonByNum[i] / played,
        n: played,
      })
    }
    return out
  }, [stats])

  const ratingTrend = useMemo(() => {
    const byDate = new Map()
    for (const b of filtered) {
      if (!b.date || !b.ratR) continue
      const cur = byDate.get(b.date) || { s: 0, r: 0, maps: 0 }
      cur.s += b.ratS; cur.r += b.ratR; cur.maps += b.mapP || 0
      byDate.set(b.date, cur)
    }
    return [...byDate.entries()]
      .filter(([, v]) => v.r > 0)
      .map(([date, v]) => ({ date, value: v.s / v.r, n: v.maps }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filtered])

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
        enforceCurrentRoster={rosterIsCurrent}
        matches={teamMatches}
        headCoach={headCoach}
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
          {roundCurve.length > 0 && (
            <div className="bg-surface border border-hairline rounded-2xl p-5">
              <h3 className="font-display text-sm font-semibold text-ink mb-1">
                Round win% by round number
              </h3>
              <p className="text-muted text-xs mb-4">
                Rounds 1 and 13 are the pistols; OT rounds are lumped into one bucket since OT
                length varies map to map. Dashed line is 50%.
              </p>
              <TrendChart
                points={roundCurve}
                baseline={0.5}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          )}

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

          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-1">Rating over time</h3>
            <p className="text-muted text-xs mb-4">
              Team's average player rating per match day in scope. Dashed line is 1.00.
            </p>
            <TrendChart points={ratingTrend} baseline={1} format={(v) => v.toFixed(2)} />
          </div>

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
