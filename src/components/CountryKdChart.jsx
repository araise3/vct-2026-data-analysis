/**
 * Vertical bar strip, same layout mechanics as PerformanceStrip.jsx (flex
 * items-end + height percentage, overflow-x-auto, dashed 1.00 baseline) --
 * but one bar per COUNTRY: this player's own K/D specifically in duels
 * against opponents from that country (sum kills-for over sum kills-
 * against across every such opponent, see aggregateKdByCountry()), not a
 * country's general skill level. Each bar is filled with that country's
 * real flag (background-image, cover/center) rather than a tone color, so
 * e.g. a Türkiye bar is genuinely the Turkish flag art. No single bar is
 * highlighted here (unlike the earlier subject-vs-peer-field version this
 * replaced) -- every bar is already "about the subject", so there's no
 * separate entity left to call out.
 *
 * `bars` is aggregateKdByCountry()'s return shape:
 * `{ code, name, kFor, kAgainst, kd, opponents }[]`, already sorted best
 * K/D first.
 */
const MAX_BARS = 24
// Duel K/D against one specific country can run hotter/colder than an
// overall season K/D -- it's a narrower sample (one opposing pool, not
// the whole field) -- so the scale is wider than PerformanceStrip's own
// Rating range to avoid clipping a real 2:1 or 1:2 country matchup flat
// against the top/bottom of the chart.
const MIN_KD = 0.4
const MAX_KD = 2.2

function flagUrl(code) {
  return `${import.meta.env.BASE_URL}flags/${code.toLowerCase()}.svg`
}

function heightPct(v) {
  if (v == null) return 0
  const clamped = Math.min(MAX_KD, Math.max(MIN_KD, v))
  return ((clamped - MIN_KD) / (MAX_KD - MIN_KD)) * 100
}

export default function CountryKdChart({ bars }) {
  const shown = bars.length > MAX_BARS ? bars.slice(0, MAX_BARS) : bars

  if (!shown.length) {
    return <p className="text-muted text-sm px-1">Not enough duel data to compare by country.</p>
  }

  const baselineBottom = heightPct(1.0)

  return (
    <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5">
      <div className="overflow-x-auto">
        <div className="relative flex items-end gap-1.5 min-h-[132px] h-[132px]">
          <div
            className="absolute left-0 right-0 border-t border-dashed border-hairline pointer-events-none"
            style={{ bottom: `${baselineBottom}%` }}
          />
          {shown.map((b) => (
            <div
              key={b.code}
              className="group relative flex-1 min-w-[30px] max-w-[56px] h-full flex items-end"
              title={`${b.name}: ${b.kd.toFixed(2)} K/D (${b.kFor}-${b.kAgainst}) across ${b.opponents} opponent${b.opponents === 1 ? '' : 's'}`}
            >
              <span
                className="w-full rounded-sm bg-cover bg-center transition-opacity group-hover:opacity-80"
                style={{ height: `${Math.max(2, heightPct(b.kd))}%`, backgroundImage: `url(${flagUrl(b.code)})` }}
              />
            </div>
          ))}
        </div>

        <div className="flex items-start gap-1.5 mt-2">
          {shown.map((b) => (
            <div key={b.code} className="flex-1 min-w-[30px] max-w-[56px] flex flex-col items-center">
              <span className="text-[11px] tabular-nums text-muted">{b.kd.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 mt-4 text-[11px] text-muted flex-wrap">
        <span>Dashed line is 1.00 K/D</span>
        <span className="ml-auto">Hover a bar for the full kills-for/against record</span>
      </div>
    </div>
  )
}
