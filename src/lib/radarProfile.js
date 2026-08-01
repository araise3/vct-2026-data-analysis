/**
 * Peer-relative radar profile for a single player, with an optional
 * second player layered over the same axes for direct comparison.
 *
 * Modelled on the peer-comparison panel documented in CLAUDE.md (removed
 * since, but the qualification-bar reasoning still applies here): a fixed
 * round-count bar silently empties a scope narrowed to one event, where
 * nobody clears e.g. 100 rounds, so the bar is relative to the field
 * instead -- max(20, 0.5 x median rounds among players in scope). The
 * subject is always included in their own chart even under the bar
 * (common on a single-event scope), flagged via `subjectQualified` so the
 * caller can caveat a small sample rather than hiding the chart or
 * presenting the shape as settled.
 *
 * Every axis is plotted relative to the *field*, not to a fixed scale --
 * each axis's domain is the 5th-95th percentile of qualified peers (padded
 * out to also cover the subject's own value if they fall outside that
 * band), matching how the reference chart's rings are per-stat scales
 * rather than one shared 0-1 axis. An axis with no data for the subject
 * (nothing to plot a vertex at) is dropped entirely, the same rule that
 * already keeps a China-only scope from rendering a fake "1st place" 0.00
 * on multi-kills (see multiKillsPerMap's own note in entityBuckets.js).
 *
 * When `compareName` is given, the SAME per-axis domain is reused for both
 * players (widened to cover whichever of the two is more extreme) rather
 * than computing two independent charts -- two radars with different
 * scales per spoke would silently misrepresent which player is actually
 * ahead. Both named players are excluded from the peer pool used to build
 * that domain (comparing a player against a peer field that secretly
 * includes them, or the person they're being compared to, would be
 * circular). If either player has no value for a given axis, the axis is
 * dropped entirely rather than drawing a vertex at a fabricated value --
 * same "drop, don't fake" rule as the single-player case.
 */
import { groupByEntity, aggregatePlayerBuckets } from './entityBuckets'

const AXES = [
  { key: 'avgRating', label: 'Rating', compute: (s) => s.avgRating, format: (v) => v.toFixed(2) },
  { key: 'avgAcs', label: 'ACS', compute: (s) => s.avgAcs, format: (v) => Math.round(v).toString() },
  { key: 'kd', label: 'K/D', compute: (s) => s.kd, format: (v) => v.toFixed(2) },
  { key: 'avgAdr', label: 'ADR', compute: (s) => s.avgAdr, format: (v) => Math.round(v).toString() },
  { key: 'avgKast', label: 'KAST', compute: (s) => s.avgKast, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'avgHsPct', label: 'HS%', compute: (s) => s.avgHsPct, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'apr', label: 'APR', compute: (s) => s.apr, format: (v) => v.toFixed(2) },
  { key: 'kpr', label: 'KPR', compute: (s) => s.kpr, format: (v) => v.toFixed(2) },
  {
    key: 'fkfd', label: 'FK:FD',
    compute: (s) => (s.totalFirstDeaths ? s.totalFirstKills / s.totalFirstDeaths : null),
    format: (v) => v.toFixed(2),
  },
  {
    key: 'multiKillsPerMap', label: 'Multi-kills/map',
    compute: (s) => s.multiKillsPerMap,
    format: (v) => v.toFixed(2),
  },
]

function isNum(v) {
  return v !== null && v !== undefined && !Number.isNaN(v)
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * `records` are expanded player_buckets rows across EVERY player already
 * narrowed to the active scope (region/event/phase/week/year/date range) --
 * the caller re-filters the full dataset the same way the old
 * buildPeerComparison() did, rather than reusing the page's own
 * player-scoped `filtered`, since this needs the whole field to rank
 * against.
 */
export function buildRadarProfile(records, subjectName, { ratedOnly = false, compareName = null } = {}) {
  const grouped = groupByEntity(records)
  const allPlayers = []
  for (const [id, buckets] of grouped) {
    const stats = aggregatePlayerBuckets(buckets, { ratedOnly })
    if (!stats || !stats.mapsPlayed) continue
    allPlayers.push({ id, stats })
  }
  const subject = allPlayers.find((p) => p.id === subjectName)
  if (!subject) return null

  // Comparing a player against themself would just draw two identical
  // polygons -- treat it the same as no comparison requested.
  const effectiveCompareName = compareName && compareName !== subjectName ? compareName : null
  const compareSubject = effectiveCompareName
    ? allPlayers.find((p) => p.id === effectiveCompareName) ?? null
    : null
  // A name was typed but has no data in the current scope -- surfaced so
  // the UI can say so instead of silently drawing a single-player chart
  // with no explanation.
  const compareMissing = !!effectiveCompareName && !compareSubject

  const roundsSorted = allPlayers
    .map((p) => p.stats.roundsPlayed)
    .filter((r) => r > 0)
    .sort((a, b) => a - b)
  const medianRounds = percentile(roundsSorted, 0.5) || 0
  const bar = Math.max(20, 0.5 * medianRounds)

  const excluded = new Set([subjectName, compareSubject?.id].filter(Boolean))
  const qualifiedPeers = allPlayers.filter((p) => !excluded.has(p.id) && p.stats.roundsPlayed >= bar)
  const subjectQualified = subject.stats.roundsPlayed >= bar
  const compareQualified = compareSubject ? compareSubject.stats.roundsPlayed >= bar : null

  const axes = AXES.map((axis) => {
    const subjectValue = axis.compute(subject.stats)
    const compareValue = compareSubject ? axis.compute(compareSubject.stats) : null
    const hasSubject = isNum(subjectValue)
    const hasCompare = compareSubject ? isNum(compareValue) : false

    if (!hasSubject) return null // nothing to plot the subject's own vertex at
    if (compareSubject && !hasCompare) return null // comparison active but this axis can't be fairly shown for both

    const peerValues = qualifiedPeers
      .map((p) => axis.compute(p.stats))
      .filter(isNum)
      .sort((a, b) => a - b)

    let lo, hi
    if (peerValues.length >= 2) {
      lo = percentile(peerValues, 0.05)
      hi = percentile(peerValues, 0.95)
    } else if (peerValues.length === 1) {
      const v = peerValues[0]
      const pad = Math.abs(v) * 0.15 || 1
      lo = v - pad; hi = v + pad
    } else {
      const v = subjectValue
      const pad = Math.abs(v) * 0.15 || 1
      lo = v - pad; hi = v + pad
    }
    // Widen to always cover the subject (and the compared player, if any)
    // -- otherwise a player who sits outside the peer field's own p5-p95
    // band (a real outlier, or the only data point when peerValues is
    // thin) would clamp to the rim/center and look like an ordinary
    // top/bottom score rather than the actual extreme it is.
    //
    // Gated on *Qualified* though: an unqualified player's value is exactly
    // the kind of number this bar exists to distrust (small/noisy sample),
    // so it still plots -- clamped to the rim by the norm clamp below --
    // but doesn't get to redefine the domain for a qualified peer field.
    // Real bug this fixes: on a wide multi-year/multi-competition scope the
    // qualification bar (half the field's median rounds) balloons past what
    // most single-season players clear, so comparing against any such
    // player let their real-but-noisy value collapse several axes at once
    // (domain floor = their own number = norm exactly 0), producing a
    // degenerate spiked polygon instead of a legible "near the bottom".
    if (subjectQualified) {
      lo = Math.min(lo, subjectValue)
      hi = Math.max(hi, subjectValue)
    }
    if (hasCompare && compareQualified) {
      lo = Math.min(lo, compareValue)
      hi = Math.max(hi, compareValue)
    }
    if (lo === hi) hi = lo + (Math.abs(lo) * 0.1 || 1)

    const norm = Math.max(0, Math.min(1, (subjectValue - lo) / (hi - lo)))
    const rank = 1 + peerValues.filter((v) => v > subjectValue).length
    const n = peerValues.length + 1

    const compareNorm = hasCompare ? Math.max(0, Math.min(1, (compareValue - lo) / (hi - lo))) : null
    const compareRank = hasCompare ? 1 + peerValues.filter((v) => v > compareValue).length : null
    const compareFormatted = hasCompare ? axis.format(compareValue) : null

    const ticks = Array.from({ length: 9 }, (_, i) => lo + ((hi - lo) * i) / 8)

    return {
      key: axis.key,
      label: axis.label,
      value: subjectValue,
      formatted: axis.format(subjectValue),
      lo, hi, ticks,
      norm, rank, n,
      compareValue, compareFormatted, compareNorm, compareRank,
      format: axis.format,
    }
  }).filter(Boolean)

  if (!axes.length) return null

  return {
    axes,
    subjectQualified,
    peerCount: qualifiedPeers.length,
    compareName: compareSubject?.id ?? null,
    compareQualified,
    compareMissing,
  }
}
