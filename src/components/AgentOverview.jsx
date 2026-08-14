import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import { expandMatchRows, buildEventWeekDateSpans, attachEventWeekDateSpans } from '../lib/entityBuckets'
import DataTable from './DataTable'
import FilterPanel, { FACETS } from './FilterPanel'
import MapIcon from './MapIcon'
import { pct, num } from '../lib/format'


// Sums raw counts first and computes percentages last -- this is what makes
// arbitrary filter combinations correct, rather than averaging
// pre-computed percentages (which would weight a 10-round week the same as
// a 200-round one).
//
// Only mapStats/totalRows are used now -- agentCounts/mapAgentCounts (pick
// rate by agent) used to feed a "Pick rate by map" table here too, removed
// once the Agents page's own Agent impact tab (which already covers
// per-agent, per-map pick rate via its own Map selector, plus win rate,
// ATK/DEF splits, and full performance stats) made it fully redundant.
// agents.json's own agentCounts/mapAgentCounts fields are left in the
// export unchanged -- this is a frontend trim only, not a data-pipeline
// change, so nothing here forces a re-export.
function aggregate(buckets) {
  const mapStats = {}
  let totalRows = 0
  let totalAtkWinRounds = 0
  let totalDefWinRounds = 0

  for (const b of buckets) {
    totalRows += b.playerRows
    for (const [mapName, s] of Object.entries(b.mapStats)) {
      if (!mapStats[mapName]) mapStats[mapName] = { rounds: 0, atkWinRounds: 0, defWinRounds: 0 }
      mapStats[mapName].rounds += s.rounds
      mapStats[mapName].atkWinRounds += s.atkWinRounds
      mapStats[mapName].defWinRounds += s.defWinRounds
      totalAtkWinRounds += s.atkWinRounds
      totalDefWinRounds += s.defWinRounds
    }
  }

  // atkWinPct/defWinPct deliberately do NOT divide by s.rounds (the map's
  // total round count, including overtime). atkWinRounds/defWinRounds come
  // from the maps table's per-side header score, which is REGULATION-only
  // by construction, not by a data gap: VLR's own header publishes a THIRD,
  // separate number for OT round wins (a plain <span class="mod-ot">) with
  // no attack/defense split of its own, verified directly against a real OT
  // match page -- so OT isn't missing, it's just never side-attributed in
  // this source, the same deliberate tradeoff export_from_db.py's team-level
  // atk/def split already documents and has verified (atk+def == map score
  // exactly on every regulation map, 0 mismatches). Separately, a small set
  // of maps (mostly China) have no header breakdown published AT ALL --
  // that IS a genuine gap, and export_from_db.py fills those with 0 rather
  // than leaving them out of s.rounds. Dividing by s.rounds mixes both
  // cases into the denominator regardless of cause, which is why ATK WIN% +
  // DEF WIN% fell short of 100%. atkWinRounds + defWinRounds is precisely
  // the round count this source actually attributes to a side (whatever the
  // reason it doesn't cover the rest), so using that as the shared
  // denominator makes the two percentages complementary by construction --
  // the same "divide by what has the data, not by everything" pattern
  // multiKillsPerMap uses for its own China gap.
  const mapWinRates = Object.entries(mapStats)
    .map(([mapName, s]) => {
      const sideRounds = s.atkWinRounds + s.defWinRounds
      return {
        mapName,
        roundsPlayed: s.rounds,
        atkWinPct: sideRounds ? s.atkWinRounds / sideRounds : 0,
        defWinPct: sideRounds ? s.defWinRounds / sideRounds : 0,
      }
    })
    .sort((a, b) => b.roundsPlayed - a.roundsPlayed)

  const totalSideRounds = totalAtkWinRounds + totalDefWinRounds
  return {
    mapWinRates, totalRows,
    overallAtkWinPct: totalSideRounds ? totalAtkWinRounds / totalSideRounds : null,
    overallDefWinPct: totalSideRounds ? totalDefWinRounds / totalSideRounds : null,
  }
}



export default function AgentOverview() {
  const { data, loading } = useData('agents')
  const buckets = data?.buckets ?? []

  // agents.json carries no date field at all, so the DATE RANGE control
  // below silently filtered nothing -- match_results.json (already cheap,
  // 630KB, no idle-gating needed) shares the same event/week vocabulary
  // with a real per-match date, joined here the same way
  // buildPlayerDayGroups/attachDateSpans fixed the equivalent gap on
  // player_buckets-driven pages. See buildEventWeekDateSpans' own comment
  // in entityBuckets.js for why this stays span-only rather than the
  // per-row fingerprint match that file uses.
  const { data: matchData } = useData('match_results')
  const matchRows = useMemo(() => (matchData ? expandMatchRows(matchData) : []), [matchData])
  const eventWeekSpans = useMemo(() => buildEventWeekDateSpans(matchRows), [matchRows])
  const datedBuckets = useMemo(() => attachEventWeekDateSpans(buckets, eventWeekSpans), [buckets, eventWeekSpans])

  const { selections, setFacet, clearAll, filtered, options, activeCount,
          dateRange, setDateRange, dateBounds,
          includeHiddenEvents, setIncludeHiddenEvents } =
    useFacetedFilter(datedBuckets, FACETS, { competition: ['VCT'], year: [2026] })

  // Sorts the win-rate table's own map columns. Triggered by clicking the
  // ATK WIN / DEF WIN row label itself rather than a separate control --
  // sorting the two win-rate ROWS the normal DataTable way is barely useful
  // with only two rows, but sorting the map COLUMNS by one of those rows'
  // values (best attack map first, etc.) is the thing that's actually
  // useful here.
  const [mapSort, setMapSort] = useState({ key: null, dir: 'desc' })

  function toggleMapSort(key) {
    setMapSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  }

  const scoped = useMemo(() => aggregate(filtered), [filtered])

  // The matrix table used to always render every map in data.mapNames (the
  // site's full-season map pool), so a filter scope narrow enough to
  // exclude a map (one event, one week, etc.) still showed that map's
  // column full of "—" placeholders instead of just not showing it.
  // Restricting to maps actually present in the scoped aggregation makes
  // the table reflect only what's actually in scope.
  const winRateMapNames = useMemo(() => {
    if (!data) return []
    const inScope = new Set(scoped.mapWinRates.map((r) => r.mapName))
    return data.mapNames.filter((m) => inScope.has(m))
  }, [data, scoped])

  const orderedMapNames = useMemo(() => {
    if (!data) return []
    if (!mapSort.key) return winRateMapNames
    const statKey = mapSort.key === 'atkWin' ? 'atkWinPct' : 'defWinPct'
    const rates = Object.fromEntries(scoped.mapWinRates.map((m) => [m.mapName, m[statKey]]))
    const sorted = [...winRateMapNames].sort((a, b) => (rates[b] ?? -1) - (rates[a] ?? -1))
    return mapSort.dir === 'asc' ? sorted.reverse() : sorted
  }, [data, scoped, mapSort, winRateMapNames])

  // Two small rows (ATK WIN, DEF WIN) shaped exactly like a matrix row --
  // an "Overall" value plus one value per map.
  const winRateRows = useMemo(() => {
    const { mapWinRates, overallAtkWinPct, overallDefWinPct } = scoped
    if (!data) return []

    const atkRow = { rowType: 'atkWin', label: 'ATK WIN', overall: overallAtkWinPct }
    const defRow = { rowType: 'defWin', label: 'DEF WIN', overall: overallDefWinPct }
    for (const m of mapWinRates) {
      atkRow[m.mapName] = m.atkWinPct
      defRow[m.mapName] = m.defWinPct
    }

    return [atkRow, defRow]
  }, [scoped, data])

  // Narrow enough that all 12 maps plus the label/Overall columns fit
  // inside the site's 1160px content column without a horizontal
  // scrollbar -- there's plenty of room at this width for a percentage
  // ("100.0%") at the table's own (vlr.gg-matched) 12px font.
  const mapColumnWidth = 78

  if (loading || !data) {
    return <div className="text-muted text-sm">Loading…</div>
  }

  const labelColumn = {
    key: 'label', label: '', align: 'left', noPadding: true,
    format: (v, row) => {
      // The label itself is the sort trigger for the table's own map
      // COLUMNS (see mapSort above).
      const active = mapSort.key === row.rowType
      return (
        <button
          onClick={() => toggleMapSort(row.rowType)}
          className={`w-full flex items-center gap-1 px-3 py-1.5 text-left text-[10px] font-semibold cursor-pointer select-none transition-colors ${
            active ? 'text-accent' : 'text-ink hover:text-accent-bright'
          }`}
        >
          {v}
          <span className={`inline-block w-2.5 text-[10px] leading-none text-accent ${active ? '' : 'invisible'}`}>
            {mapSort.dir === 'asc' ? '▲' : '▼'}
          </span>
        </button>
      )
    },
  }

  // Win rates get the green/red diverging scale (a real, fixed 50% neutral
  // point -- "favored" vs. "unfavored" should mean the same shade on every
  // view).
  const winRateColumns = [
    labelColumn,
    { key: 'overall', label: 'Overall', align: 'right', colorScale: true, diverging: true, format: (v) => (v == null ? '—' : pct(v, 1)) },
    ...orderedMapNames.map((m) => ({
      key: m,
      label: (
        <span className="flex items-center gap-1.5">
          <MapIcon map={m} width={28} />
          {m}
        </span>
      ),
      align: 'right', colorScale: true, diverging: true, width: mapColumnWidth,
      format: (v) => (v === null || v === undefined ? '—' : pct(v, 1)),
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        dateRange={dateRange} setDateRange={setDateRange} dateBounds={dateBounds}
        includeHiddenEvents={includeHiddenEvents} setIncludeHiddenEvents={setIncludeHiddenEvents}
        summary={`${num(scoped.totalRows / 5)} team-maps in scope`}
      />

      {scoped.totalRows === 0 ? (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">No matches found for this filter combination.</p>
          <button onClick={clearAll} className="text-accent-bright text-sm hover:underline mt-2">
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-sm font-semibold text-ink">Map win rates (attack vs. defense)</h3>
          <p className="text-muted text-xs">
            Round-weighted, not a naive average across buckets. Reflects the filters above. Click
            ATK WIN or DEF WIN to sort maps by that rate. For per-agent pick rate and
            performance on each map, see the Agent impact tab above; for most-played
            compositions, see the{' '}
            <Link to="/compositions" className="text-accent-bright hover:underline">Compositions</Link> page.
          </p>
          <DataTable columns={winRateColumns} rows={winRateRows} />
        </div>
      )}
    </div>
  )
}
