/**
 * Vertical bar strip, same layout mechanics as PerformanceStrip.jsx (flex
 * items-end + height percentage, overflow-x-auto) -- one bar per COUNTRY:
 * this player's own K/D specifically in duels against
 * opponents from that country (sum kills-for over sum kills-against across
 * every such opponent, see aggregateKdByCountry()), not a country's general
 * skill level.
 *
 * The bar itself is a solid win/even/loss color -- PerformanceStrip's own
 * `bg-good`/`bg-mid`/`bg-bad` convention, reused verbatim (see toneFor())
 * -- with that country's flag as a small badge floating at the bar's own
 * vertical center. An earlier version filled the whole bar with the flag
 * art directly (background-image, contain/center); that meant a short bar
 * either cropped the flag (`cover`) or letterboxed around it (`contain`),
 * since the flag's real aspect ratio rarely matches a narrow, data-driven
 * box. Decoupling the two fixes both problems at once: the bar is a color,
 * so it always fills the column trivially regardless of height, and the
 * flag badge is sized to its own true aspect ratio (never stretched or
 * cropped) rather than the bar's. No single bar is highlighted here (unlike
 * the earlier subject-vs-peer-field version this replaced) -- every bar is
 * already "about the subject", so there's no separate entity left to call
 * out.
 *
 * `bars` is aggregateKdByCountry()'s return shape:
 * `{ code, name, kFor, kAgainst, kd, opponents, maps, sortScore }[]`. `maps`
 * (distinct maps played against that country) is shown as a plain count
 * absolutely positioned right above that column's own bar top (see
 * effectivePct() -- it has to track the bar's actual rendered height,
 * MIN_BAR_PX floor included, or the label floats above the bar instead of
 * sitting on it). `kd` (bar
 * height + label here) is always the real, unshrunk K/D -- by direct
 * request, this chart never displays an adjusted number. The array order
 * is NOT a plain sort on that `kd` though: countries below a dynamic
 * minimum-duel-volume gate are dropped entirely, and what's left is
 * ordered by `sortScore`, a hidden confidence-weighted score so a lucky
 * 1-opponent matchup can't outrank a well-established many-opponent one
 * just because its raw K/D happens to be higher -- see playerDuels.js for
 * the full reasoning (and why a visible shrunk number couldn't fix this on
 * its own).
 */
const MAX_BARS = 24
// Duel K/D against one specific country can run hotter/colder than an
// overall season K/D -- it's a narrower sample (one opposing pool, not
// the whole field) -- so the scale is wider than PerformanceStrip's own
// Rating range to avoid clipping a real 2:1 or 1:2 country matchup flat
// against the top/bottom of the chart.
const MIN_KD = 0.4
const MAX_KD = 2.2

// Same thresholds PerformanceStrip.jsx uses for Rating 2.0, reused as-is
// for K/D against the same 1.00 baseline -- one win/even/loss vocabulary
// across the whole site rather than a second color scale someone has to
// learn.
function toneFor(kd) {
  if (kd >= 1.15) return 'bg-good'
  if (kd >= 0.95) return 'bg-mid'
  return 'bg-bad'
}

// A bar near MIN_KD (or, before shrinkage, a country with almost no duel
// volume) would otherwise resolve to only a couple of px of the 132px
// chart -- not enough room for the flag badge to sit inside it at all.
// Every major charting library has the same fix for the same underlying
// problem (a near-zero value that still needs to render as a visible
// mark): Highcharts' `minPointLength`, ECharts' `barMinHeight`, MUI X
// Charts' `minBarSize` -- all reserve a fixed pixel floor so the smallest
// bar is never actually zero-ish, trading strict proportionality at the
// very bottom of the scale for the mark staying legible. Applied here as
// plain CSS min-height rather than a charting-library option since this is
// a hand-rolled flex/percentage strip, not a chart component with that
// knob built in. The real value is never hidden either way -- it's still
// the number in the label underneath and in the hover tooltip.
const MIN_BAR_PX = 28

function flagUrl(code) {
  return `${import.meta.env.BASE_URL}flags/${code.toLowerCase()}.svg`
}

function heightPct(v) {
  if (v == null) return 0
  const clamped = Math.min(MAX_KD, Math.max(MIN_KD, v))
  return ((clamped - MIN_KD) / (MAX_KD - MIN_KD)) * 100
}

// The maps-played label is anchored to the bar's own rendered top edge (see
// below), so it needs the bar's true on-screen height as a percentage --
// including the MIN_BAR_PX floor -- rather than the raw, pre-clamp
// heightPct(). Without this a bar sitting at the floor would report its
// (smaller) unclamped percentage and the label would float above the
// bar's actual top instead of sitting right on it.
const CHART_PX = 132
function effectivePct(v) {
  return Math.max(heightPct(v), (MIN_BAR_PX / CHART_PX) * 100)
}

export default function CountryKdChart({ bars }) {
  const shown = bars.length > MAX_BARS ? bars.slice(0, MAX_BARS) : bars

  if (!shown.length) {
    return <p className="text-muted text-sm px-1">Not enough duel data to compare by country.</p>
  }

  return (
    <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm p-5">
      <div className="overflow-x-auto">
        <div className="relative flex items-end gap-1.5 min-h-[132px] h-[132px] mt-4">
          {shown.map((b) => (
            <div
              key={b.code}
              className="group relative flex-1 min-w-[30px] max-w-[56px] h-full flex items-end"
              title={`${b.name}: ${b.kd.toFixed(2)} K/D (${b.kFor}-${b.kAgainst}) across ${b.opponents} opponent${b.opponents === 1 ? '' : 's'}`}
            >
              <span
                className="absolute inset-x-0 text-center text-[10px] tabular-nums text-muted"
                style={{ bottom: `calc(${effectivePct(b.kd)}% + 4px)` }}
              >
                {b.maps}
              </span>
              <span
                className={`relative block w-full rounded-sm ${toneFor(b.kd)} transition-opacity group-hover:opacity-80`}
                style={{ height: `${effectivePct(b.kd)}%` }}
              >
                <img
                  src={flagUrl(b.code)}
                  alt={b.name}
                  className="absolute inset-0 m-auto max-w-[24px] max-h-[calc(100%-6px)] w-auto h-auto rounded-[2px] shadow ring-1 ring-black/30"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              </span>
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
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-good inline-block" /> 1.15+
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-mid inline-block" /> 0.95–1.15
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-bad inline-block" /> under 0.95
        </span>
        <span className="ml-auto">Number above each bar is maps played · hover a bar for the full kills-for/against record</span>
      </div>
    </div>
  )
}
