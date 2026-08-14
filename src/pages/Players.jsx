import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData, useIdle } from '../lib/useData'
import { useFacetedFilter, matchesFilters } from '../lib/useFacetedFilter'
import {
  expandBuckets, aggregatePlayerBuckets, aggregateSideBuckets, groupByEntity, teamInScope,
  buildPlayerDayGroups, attachDateSpans,
} from '../lib/entityBuckets'
import DataTable from '../components/DataTable'
import FilterPanel, { FACETS } from '../components/FilterPanel'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import AgentIcon from '../components/AgentIcon'
import Select from '../components/ui/Select'
import { rating, pct, num } from '../lib/format'

export default function Players() {
  const [ratedOnly, setRatedOnly] = useState(false)
  const [minRounds, setMinRounds] = useState(0)
  const [side, setSide] = useState('both') // 'both' | 't' (attack) | 'ct' (defend)
  const [agent, setAgent] = useState('')
  const [country, setCountry] = useState('')

  // This page used to fetch all three of these on mount -- 14.1MB of JSON
  // (3.9 + 4.7 + 5.5) parsed on the main thread before the table it renders
  // by default needs any of the last two:
  //   - player_sides feeds ONLY the Attack/Defend toggle, so it's fetched
  //     when the toggle actually leaves 'both'. Nothing on the default view
  //     reads it, not even to build a control's options.
  //   - player_agents is needed sooner than "when an agent is picked",
  //     because the Agent dropdown's option list is derived from it (the
  //     agents actually present in the data, rather than a hardcoded list
  //     that would silently miss the next agent release). So it loads on
  //     idle instead of not at all -- off the critical path, but there well
  //     before anyone opens the dropdown.
  const idle = useIdle()
  const { data, loading } = useData('player_buckets')
  const { data: sideData } = useData(side === 'both' ? null : 'player_sides')
  const { data: agentData } = useData(idle ? 'player_agents' : null)

  const records = useMemo(() => (data ? expandBuckets(data, 'p') : []), [data])

  // player_buckets has no per-day date at all (see buildPlayerDayGroups'
  // own comment in entityBuckets.js), so the DATE RANGE control below
  // looked live but silently filtered nothing. player_agents.json -- the
  // same file already idle-loaded above for the Agent dropdown -- shares
  // the same (player, event, week) key at a finer per-agent grain with a
  // real date, so each row is matched to the exact day(s) its own maps
  // were played on via a stat fingerprint (not just its key's overall
  // date range -- see buildPlayerDayGroups for why that distinction is
  // load-bearing). Before agentData has loaded (or for the small,
  // documented set of player-maps with no agent recorded at all), this is
  // a no-op -- records fall back to their prior no-date-info pass-through,
  // same as before this fix -- and starts working the moment the idle
  // fetch lands.
  const dayGroups = useMemo(
    () => (agentData ? buildPlayerDayGroups(agentData.buckets) : new Map()),
    [agentData]
  )
  const datedRecords = useMemo(() => attachDateSpans(records, dayGroups), [records, dayGroups])

  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds,
          includeHiddenEvents, setIncludeHiddenEvents } =
    useFacetedFilter(datedRecords, FACETS, { competition: ['VCT'], year: [2026] })

  // player_agents.json is the same bucket shape as player_buckets but keyed
  // by player+agent, so it can't just join the FACETS list (a player's own
  // bucket has no single "agent" field -- they play several). Instead it's
  // filtered separately, with the same active selections, down to the set
  // of players who played the chosen agent at all in scope.
  const agentRecords = useMemo(() => (agentData ? expandBuckets(agentData, 'p') : []), [agentData])
  const agentNames = useMemo(
    () => [...new Set(agentRecords.map((r) => r.ag))].sort(),
    [agentRecords]
  )
  const playersWithAgent = useMemo(() => {
    if (!agent) return null
    const set = new Set()
    for (const r of agentRecords) {
      if (r.ag !== agent) continue
      if (!matchesFilters(r, FACETS, selections, dateRange, includeHiddenEvents)) continue
      set.add(r.p)
    }
    return set
  }, [agentRecords, agent, selections, dateRange, includeHiddenEvents])

  // Nationality, unlike agent, is static per player -- no separate bucket
  // dataset or scope-matching needed, just the same meta.countryName every
  // other column already reads. Keeps a name -> code map alongside the
  // sorted name list so the Country Select can render each option's flag
  // (Flag itself is keyed by ISO code, not the display name).
  const countryCodeByName = useMemo(() => {
    const map = new Map()
    if (!data) return map
    for (const player in data.meta) {
      const m = data.meta[player]
      if (m?.countryName && !map.has(m.countryName)) map.set(m.countryName, m.countryCode)
    }
    return map
  }, [data])
  const countryNames = useMemo(
    () => [...countryCodeByName.keys()].sort(),
    [countryCodeByName]
  )

  // player_sides.json mirrors VLR's own All/Attack/Defend toggle -- a
  // separate, lighter file (just the headline stats) rather than tripling
  // player_buckets.json. Filtered by the SAME active selections as the
  // main table so switching side never changes which players/events are
  // in scope, only which numbers are shown for them.
  //
  // Because that file is now fetched on demand rather than up front, there's
  // a window where a side is selected but its data hasn't landed. Every row
  // would render as "—" across the headline columns in that window (the
  // no-side-data branch below), which looks like broken data rather than a
  // pending fetch -- so the table is swapped for a one-line loading state
  // instead. It's once per session; useData caches the parsed file.
  const sideLoading = side !== 'both' && !sideData
  const sideRecords = useMemo(() => (sideData ? expandBuckets(sideData, 'p') : []), [sideData])
  const sideStatsByPlayer = useMemo(() => {
    if (side === 'both') return null
    const byPlayer = new Map()
    for (const r of sideRecords) {
      if (r.s !== side) continue
      if (!matchesFilters(r, FACETS, selections, dateRange, includeHiddenEvents)) continue
      if (!byPlayer.has(r.p)) byPlayer.set(r.p, [])
      byPlayer.get(r.p).push(r)
    }
    const out = new Map()
    for (const [player, buckets] of byPlayer) {
      out.set(player, aggregateSideBuckets(buckets))
    }
    return out
  }, [sideRecords, selections, dateRange, side, includeHiddenEvents])

  // One row per player in scope, fully aggregated. Deliberately does NOT
  // apply the min-rounds / agent / country filters: those are per-row
  // predicates over an already-built row (see `rows` below), and folding
  // them in here meant every change re-ran groupByEntity plus a full
  // aggregatePlayerBuckets pass over every player in scope to produce rows
  // it was about to discard anyway. This memo now only re-runs when
  // something that genuinely changes a player's NUMBERS changes -- the
  // facet scope, the rated-only toggle, or the side toggle.
  const allRows = useMemo(() => {
    if (!data) return []
    const grouped = groupByEntity(filtered)
    const out = []
    for (const [player, buckets] of grouped) {
      const meta = data.meta[player]
      if (!meta) continue
      const s = aggregatePlayerBuckets(buckets, { ratedOnly })
      if (!s || !s.mapsPlayed) continue

      // Side toggle swaps the headline stats (Rating/ACS/K:D/KAST/ADR/HS%/
      // Kills/Deaths/Assists/FK/FD) AND Rounds -- roundsPlayed now reflects
      // rounds actually played on that side (export_from_db.py derives it
      // from each map's real atk/def round split, not the map's whole
      // round total duplicated onto both sides). Maps/Clutches/utility
      // still stay from the 'both' aggregate: maps played is genuinely
      // side-invariant, and clutches/utility simply aren't captured per
      // side in the source data at all.
      const sideStats = side !== 'both' ? sideStatsByPlayer?.get(player) : null

      const row = {
        player,
        team: teamInScope(buckets, meta.team),
        region: meta.region,
        isChina: meta.isChina,
        countryCode: meta.countryCode,
        countryName: meta.countryName,
        ...s,
        ...(sideStats
          ? {
              roundsPlayed: sideStats.roundsPlayed,
              avgRating: sideStats.avgRating,
              avgAcs: sideStats.avgAcs,
              kd: sideStats.kd,
              avgKast: sideStats.avgKast,
              avgAdr: sideStats.avgAdr,
              avgHsPct: sideStats.avgHsPct,
              totalKills: sideStats.totalKills,
              totalDeaths: sideStats.totalDeaths,
              totalAssists: sideStats.totalAssists,
              totalFirstKills: sideStats.totalFirstKills,
              totalFirstDeaths: sideStats.totalFirstDeaths,
            }
          : side !== 'both'
            ? // No side data at all for this player in scope. Rare, and
              // NOT a China-wide thing -- 86% of China player-maps have a
              // real split. It happens when every map in scope is one of
              // the 42 (of 1091) whose t/ct rows the export drops for
              // carrying the map total on BOTH sides rather than a genuine
              // split (see the "non-partitioning t/ct" filter in
              // export_from_db.py -- left in, they double-counted those
              // players' kills under this toggle). Null out rather than
              // show stale 'both' numbers under an Attack/Defend heading.
              {
                roundsPlayed: null,
                avgRating: null, avgAcs: null, kd: null, avgKast: null, avgAdr: null,
                avgHsPct: null, totalKills: null, totalDeaths: null, totalAssists: null,
                totalFirstKills: null, totalFirstDeaths: null,
              }
            : {}),
      }

      // Per-round rates, computed after the side-toggle swap above so both
      // the numerator (kills/FK/FD/assists) and the denominator
      // (roundsPlayed) track whichever side is actually showing -- a real
      // "kills per round played on attack" once the toggle is active, not
      // side-specific kills divided by the full both-sides round count.
      // The numerator (and now the denominator too) is null'd out along
      // with the rest when there's no side data for this player, and null
      // propagates.
      const rp = row.roundsPlayed
      row.kpr = rp && row.totalKills != null ? row.totalKills / rp : null
      row.fkpr = rp && row.totalFirstKills != null ? row.totalFirstKills / rp : null
      row.fdpr = rp && row.totalFirstDeaths != null ? row.totalFirstDeaths / rp : null
      row.apr = rp && row.totalAssists != null ? row.totalAssists / rp : null

      out.push(row)
    }
    return out.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
  }, [filtered, data, ratedOnly, side, sideStatsByPlayer])

  // The cheap per-row filters, applied to the already-aggregated rows. All
  // four are plain predicates on a finished row, so a keystroke or a
  // min-rounds bump costs one pass over ~430 objects instead of a full
  // re-aggregation. Sort order is inherited from allRows -- a filter only
  // ever removes rows, never reorders them.
  const rows = useMemo(() => {
    return allRows.filter((p) => {
      if (playersWithAgent && !playersWithAgent.has(p.player)) return false
      if (country && p.countryName !== country) return false
      if (p.roundsPlayed < minRounds) return false
      return true
    })
  }, [allRows, playersWithAgent, country, minRounds])

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  const columns = [
    {
      key: 'player', label: 'Player', align: 'left',
      format: (v, row) => (
        <div className="flex items-center gap-2">
          <Flag countryCode={row.countryCode} countryName={row.countryName} size={16} />
          <Link
            to={`/players/${encodeURIComponent(v)}`}
            className="font-body font-medium hover:text-accent-bright transition-colors"
          >
            {v}
          </Link>
        </div>
      ),
    },
    {
      key: 'team', label: 'Team', align: 'left',
      format: (v) => (
        <Link to={`/teams/${encodeURIComponent(v)}`} className="hover:text-accent-bright transition-colors">
          <TeamLogo team={v} size={22} showName={false} showTag />
        </Link>
      ),
    },
    { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
    { key: 'roundsPlayed', label: 'RND', align: 'right', format: (v) => num(v) },
    // Widened by exactly what Econ below gives up, rather than each sizing
    // independently -- Rating is the headline stat here and Econ's own
    // label/data need far less room.
    { key: 'avgRating', label: 'R', align: 'right', colorScale: true, width: 73, format: (v) => rating(v) },
    { key: 'avgAcs', label: 'ACS', align: 'right', colorScale: true, format: (v) => num(v, 0) },
    { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v ? v.toFixed(2) : '—') },
    { key: 'avgKast', label: 'KAST', align: 'right', colorScale: true, format: (v) => pct(v) },
    { key: 'avgAdr', label: 'ADR', align: 'right', colorScale: true, format: (v) => num(v, 1) },
    // VLR's own per-round block order is KPR, APR, FKPR, FDPR -- matched
    // here rather than the FKPR/FDPR/APR grouping this originally shipped
    // with.
    { key: 'kpr', label: 'KPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'apr', label: 'APR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'fkpr', label: 'FKPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    // Lower is better (fewer first deaths per round), so the color scale is inverted.
    { key: 'fdpr', label: 'FDPR', align: 'right', colorScale: true, colorInvert: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
    { key: 'avgHsPct', label: 'HS%', align: 'right', colorScale: true, format: (v) => pct(v) },
    // Econ isn't a VLR column -- it's ours, placed right after the VLR
    // block rather than mixed into it.
    { key: 'avgEcon', label: 'Econ', align: 'right', colorScale: true, width: 55, format: (v, r) => (r.utilMaps ? Math.round(v) : '—') },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Players</h1>
        <p className="text-muted text-sm mt-1">{rows.length} players shown</p>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        summary={`${rows.length} players`}
      >
        <div className="flex items-center gap-5 flex-wrap pt-1">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={ratedOnly}
              onChange={(e) => setRatedOnly(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            Only maps with a Rating 2.0
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Min. rounds
            <input
              type="number"
              min={0}
              value={minRounds}
              onChange={(e) => setMinRounds(Number(e.target.value) || 0)}
              className="bg-surface2 border border-hairline rounded-lg px-2 py-1 w-20 text-ink focus:outline-none focus:border-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-muted">
            Side
            <div className="flex rounded-lg overflow-hidden border border-hairline shadow-depth-xs">
              {[
                { key: 'both', label: 'All' },
                { key: 't', label: 'Attack' },
                { key: 'ct', label: 'Defend' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSide(opt.key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    side === opt.key ? 'bg-grad-selected text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15)]' : 'bg-surface2 text-muted hover:text-ink hover:bg-surface3'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            Agent
            <Select
              value={agent}
              onChange={setAgent}
              placeholder="All agents"
              options={agentNames}
              renderIcon={(a) => <AgentIcon agent={a} size={16} />}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Country
            <Select
              value={country}
              onChange={setCountry}
              placeholder="All countries"
              options={countryNames}
              renderIcon={(c) => <Flag countryCode={countryCodeByName.get(c)} countryName={c} size={14} />}
            />
          </label>
        </div>
      </FilterPanel>

      <div className="bg-surface2/40 border border-hairline rounded-xl px-4 py-3 text-xs text-muted leading-relaxed">
        China-region matches don't publish multi-kill, clutch, or economy data on VLR, so those
        columns read 0 for China players. A small number of China maps are also missing Rating 2.0 —
        by default they still count toward other stats, which can make a rating average cover fewer
        maps than the rest of the row; "Only maps with a Rating 2.0" makes every stat consistent.
      </div>

      {sideLoading ? (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">Loading attack/defend splits…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">No players match this filter combination.</p>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} defaultSortKey="avgRating" />
      )}
    </div>
  )
}
