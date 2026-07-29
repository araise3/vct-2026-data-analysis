import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateAgentBuckets, teamInScope,
  expandMatchRows, groupMatchPlayers,
} from '../lib/entityBuckets'
import TrendChart from '../components/TrendChart'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import KpiCard from '../components/KpiCard'
import DataTable from '../components/DataTable'
import MatchHistory from '../components/MatchHistory'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import AgentIcon from '../components/AgentIcon'
import { rating, pct, num } from '../lib/format'

export default function PlayerProfile() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)
  const { data, loading } = useData('player_buckets')
  const { data: agentData } = useData('player_agents')
  const { data: matchData } = useData('match_results')
  const { data: matchPlayerData } = useData('match_players')
  const [ratedOnly, setRatedOnly] = useState(false)

  // Scope to this player first, so the facet options only ever show
  // events/weeks this player actually appeared in.
  const records = useMemo(() => {
    if (!data) return []
    return expandBuckets(data, 'p').filter((r) => r.id === decodedName)
  }, [data, decodedName])

  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  // Default the standard scope to the player's most recent event rather
  // than every event they've ever played -- applied once, after this
  // player's own records are actually available (they're empty on the
  // very first render, before player_buckets.json resolves), so it can't
  // fight a user who's already changed the Event filter. Derived from
  // `filtered`, not the raw per-player `records`, so "most recent" respects
  // the page's other active defaults (Competition: VCT) instead of picking
  // e.g. an EWC event that the VCT filter would then immediately conflict
  // with and zero out. `e` (event id) increases roughly chronologically,
  // same assumption teamInScope already relies on for "which team is
  // newest".
  const appliedDefaultEvent = useRef(false)
  useEffect(() => {
    if (appliedDefaultEvent.current || filtered.length === 0) return
    appliedDefaultEvent.current = true
    let maxE = -Infinity
    let latestEvent = null
    for (const r of filtered) {
      if (r.e > maxE) { maxE = r.e; latestEvent = r.event }
    }
    if (latestEvent) setFacet('event', [latestEvent])
  }, [filtered, setFacet])

  const stats = useMemo(
    () => aggregatePlayerBuckets(filtered, { ratedOnly }),
    [filtered, ratedOnly]
  )

  // Per-agent breakdown, filtered by the same active facet selections as
  // the rest of the page. player_agents.json is a deliberately lean
  // schema (see export_from_db.py) -- only maps/rounds/rating/ACS/kills/
  // deaths are tracked per (player, agent, event, week), so KAST/ADR/HS%/
  // multi-kills/econ aren't available broken out by agent the way they
  // are on the Players table.
  const agentRecords = useMemo(
    () => (agentData ? expandBuckets(agentData, 'p').filter((r) => r.id === decodedName) : []),
    [agentData, decodedName]
  )
  const agentRows = useMemo(() => {
    const inScope = agentRecords.filter((r) => matchesFilters(r, FACETS, selections, dateRange))
    const grouped = new Map()
    for (const r of inScope) {
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
  }, [agentRecords, selections, dateRange])

  // Match history. The scoreboard rows carry no event/week of their own,
  // so the filtering happens on the match records (which expandMatchRows
  // gives the same facet fields as every bucket record) and the scoreboard
  // map is a pure lookup keyed by match id.
  const playersByMatch = useMemo(() => groupMatchPlayers(matchPlayerData), [matchPlayerData])
  const matchRows = useMemo(() => {
    if (!matchData || !matchPlayerData) return []
    // Which matches this player actually appeared in -- derived from the
    // scoreboard rows rather than from their buckets, so a match can only
    // list here if there's a box score behind it.
    const mine = new Set()
    for (const r of matchPlayerData.rows) if (r.p === decodedName) mine.add(r.m)
    return expandMatchRows(matchData).filter(
      (m) => mine.has(m.id) && matchesFilters(m, FACETS, selections, dateRange)
    )
  }, [matchData, matchPlayerData, decodedName, selections, dateRange])

  // Rating over time: one point per day the player actually played,
  // rounds-weighted within the day so a 3-map day isn't averaged flat
  // against a 1-map day.
  //
  // This MUST stay above the early returns below, not after them. It
  // used to sit after `if (loading) return` / `if (!meta) return`, which
  // is a Rules-of-Hooks violation: on a cold data cache, the first render
  // has loading=true and bails out before ever calling this hook; once
  // the fetch resolves, the same component instance re-renders with
  // loading=false and DOES call it -- a different hook count between two
  // renders of the same instance, which React throws on. With no error
  // boundary anywhere in the tree, that throw unmounts the entire app,
  // which is what showed up as the whole page going blank/dark. It only
  // reproduced when player_buckets.json hadn't already been fetched in
  // that tab (a fresh tab, a direct link, anywhere that lands on a
  // profile without having hit /players first) -- once cached, loading
  // is false from the very first render and the mismatch never occurs,
  // which is why "it's fine after a refresh" once the data's warm looked
  // like a fix rather than a race that happened not to trigger.
  const trend = useMemo(() => {
    const byDate = new Map()
    for (const b of filtered) {
      if (!b.date || !b.ratR) continue
      const cur = byDate.get(b.date) || { s: 0, r: 0, maps: 0 }
      cur.s += b.ratS; cur.r += b.ratR; cur.maps += b.maps
      byDate.set(b.date, cur)
    }
    return [...byDate.entries()]
      .filter(([, v]) => v.r > 0)
      .map(([date, v]) => ({ date, value: v.s / v.r, n: v.maps }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filtered])

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  const meta = data?.meta?.[decodedName]
  const displayTeam = meta ? teamInScope(filtered, meta.team) : null

  const agentColumns = [
    {
      key: 'agent', label: 'Agent', align: 'left', noPadding: true,
      format: (v) => (
        <span className="flex items-center gap-2 px-5 py-2.5">
          <AgentIcon agent={v} size={24} />
          <span className="font-body font-medium">{v}</span>
        </span>
      ),
    },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'Rounds', align: 'right', format: (v) => num(v) },
    { key: 'avgRating', label: 'R', align: 'right', colorScale: true, format: (v) => rating(v) },
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
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-2xl font-semibold text-ink">{decodedName}</h1>
          <Link
            to={`/teams/${encodeURIComponent(displayTeam)}`}
            className="text-muted text-sm hover:text-accent-bright w-fit"
          >
            <TeamLogo team={displayTeam} size={22} />
          </Link>
        </div>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
      >
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={ratedOnly}
            onChange={(e) => setRatedOnly(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          Only maps with a Rating 2.0
        </label>
      </FilterPanel>

      {agentRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-sm font-semibold text-ink">Agents</h3>
          <p className="text-muted text-xs">
            Per-agent breakdown for the current scope, same columns as the Players table minus
            Kills/Deaths/Ace/Econ.
          </p>
          <DataTable columns={agentColumns} rows={agentRows} defaultSortKey="mapsPlayed" />
        </div>
      )}

      {!stats ? (
        <div className="bg-surface border border-hairline rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">No maps in this scope.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Maps Played" value={num(stats.mapsPlayed)} />
            <KpiCard label="Rounds Played" value={num(stats.roundsPlayed)} />
            <KpiCard label="Avg Rating" value={rating(stats.avgRating)} />
            <KpiCard label="Avg ACS" value={num(stats.avgAcs, 0)} />
            <KpiCard label="K/D" value={stats.kd ? stats.kd.toFixed(2) : '—'} />
            <KpiCard label="Avg KAST" value={pct(stats.avgKast)} />
            <KpiCard label="Avg ADR" value={num(stats.avgAdr, 0)} />
            <KpiCard label="Avg HS%" value={pct(stats.avgHsPct)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Consistency (rating SD)"
              value={stats.ratingSd == null ? '—' : stats.ratingSd.toFixed(3)}
            />
            <KpiCard label="Avg Econ" value={stats.utilMaps ? num(stats.avgEcon, 0) : '—'} />
            <KpiCard label="Plants" value={stats.utilMaps ? num(stats.totalPlants) : '—'} />
            <KpiCard label="Defuses" value={stats.utilMaps ? num(stats.totalDefuses) : '—'} />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-ink mb-1">Rating over time</h3>
            <p className="text-muted text-xs mb-4">
              One point per match day in scope, rounds-weighted within the day. Dashed line is
              the 1.00 baseline.
            </p>
            <TrendChart points={trend} baseline={1} format={(v) => v.toFixed(2)} />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-5">
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
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">Match history</h3>
            <p className="text-muted text-xs">
              {decodedName}'s line in every match in scope — click a row for the full scoreboard.
            </p>
            <MatchHistory
              matches={matchRows}
              playersByMatch={playersByMatch}
              perspective={{ type: 'player', name: decodedName }}
            />
          </div>

          {meta.isChina && (
            <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
              China-region matches don't publish multi-kill, clutch, or economy data on VLR, so those
              totals read 0 here unless this player also competed internationally — filter to
              Region: International above to see their complete numbers.
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
