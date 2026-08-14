import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { expandBuckets } from '../lib/entityBuckets'
import { buildRadarProfile } from '../lib/radarProfile'
import RadarChart from '../components/RadarChart'
import FilterChips from '../components/FilterChips'
import Select from '../components/ui/Select'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { scaleColor } from '../lib/format'

// Matches RadarChart.jsx's own (unexported) constants -- kept in sync here
// the same way PlayerProfile.jsx already does for its legend dots, rather
// than exporting them just for this one shared use.
const SUBJECT_COLOR = '#FF4655'
const COMPARE_COLOR = '#FFD47D'

// Sentinel for "no year filter" (a player's whole career) -- distinct from
// any real year value (a number) so it can sit in the same options list.
const YEAR_ALL = 'All'

/**
 * Standalone home for the peer-relative radar comparison, promoted out of
 * the Events page's "Compare players" sidebar card. That card only ever
 * collected two names and handed off to PlayerProfile's own compare field
 * (?compare=) -- it couldn't plot anything itself, so a player who wasn't
 * already looking at one of the two profiles had no direct way to reach a
 * comparison. This page reuses the exact same building blocks
 * (buildRadarProfile + RadarChart) PlayerProfile.jsx uses for its own inline
 * compare feature, just with BOTH names as free-standing state instead of
 * one being "whoever's profile this is."
 *
 * EACH PLAYER GETS THEIR OWN SEASON, NOT ONE SHARED ONE
 * -------------------------------------------------------
 * A single shared "Season" picker (the first version of this page) breaks
 * the moment the two players' active years don't overlap -- picking 2026 to
 * compare a player who retired after 2025 against a 2026 rookie shows one of
 * them as "no data" for no reason a visitor would guess, and there's no
 * single year that works for both. Each player's own picker only offers
 * years THEY actually have buckets in (computed once they're chosen), and
 * defaults to their whole career (`YEAR_ALL`) rather than guessing a season.
 *
 * The peer field used to build each axis's domain (see radarProfile.js) is
 * always every player's whole career, regardless of either side's own year
 * picker -- deliberately NOT narrowed to whichever years are in play. That
 * was tried first and had a real bug: narrowing the shared peer pool by
 * (say) player A's year selection also shifted player B's plotted position,
 * and vice versa, even when B's own value hadn't changed at all -- because
 * the axis domain (5th-95th percentile of the peer field) moved out from
 * under them. A player whose entire career sits in one season saw their OWN
 * polygon visibly shift just from toggling their own "All" vs. that single
 * year, which is exactly the same underlying buckets either way. Keeping
 * the peer domain fixed regardless of either year picker means a player's
 * position on the chart only ever moves when THEIR OWN scoped value
 * actually changes.
 */
export default function ComparePlayers() {
  const { data, loading } = useData('player_buckets')

  const [searchParams, setSearchParams] = useSearchParams()
  const [a, setA] = useState(searchParams.get('a') || '')
  const [b, setB] = useState(searchParams.get('b') || '')
  const [yearA, setYearA] = useState(YEAR_ALL)
  const [yearB, setYearB] = useState(YEAR_ALL)

  const allPlayerRecords = useMemo(() => (data ? expandBuckets(data, 'p') : []), [data])

  const options = useMemo(() => (data?.meta ? Object.keys(data.meta).sort((x, y) => x.localeCompare(y)) : []), [data])

  function yearsFor(name) {
    if (!name) return []
    const ys = new Set()
    for (const r of allPlayerRecords) if (r.id === name && r.year) ys.add(r.year)
    return [...ys].sort((x, y) => x - y)
  }
  const yearOptionsA = useMemo(() => [YEAR_ALL, ...yearsFor(a)], [allPlayerRecords, a])
  const yearOptionsB = useMemo(() => [YEAR_ALL, ...yearsFor(b)], [allPlayerRecords, b])

  // Each subject's OWN buckets are scoped to their own year picker; every
  // other player (the peer field the axis domains are built from) always
  // keeps their whole career -- see the docstring above for why the peer
  // pool deliberately does NOT also narrow by year.
  const radarScope = useMemo(() => {
    if (!a) return []
    return allPlayerRecords.filter((r) => {
      if (r.id === a) return yearA === YEAR_ALL || r.year === yearA
      if (b && r.id === b) return yearB === YEAR_ALL || r.year === yearB
      return true
    })
  }, [allPlayerRecords, a, b, yearA, yearB])

  const radar = useMemo(
    () => (a ? buildRadarProfile(radarScope, a, { compareName: b || null }) : null),
    [radarScope, a, b]
  )

  function syncParams(na, nb) {
    const params = {}
    if (na) params.a = na
    if (nb) params.b = nb
    setSearchParams(params, { replace: true })
  }
  // Resetting the year back to "career" on a player change avoids leaving a
  // stale selection (e.g. "2025") pinned on a newly-picked player who never
  // played that year -- their own picker wouldn't even offer it any more,
  // but the old value would otherwise silently keep filtering by it.
  function pickA(name) {
    setA(name)
    setYearA(YEAR_ALL)
    syncParams(name, b)
  }
  function pickB(name) {
    setB(name)
    setYearB(YEAR_ALL)
    syncParams(a, name)
  }

  function renderPlayerIcon(name) {
    const meta = data?.meta?.[name]
    if (!meta) return null
    return (
      <span className="flex items-center gap-1.5 shrink-0">
        <Flag countryCode={meta.countryCode} countryName={meta.countryName} size={12} />
        <TeamLogo team={meta.team} size={14} showName={false} />
      </span>
    )
  }

  const seasonLabel = (y) => (y === YEAR_ALL ? 'career' : String(y))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Compare Players</h1>
        <p className="text-muted text-sm mt-1">
          Peer-relative performance profile for any two players, head to head.
        </p>
      </div>

      <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-start gap-3">
          <PlayerField
            color={SUBJECT_COLOR}
            value={a}
            onChange={pickA}
            options={options}
            placeholder={loading ? 'Loading…' : 'Select Player A…'}
            renderIcon={renderPlayerIcon}
            year={yearA}
            onYearChange={setYearA}
            yearOptions={yearOptionsA}
          />
          <div className="hidden sm:flex items-center justify-center h-9 text-muted text-xs font-semibold uppercase">
            vs
          </div>
          <PlayerField
            color={COMPARE_COLOR}
            value={b}
            onChange={pickB}
            options={options}
            placeholder={loading ? 'Loading…' : 'Select Player B…'}
            renderIcon={renderPlayerIcon}
            year={yearB}
            onYearChange={setYearB}
            yearOptions={yearOptionsB}
          />
        </div>
      </div>

      {!a ? (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">Pick at least one player to see their performance profile.</p>
        </div>
      ) : loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : !radar ? (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-8 text-center">
          <p className="text-muted text-sm">No data for "{a}" in their {seasonLabel(yearA)}.</p>
        </div>
      ) : (
        <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5">
          <p className="text-muted text-xs mb-4">
            Each spoke is its own scale — position is percentile within qualified players (rounds
            played ≥ half the scope's median, min 20). {a} shown for their {seasonLabel(yearA)}
            {b && `, ${b} for their ${seasonLabel(yearB)}`}. Hover a point for rank.
            {!radar.subjectQualified && ` Small sample for ${a} — below the qualification bar in this scope.`}
            {radar.compareName && radar.compareQualified === false && ` Small sample for ${radar.compareName} — below the qualification bar in this scope.`}
            {b && b === a && ' Pick a different player to compare against.'}
            {radar.compareMissing && ` No data for "${b}" in this scope.`}
          </p>

          <div className="max-w-xl mx-auto">
            <RadarChart axes={radar.axes} />
          </div>

          <ComparisonTable axes={radar.axes} a={a} b={radar.compareName} />
        </div>
      )}
    </div>
  )
}

/**
 * The radar's own axes, restated as a plain table -- the polygon shows
 * where each player sits relative to the field at a glance, but reading an
 * exact number off a spoke means eyeballing its position against the ring
 * labels. This is the same `axes` array with nothing recomputed, just laid
 * out so the real values (and, with a comparison active, which of the two
 * is actually higher) are readable directly.
 *
 * Styled to match DataTable.jsx's own grid -- border-r/border-b on every
 * cell rather than a single divide-y, uppercase 10px bold header on
 * `bg-surface2`, `shadow-depth-sm` on the rounded wrapper -- so it reads as
 * the same kind of table as everywhere else in the app instead of a
 * one-off. Not built on DataTable itself: that component sorts/color-scales
 * per COLUMN across its rows, which assumes every row is the same kind of
 * value: here every ROW is a different stat with its own unit and scale, so
 * a column-wise color scale or sort would rank "ACS" above "K/D" for no
 * reason other than ACS's raw numbers being bigger.
 */
function ComparisonTable({ axes, a, b }) {
  const subHeader = 'py-1.5 text-right font-bold text-[9px] uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap'
  return (
    <div className="mt-6 overflow-auto rounded-2xl border border-hairline shadow-depth-sm">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          <col />
          <col className="w-[88px]" />
          <col className="w-[88px]" />
          {b && <col className="w-[88px]" />}
          {b && <col className="w-[88px]" />}
        </colgroup>
        <thead>
          <tr className="bg-surface2">
            <th className="border-r border-b border-hairline" />
            <th
              colSpan={2}
              className="px-[10px] py-1.5 text-center font-bold text-[11px] uppercase border-r border-b border-hairline whitespace-nowrap"
              style={{ color: SUBJECT_COLOR }}
            >
              {a}
            </th>
            {b && (
              <th
                colSpan={2}
                className="px-[10px] py-1.5 text-center font-bold text-[11px] uppercase border-b border-hairline whitespace-nowrap"
                style={{ color: COMPARE_COLOR }}
              >
                {b}
              </th>
            )}
          </tr>
          <tr className="bg-surface2">
            <th className="pl-[15px] pr-[10px] py-1.5 text-left font-bold text-[10px] uppercase text-muted border-r border-b border-hairline whitespace-nowrap">
              Stat
            </th>
            <th className={`pl-[10px] pr-[10px] border-r ${subHeader}`}>Value</th>
            <th className={`px-[10px] border-r ${subHeader}`}>Rank</th>
            {b && (
              <>
                <th className={`pl-[10px] pr-[10px] border-r ${subHeader}`}>Value</th>
                <th className={`px-[10px] ${subHeader}`}>Rank</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {axes.map((ax) => {
            const hasCompare = b && ax.compareValue !== null && ax.compareValue !== undefined
            const aHigher = hasCompare && ax.value > ax.compareValue
            const bHigher = hasCompare && ax.compareValue > ax.value
            return (
              <tr key={ax.key} className="hover:bg-surface/60 transition-colors">
                <td className="pl-[15px] pr-[10px] py-1.5 text-[12px] font-semibold leading-[18px] text-ink border-r border-b border-hairline whitespace-nowrap">
                  {ax.label}
                </td>
                <StatCell value={ax.formatted} higher={aHigher} />
                <td className="px-[10px] py-1.5 text-right border-r border-b border-hairline whitespace-nowrap">
                  <RankBadge rank={ax.rank} n={ax.n} />
                </td>
                {b && (
                  <>
                    <StatCell value={ax.compareFormatted ?? '—'} higher={bHigher} />
                    <td className="px-[10px] py-1.5 text-right border-b border-hairline whitespace-nowrap">
                      <RankBadge rank={ax.compareRank} n={ax.n} />
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One player's raw value for one stat -- a highlighted green background plus
 * bold ink when this side is the higher of the two (comparison-relative, not
 * the rank badge's field-relative color), so the head-to-head winner reads at
 * a glance without needing to read both numbers first. */
function StatCell({ value, higher }) {
  return (
    <td
      className={`pl-[10px] pr-[10px] py-1.5 text-right text-[12px] tabular-nums border-r border-b border-hairline whitespace-nowrap ${
        higher ? 'bg-good/10 text-good font-bold' : 'text-ink/70'
      }`}
    >
      {value}
    </td>
  )
}

/**
 * The rank, given real visual weight instead of the small muted "#21"
 * afterthought this used to be -- a solid colour-scaled pill using the same
 * hue law every other stats table in the app already uses (`scaleColor`,
 * DataTable.jsx's own hue-0-to-270 red-to-violet ramp), just inverted since
 * a LOWER rank number is the better result: rank 1 gets the "best" end of
 * the scale (violet) and rank n gets the "worst" end (red), same as passing
 * `colorInvert` to a DataTable column.
 */
function RankBadge({ rank, n }) {
  if (!rank || !n) return <span className="text-muted text-[11px]">—</span>
  const bg = scaleColor(rank, n, 1)
  return (
    <span
      className="inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-md text-[12px] font-bold text-ink shrink-0"
      style={{ backgroundColor: bg }}
      title={`Rank #${rank} of ${n} qualified players`}
    >
      #{rank}
    </span>
  )
}

function PlayerField({ color, value, onChange, options, placeholder, renderIcon, year, onYearChange, yearOptions }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <Select
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            renderIcon={renderIcon}
            className="w-full"
          />
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-muted hover:text-ink text-xs leading-none shrink-0"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>
      {value && (
        <div className="flex items-center gap-3 pl-4.5 flex-wrap">
          <Link
            to={`/players/${encodeURIComponent(value)}`}
            className="text-xs text-muted hover:text-accent-bright transition-colors"
          >
            View profile →
          </Link>
          {yearOptions.length > 1 && (
            <FilterChips options={yearOptions} value={year} onChange={onYearChange} />
          )}
        </div>
      )}
    </div>
  )
}
