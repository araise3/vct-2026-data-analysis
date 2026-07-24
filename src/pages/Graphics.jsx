import { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react'
import { toPng } from 'html-to-image'
import { useData } from '../lib/useData'
import { useFacetedFilter } from '../lib/useFacetedFilter'
import {
  expandBuckets,
  expandSeriesRows,
  aggregatePlayerBuckets,
  aggregateTeamBuckets,
  groupByEntity,
} from '../lib/entityBuckets'
import { PLAYER_STATS, TEAM_STATS, SERIES_STATS, teamTierExtras } from '../lib/statDefs'
import FilterPanel, { FACETS, FACET_LABELS, FACET_RENDERERS } from '../components/FilterPanel'
import StatCard, { CARD_W } from '../components/StatCard'

/**
 * Graphics -- an exportable-infographic builder.
 *
 * Pick players, teams, or series (match-level duration leaderboard),
 * pick a stat, filter with the same faceted panel as everywhere else,
 * then tune sample-size thresholds (min rounds / min maps, or top-N for
 * series) with live preview. Export renders the exact preview tree to a
 * PNG at 2x via html-to-image.
 */

const labeled = 'text-[11px] uppercase tracking-wide font-medium text-muted'
const inputCls =
  'bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-muted'

const ENTITY_DEFAULT_TOP_N = { players: 10, teams: 10, series: 5 }

export default function Graphics() {
  const [entity, setEntity] = useState('players')
  const isPlayers = entity === 'players'
  const isTeams = entity === 'teams'
  const isSeries = entity === 'series'

  const { data: playerData, loading: pl } = useData('player_buckets')
  const { data: teamData, loading: tl } = useData('team_buckets')
  const { data: seriesData, loading: sel } = useData('series_length')
  const data = isPlayers ? playerData : isTeams ? teamData : seriesData
  const loading = isPlayers ? pl : isTeams ? tl : sel

  const statDefs = isPlayers ? PLAYER_STATS : isTeams ? TEAM_STATS : SERIES_STATS
  const [statKey, setStatKey] = useState(PLAYER_STATS[0].key)
  const stat = statDefs.find((s) => s.key === statKey) || statDefs[0]

  const [minRounds, setMinRounds] = useState(200)
  const [minMaps, setMinMaps] = useState(10)
  const [topN, setTopN] = useState(10)
  const [bottom, setBottom] = useState(false)
  const [ratedOnly, setRatedOnly] = useState(false)
  const [titleOverride, setTitleOverride] = useState('')
  const [subtitleOverride, setSubtitleOverride] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  const records = useMemo(() => {
    if (!data) return []
    if (isSeries) return expandSeriesRows(data)
    return expandBuckets(data, isPlayers ? 'p' : 't')
  }, [data, isPlayers, isSeries])
  const { selections, setFacet, clearAll, filtered, options, activeCount } =
    useFacetedFilter(records, FACETS, { competition: ['VCT'] })

  const rows = useMemo(() => {
    if (!data) return []

    if (isSeries) {
      // Only matches where every map has a scraped duration are ranked --
      // a partial sum would understate a match's real length and could
      // wrongly surface as "shortest".
      const eligible = filtered.filter((r) => r.fullyTimed)
      const out = eligible.map((r) => ({
        id: r.id,
        name: `${r.team1} vs ${r.team2}`,
        team: r.team1,
        team2: r.team2,
        value: r.durationSeconds,
        secondary: { value: r.mapCount, label: r.mapCount === 1 ? 'map' : 'maps' },
      }))
      out.sort((a, b) => (bottom ? a.value - b.value : b.value - a.value))
      return out.slice(0, topN)
    }

    const grouped = groupByEntity(filtered)
    const out = []
    for (const [id, buckets] of grouped) {
      const meta = data.meta[id]
      const agg = isPlayers
        ? aggregatePlayerBuckets(buckets, { ratedOnly })
        : { ...aggregateTeamBuckets(buckets), ...teamTierExtras(buckets) }
      if (!agg) continue
      if ((agg.roundsPlayed ?? agg.tierRounds ?? 0) < minRounds) continue
      if ((agg.mapsPlayed ?? 0) < minMaps) continue
      const value = stat.compute(agg)
      if (value === null || value === undefined || Number.isNaN(value)) continue
      out.push({
        name: id,
        team: isPlayers ? meta?.team : id,
        countryCode: isPlayers ? meta?.countryCode : null,
        countryName: isPlayers ? meta?.countryName : null,
        value,
        secondary: stat.secondary(agg),
      })
    }
    const higher = stat.higherIsBetter !== false
    const desc = higher !== bottom
    out.sort((a, b) => (desc ? b.value - a.value : a.value - b.value))
    return out.slice(0, topN)
  }, [filtered, data, isPlayers, isSeries, ratedOnly, minRounds, minMaps, stat, topN, bottom])

  // Auto title / subtitle from current settings; overridable.
  const autoTitle = isSeries
    ? `${bottom ? 'SHORTEST' : 'LONGEST'} SERIES`
    : `${isPlayers ? 'PLAYERS' : 'TEAMS'} ${stat.cardTitle}`
  const autoSubtitle = useMemo(() => {
    const bits = []
    if (isSeries) {
      bits.push('fully-timed matches only')
    } else {
      if (minRounds > 0) bits.push(`${minRounds}+ rounds`)
      if (minMaps > 0) bits.push(`${minMaps}+ maps`)
    }
    for (const f of FACETS) {
      const sel = selections[f] || []
      if (!sel.length || (f === 'competition' && sel.length === 1 && sel[0] === 'VCT'))
        continue
      const render = FACET_RENDERERS[f] || ((x) => x)
      bits.push(
        sel.length <= 2 ? sel.map(render).join(' + ') : `${sel.length} ${FACET_LABELS[f].toLowerCase()}`
      )
    }
    if (!isSeries && bottom) bits.push('bottom ' + topN)
    return bits.length ? `(${bits.join(', ').toUpperCase()})` : ''
  }, [selections, minRounds, minMaps, bottom, topN, isSeries])

  const title = titleOverride.trim() || autoTitle
  const subtitle = subtitleOverride.trim() || autoSubtitle

  // Scale the fixed-width card down to fit the preview column. CSS
  // transform doesn't affect layout, so the wrapper's height has to be
  // reserved manually from the card's measured height.
  const previewRef = useRef(null)
  const cardRef = useRef(null)
  const [scale, setScale] = useState(0.6)
  const [cardH, setCardH] = useState(0)
  useLayoutEffect(() => {
    const outer = previewRef.current
    const card = cardRef.current
    if (!outer || !card) return
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, outer.clientWidth / CARD_W))
      setCardH(card.offsetHeight)
    })
    ro.observe(outer)
    ro.observe(card)
    return () => ro.disconnect()
  }, [])

  const exportPng = useCallback(async () => {
    if (!cardRef.current) return
    setExporting(true)
    setExportError(null)
    try {
      // Two passes: html-to-image occasionally misses images that finish
      // decoding mid-serialize; the second pass hits its internal cache.
      await toPng(cardRef.current, { pixelRatio: 2, cacheBust: false })
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: false })
      const a = document.createElement('a')
      const statSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      a.download = `vct-2026-${entity}-${statSlug}.png`
      a.href = url
      a.click()
    } catch (err) {
      console.error(err)
      setExportError('Export failed — an image host may be blocking the snapshot. Try again.')
    } finally {
      setExporting(false)
    }
  }, [entity, title])

  if (loading || !data) return <div className="text-muted text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Graphics</h1>
        <p className="text-muted text-sm mt-1">
          Build and export shareable stat cards — pick a stat, filter the sample, download a PNG.
        </p>
      </div>

      <FilterPanel
        options={options}
        selections={selections}
        setFacet={setFacet}
        clearAll={clearAll}
        activeCount={activeCount}
        summary={`${rows.length} rows on card`}
        defaultOpen={false}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6 items-start">
        {/* controls */}
        <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-5 xl:sticky xl:top-6">
          <div className="flex flex-col gap-1.5">
            <span className={labeled}>Entity</span>
            <div className="flex rounded-lg overflow-hidden border border-hairline w-fit">
              {['players', 'teams', 'series'].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEntity(e)
                    const defs = e === 'players' ? PLAYER_STATS : e === 'teams' ? TEAM_STATS : SERIES_STATS
                    setStatKey(defs[0].key)
                    setTopN(ENTITY_DEFAULT_TOP_N[e])
                  }}
                  className={`px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                    entity === e ? 'bg-accent text-white' : 'bg-surface2 text-muted hover:text-ink'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {!isSeries && (
            <div className="flex flex-col gap-1.5">
              <span className={labeled}>Statistic</span>
              <select
                value={stat.key}
                onChange={(e) => setStatKey(e.target.value)}
                className={inputCls}
              >
                {statDefs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isSeries && (
            <>
              <RangeControl
                label={`Minimum rounds — ${minRounds}`}
                value={minRounds}
                onChange={setMinRounds}
                min={0}
                max={1500}
                step={25}
              />
              <RangeControl
                label={`Minimum maps — ${minMaps}`}
                value={minMaps}
                onChange={setMinMaps}
                min={0}
                max={100}
                step={1}
              />
            </>
          )}
          <RangeControl
            label={`Entries — top ${topN}`}
            value={topN}
            onChange={setTopN}
            min={3}
            max={15}
            step={1}
          />

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={bottom}
                onChange={(e) => setBottom(e.target.checked)}
                className="accent-[#FF4655]"
              />
              {isSeries ? 'Show shortest instead of longest' : 'Show bottom instead of top'}
            </label>
            {isPlayers && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={ratedOnly}
                  onChange={(e) => setRatedOnly(e.target.checked)}
                  className="accent-[#FF4655]"
                />
                Rated maps only
              </label>
            )}
            {isSeries && (
              <p className="text-muted text-xs leading-relaxed">
                Only matches where every map has a scraped duration are ranked — a partial
                match wouldn't give a true series length.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={labeled}>Title override</span>
            <input
              type="text"
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
              placeholder={autoTitle}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={labeled}>Subtitle override</span>
            <input
              type="text"
              value={subtitleOverride}
              onChange={(e) => setSubtitleOverride(e.target.value)}
              placeholder={autoSubtitle || '(auto)'}
              className={inputCls}
            />
          </div>

          <button
            onClick={exportPng}
            disabled={exporting || rows.length === 0}
            className="mt-1 bg-accent hover:bg-accent-bright disabled:opacity-50 text-white font-semibold text-sm rounded-lg px-4 py-2.5 transition-colors"
          >
            {exporting ? 'Rendering…' : 'Export PNG (2×)'}
          </button>
          {exportError && <div className="text-bad text-xs">{exportError}</div>}
          {rows.length === 0 && (
            <div className="text-muted text-xs">
              {isSeries
                ? 'No fully-timed matches pass the current filters — widen the filters or re-export series_length.json once more matches have a scraped duration.'
                : 'No rows pass the current filters and thresholds — lower minimum rounds/maps or widen the filters.'}
            </div>
          )}
        </div>

        {/* preview */}
        <div ref={previewRef} className="min-w-0">
          <div
            style={{
              width: CARD_W * scale,
              height: cardH ? cardH * scale : 'auto',
              overflow: 'hidden',
            }}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <StatCard
                ref={cardRef}
                kicker="VALORANT — VCT 2026"
                title={title}
                subtitle={subtitle}
                credit={'vct-2026 stats\nstats: vlr.gg'}
                rows={rows}
                valueFormat={stat.format}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function RangeControl({ label, value, onChange, min, max, step }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labeled}>{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[#FF4655]"
        />
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className={`${inputCls} w-20 text-right`}
        />
      </div>
    </div>
  )
}
