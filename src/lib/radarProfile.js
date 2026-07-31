/**
 * Peer-relative radar profile for a single player.
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
export function buildRadarProfile(records, subjectName, { ratedOnly = false } = {}) {
  const grouped = groupByEntity(records)
  const allPlayers = []
  for (const [id, buckets] of grouped) {
    const stats = aggregatePlayerBuckets(buckets, { ratedOnly })
    if (!stats || !stats.mapsPlayed) continue
    allPlayers.push({ id, stats })
  }
  const subject = allPlayers.find((p) => p.id === subjectName)
  if (!subject) return null

  const roundsSorted = allPlayers
    .map((p) => p.stats.roundsPlayed)
    .filter((r) => r > 0)
    .sort((a, b) => a - b)
  const medianRounds = percentile(roundsSorted, 0.5) || 0
  const bar = Math.max(20, 0.5 * medianRounds)

  const qualifiedPeers = allPlayers.filter((p) => p.id !== subjectName && p.stats.roundsPlayed >= bar)
  const subjectQualified = subject.stats.roundsPlayed >= bar

  const axes = AXES.map((axis) => {
    const subjectValue = axis.compute(subject.stats)
    const peerValues = qualifiedPeers
      .map((p) => axis.compute(p.stats))
      .filter((v) => v !== null && v !== undefined && !Number.isNaN(v))
      .sort((a, b) => a - b)

    if (subjectValue === null || subjectValue === undefined || Number.isNaN(subjectValue)) {
      if (!peerValues.length) return null
    }

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
    // Widen to always cover the subject -- otherwise a subject who sits
    // outside the peer field's own p5-p95 band (a real outlier, or the
    // only unqualified data point when peerValues is thin) would clamp to
    // the rim/center and look like an ordinary top/bottom score rather
    // than the actual extreme it is.
    if (subjectValue !== null && subjectValue !== undefined && !Number.isNaN(subjectValue)) {
      lo = Math.min(lo, subjectValue)
      hi = Math.max(hi, subjectValue)
    }
    if (lo === hi) hi = lo + (Math.abs(lo) * 0.1 || 1)

    const hasSubject = subjectValue !== null && subjectValue !== undefined && !Number.isNaN(subjectValue)
    const norm = hasSubject ? Math.max(0, Math.min(1, (subjectValue - lo) / (hi - lo))) : null
    const rank = hasSubject ? 1 + peerValues.filter((v) => v > subjectValue).length : null
    const n = peerValues.length + (hasSubject ? 1 : 0)

    if (!hasSubject) return null // nothing to plot a vertex at

    const ticks = Array.from({ length: 9 }, (_, i) => lo + ((hi - lo) * i) / 8)

    return {
      key: axis.key,
      label: axis.label,
      value: subjectValue,
      formatted: axis.format(subjectValue),
      lo, hi, ticks,
      norm, rank, n,
      format: axis.format,
    }
  }).filter(Boolean)

  if (!axes.length) return null

  return { axes, subjectQualified, peerCount: qualifiedPeers.length }
}
