import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/useData'
import {
  buildDailyRun, buildRatings, buildTeamPoints, internationalEventWindows, PROVISIONAL_RD,
  RATINGS_CAVEAT,
} from '../lib/teamRatings'
import DataTable from '../components/DataTable'
import TeamLogo from '../components/TeamLogo'
import RatingChart, { MAX_SERIES, seriesColor, STAGE_STYLE } from '../components/RatingChart'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { RC, PANEL_STYLE, pillStyle } from '../lib/ratingTheme'
import { num, pct, regionAbbr, shortDate } from '../lib/format'

/**
 * /ratings -- Glicko-2 team ratings, one independent run per calendar year.
 *
 * The one page on the site with no FilterPanel, deliberately: a Glicko-2
 * rating is the end state of a sequence of updates over every game in
 * order, so "this team's rating, playoffs only" isn't a filter of the
 * number, it's a different number computed from a different history. A year
 * picker is the only scope that's coherent, and it's the scope the ratings
 * are built in. teamRatings.js's header comment has the full reasoning.
 *
 * Everything is derived in the browser from `match_results.json` (943KB,
 * already the file Records/Compositions/Tournaments fetch) -- the whole
 * four-year build measures 23ms, so there's no case for precomputing it
 * into `public/data/`, and doing so would add an artefact that only the
 * scheduled Action can regenerate.
 */

// Volatility is deliberately not a column. It sits at 0.0600 for
// essentially every team in every year -- the per-year sample is too small
// for any team's results to be surprising enough to move sigma off its
// default (which is also why tau turned out not to matter; see
// teamRatings.js's TAU). A column of identical numbers reads as a bug.
const RANK_WIDTH = 40

function RatingRange({ row }) {
  return (
    <span className="text-muted tabular-nums">
      {num(row.low)}–{num(row.high)}
    </span>
  )
}

// Fixed order so the four league tables don't reshuffle between years just
// because a region's top team out-rated another's. International is
// deliberately absent: teamRatings.js only assigns it to teams seen at no
// domestic event at all, which is a handful of one-off EWC entrants, not a
// league worth its own standings table.
const REGION_ORDER = ['Americas', 'EMEA', 'Pacific', 'China']

// How many teams the comparison chart opens with. Five reads as a title
// race; the full six the palette supports gets crowded once every line is
// inside the same 200-point band the top of a season lives in.
const DEFAULT_CHART_TEAMS = 5

// Event scope shows every team that played, but Lock-In's 30-team field
// on one chart is unreadable regardless of how many colors it has --
// capped at the strongest 16 (rows is already rating-sorted) rather than
// leaving it fully uncapped like the rest of event scope's "show the whole
// field" behavior.
const MAX_EVENT_TEAMS = 16

// PCIFIC Esports sit at RD 153.5 in 2026 -- barely over the 150 "settled"
// cutoff despite a full 17-series season, because their matches land in
// widely spaced clusters (Jan / Apr / May / Jul-Aug) and the inactivity
// decay between those gaps keeps nudging RD back past the line. Requested
// as a standing exception: always shown, "prov" badge and all, rather than
// waiting on the general threshold (see PROVISIONAL_RD's comment in
// teamRatings.js) to happen to catch up.
const ALWAYS_SHOWN = new Set(['PCIFIC Esports'])

/**
 * One region's standings. A hand-rolled compact table rather than a
 * DataTable: four of those side by side would each carry their own sort
 * headers and heatmap ranges, and a heatmap scaled per-region would make
 * the strongest team in the weakest region the same colour as the
 * strongest team overall -- actively misleading next to three other
 * tables. These are read as standings, not sorted.
 */
function RegionTable({ region, rows, showProvisional }) {
  const visible = showProvisional ? rows : rows.filter((r) => !r.provisional || ALWAYS_SHOWN.has(r.team))
  return (
    <Card className="p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">{region}</h3>
        <span className="text-muted text-[11px]">{visible.length} teams</span>
      </div>
      {visible.length === 0 ? (
        <p className="text-muted text-xs py-2">No settled ratings in this region.</p>
      ) : (
        <table className="w-full">
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.team} className="border-t border-hairline/50 first:border-t-0">
                <td className="py-1.5 pr-2 text-muted text-xs tabular-nums w-6 text-right">{i + 1}</td>
                <td className="py-1.5 pr-2 min-w-0">
                  <Link
                    to={`/teams/${encodeURIComponent(r.team)}`}
                    className="flex items-center gap-2 text-xs font-medium hover:text-accent-bright transition-colors"
                  >
                    {/* showName off, name rendered here instead: TeamLogo's
                        own name span truncates with an ellipsis, which cut
                        off longer names ("Nongshim RedForce", "DetonatioN
                        FocusMe") at four cards across. Wrapping to a second
                        line loses nothing instead. */}
                    <TeamLogo team={r.team} size={18} showName={false} />
                    <span>{r.team}</span>
                  </Link>
                </td>
                <td className="py-1.5 pr-1 text-right text-xs text-ink tabular-nums">{num(r.rating)}</td>
                <td className="py-1.5 pr-2 text-right text-[11px] text-muted tabular-nums whitespace-nowrap">
                  ±{num(2 * r.rd)}
                </td>
                <td className="py-1.5 text-right text-[11px] text-muted tabular-nums whitespace-nowrap">
                  {r.seriesWins}–{r.seriesLosses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

export default function Ratings() {
  const { data, loading } = useData('match_results')
  const [searchParams, setSearchParams] = useSearchParams()
  const [showProvisional, setShowProvisional] = useState(false)

  const runs = useMemo(() => (data ? buildRatings(data) : new Map()), [data])
  // buildRatings() keys `runs` newest-first (see its own comment) so the
  // default-selection logic below can keep picking years[0] -- the pill
  // row wants the opposite reading order, oldest-to-newest, so it sorts its
  // own copy rather than reversing `years` itself and quietly flipping the
  // default year too.
  const years = useMemo(() => [...runs.keys()], [runs])
  const yearPills = useMemo(() => [...years].sort((a, b) => a - b), [years])

  const yearParam = Number(searchParams.get('year'))
  const year = years.includes(yearParam) ? yearParam : years[0]
  const run = runs.get(year)

  function setParam(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value == null) next.delete(key)
    else next.set(key, String(value))
    setSearchParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    if (!run) return []
    const visible = showProvisional
      ? run.table
      : run.table.filter((t) => !t.provisional || ALWAYS_SHOWN.has(t.team))
    return visible.map((t, i) => ({ ...t, rank: i + 1 }))
  }, [run, showProvisional])

  const eventBands = useMemo(
    () => internationalEventWindows(run, data?.events),
    [run, data]
  )

  // Set by clicking a Masters/Champions/Lock-In band (scopeToEvent below).
  // Looked up by id rather than trusting whatever's in `band.teams`/dates at
  // click time, so the URL stays the single source of truth -- reloading a
  // shared link re-derives the same field and window from this year's run
  // instead of needing them serialized too.
  const scopedEvent = useMemo(() => {
    const id = searchParams.get('event')
    if (!id) return null
    return eventBands.find((b) => String(b.id) === id) || null
  }, [eventBands, searchParams])

  // Charted teams come from the URL so a comparison is linkable, filtered
  // to the ones that exist in THIS year's run -- the year picker and the
  // team picker are independent, so switching 2026 -> 2023 with NRG
  // selected would otherwise leave an empty chart for a team that wasn't
  // in that run. Whatever survives is topped up from the leaderboard, so
  // the chart is never empty and never needs an "add a team" empty state.
  //
  // Event scope overrides all of that: every team in the field (up to
  // MAX_EVENT_TEAMS -- see its own comment) rather than MAX_SERIES, which
  // exists to keep a hand-built comparison legible, not to truncate "who
  // played Champions" down to six of twelve entrants.
  const chartTeams = useMemo(() => {
    if (!run) return []
    if (scopedEvent) {
      const field = new Set(scopedEvent.teams)
      return rows.filter((r) => field.has(r.team)).map((r) => r.team).slice(0, MAX_EVENT_TEAMS)
    }
    const requested = (searchParams.get('teams') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((t) => t && run.history.has(t))
    const seen = new Set(requested)
    const out = [...requested]
    for (const r of rows) {
      if (out.length >= (requested.length ? requested.length : DEFAULT_CHART_TEAMS)) break
      if (!seen.has(r.team)) { out.push(r.team); seen.add(r.team) }
    }
    return out.slice(0, MAX_SERIES)
  }, [run, rows, searchParams, scopedEvent])

  // region/rating ride along for TeamPickerModal's own region-grouped,
  // rating-sorted layout -- straight off `run.table`'s own per-team row,
  // not a second lookup. Order here doesn't matter to the modal (it
  // re-groups/re-sorts its own copy), so this stays alphabetical, which is
  // what a raw, un-grouped consumer (there isn't one today, but a future
  // one) would expect from a plain options list.
  const teamOptions = useMemo(() => {
    if (!run) return []
    return [...run.table]
      .sort((a, b) => a.team.localeCompare(b.team))
      .map((t) => ({ value: t.team, label: t.team, region: t.region, rating: t.rating }))
  }, [run])

  // Recomputed lazily, only while an event is actually scoped -- see
  // buildDailyRun's own comment for why the season-long chart can't just
  // use this run all the time (weekly periods read better at full-season
  // width, and this run's per-date numbers can drift slightly from the
  // weekly one's).
  const dailyRun = useMemo(
    () => (scopedEvent && data ? buildDailyRun(data, year) : null),
    [scopedEvent, data, year]
  )

  // One calendar day before an event started -- the fixed lead-in date the
  // anchor point below is re-dated to and the chart's x-axis starts from.
  function dayBefore(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }

  // Trims a team's full-season points down to an event's own window --
  // "only from start to finish of the event" -- plus one synthetic anchor
  // point just before it, carrying whatever rating the team actually held
  // then. That anchor is load-bearing: even at daily granularity a lone
  // point inside the window can't show a team moving up or down, only
  // where it ended up -- one point of pre-event context is the minimum
  // that turns "where they landed" back into "what the event did to them".
  //
  // It's re-dated to dayBefore(event.start) and forced to games: 0 rather
  // than kept at its real date/games -- it isn't a result, it shouldn't
  // claim a game happened on a day that, for most teams, saw none of
  // theirs, and games: 0 is what RatingChart's dot renderer keys off, so
  // that alone keeps it dot-free. `synthetic: true` is what keeps it
  // hoverable anyway despite that -- games: 0 also normally excludes a
  // point from the hover crosshair (an idle week has nothing to show), but
  // this one still has a rating worth reading, just not a result to list.
  function windowToEvent(points, event) {
    if (!event) return points
    const before = points.filter((p) => p.date < event.start)
    const inside = points.filter((p) => p.date >= event.start && p.date <= event.end)
    if (!before.length) return inside
    const anchor = { ...before[before.length - 1], date: dayBefore(event.start), games: 0, synthetic: true }
    return [anchor, ...inside]
  }

  // The date each team's tournament ended, for whichever teams lost their
  // last match in the event -- straight off match_results.json's own rows
  // rather than anything bracket-shaped, since "lost your last match in
  // this event" is a correct definition of eliminated regardless of
  // whether that loss came in Swiss, groups, or a playoff bracket. The one
  // team whose last match in the event was a WIN is the champion, not
  // eliminated, and is correctly left out of this map -- there's no bracket
  // structure to consult, but a team can't both win their last game and be
  // out of the tournament.
  const eliminationByTeam = useMemo(() => {
    const map = new Map()
    if (!scopedEvent || !data?.rows) return map
    for (const team of scopedEvent.teams) {
      const played = data.rows
        .filter((r) => r.e === scopedEvent.id && (r.team1 === team || r.team2 === team))
        .sort((a, b) => (a.ts || a.date).localeCompare(b.ts || b.date))
      const last = played[played.length - 1]
      if (!last) continue
      const won = last.team1 === team ? last.s1 > last.s2 : last.s2 > last.s1
      if (!won) map.set(team, last.date)
    }
    return map
  }, [scopedEvent, data])

  const chartSeries = useMemo(() => {
    if (!run) return []
    const sourceRun = scopedEvent ? dailyRun : run
    return chartTeams
      .map((team, i) => ({
        key: team,
        label: team,
        color: seriesColor(i, chartTeams.length),
        eliminatedAt: eliminationByTeam.get(team) || null,
        // buildTeamPoints attaches each week's opponents/scores/event for
        // the tooltip, and trims the leading pre-debut rows -- see its own
        // comment on why a flat 1500 tail would misread as "played and
        // stayed level".
        points: windowToEvent(buildTeamPoints(sourceRun, team, data?.events), scopedEvent),
      }))
      .filter((s) => s.points.length > 0)
  }, [run, dailyRun, chartTeams, data, scopedEvent, eliminationByTeam])

  // Manually building a comparison exits event scope rather than appending
  // to its (possibly 12- or 30-team) field -- picking a team from the
  // dropdown reads as "start a custom comparison", and a custom comparison
  // should get the whole season back, not stay pinned to one event's dates.
  function addChartTeam(team) {
    if (!team) return
    const base = scopedEvent ? [] : chartTeams
    if (base.includes(team)) return
    const next = new URLSearchParams(searchParams)
    next.delete('event')
    next.set('teams', [...base, team].slice(-MAX_SERIES).join(','))
    setSearchParams(next, { replace: true })
  }

  // Clicking a Masters/Champions/Lock-In band scopes the whole chart to it:
  // every team that played there (chartTeams above), rating movement only
  // across the event's own dates (windowToEvent above). Stored as just the
  // event id -- see scopedEvent's comment on why the field/window aren't
  // serialized into the URL alongside it.
  function scopeToEvent(band) {
    const next = new URLSearchParams(searchParams)
    next.delete('teams')
    next.set('event', String(band.id))
    setSearchParams(next, { replace: true })
  }

  function resetChart() {
    const next = new URLSearchParams(searchParams)
    next.delete('teams')
    next.delete('event')
    setSearchParams(next, { replace: true })
  }

  // Grouped from the full table, not from `rows` -- the region tables run
  // their own provisional filter so that toggling it doesn't have to
  // re-derive the grouping.
  const byRegion = useMemo(() => {
    const out = new Map()
    for (const t of run?.table || []) {
      if (!out.has(t.region)) out.set(t.region, [])
      out.get(t.region).push(t)
    }
    return out
  }, [run])

  const summary = useMemo(() => {
    if (!run) return null
    const rated = run.table.filter((t) => !t.provisional)
    return {
      teams: run.table.length,
      rated: rated.length,
      series: run.matches.length,
      periods: run.periods.length,
      medianRd: rated.length
        ? [...rated].sort((a, b) => a.rd - b.rd)[Math.floor(rated.length / 2)].rd
        : null,
    }
  }, [run])

  const columns = useMemo(() => [
    {
      key: 'rank',
      label: '#',
      align: 'right',
      width: RANK_WIDTH,
      format: (v, row) => (
        <span className={row.provisional ? 'text-muted' : 'text-ink'}>{v}</span>
      ),
    },
    {
      key: 'team',
      label: 'Team',
      format: (v, row) => (
        <Link to={`/teams/${encodeURIComponent(v)}`} className="flex items-center gap-2 font-medium hover:text-accent-bright transition-colors">
          {/* TeamLogo renders the name itself (showName defaults on), same
              as every other team column on the site -- don't add another. */}
          <TeamLogo team={v} size={22} />
          {row.provisional && !ALWAYS_SHOWN.has(row.team) && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md text-muted bg-surface2 shrink-0"
              title={`Rating deviation above ${PROVISIONAL_RD} — too few recent series for the rating to have settled.`}
            >
              prov
            </span>
          )}
        </Link>
      ),
    },
    { key: 'region', label: 'Region', format: (v) => regionAbbr(v) },
    {
      key: 'rating',
      label: 'Rating',
      align: 'right',
      colorScale: true,
      format: (v) => num(v),
    },
    {
      key: 'rd',
      label: 'RD',
      align: 'right',
      colorScale: true,
      colorInvert: true,
      format: (v) => num(v),
    },
    {
      key: 'low',
      label: '95% range',
      align: 'right',
      format: (v, row) => <RatingRange row={row} />,
    },
    {
      key: 'lastChange',
      label: 'Last',
      align: 'right',
      format: (v) => {
        if (v == null) return <span className="text-muted">—</span>
        const tone = v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-muted'
        return <span className={tone}>{v > 0 ? '+' : ''}{num(v)}</span>
      },
    },
    {
      key: 'peak',
      label: 'Peak',
      align: 'right',
      format: (v, row) => (v == null
        ? <span className="text-muted">—</span>
        : <span title={`Reached ${shortDate(row.peakDate)}`}>{num(v)}</span>),
    },
    {
      key: 'series',
      label: 'Series',
      align: 'right',
      format: (v, row) => `${row.seriesWins}–${row.seriesLosses}`,
    },
    {
      key: 'seriesWinPct',
      label: 'Series Win%',
      align: 'right',
      colorScale: true,
      format: (v) => pct(v),
    },
    {
      key: 'mapWinPct',
      label: 'Map Win%',
      align: 'right',
      colorScale: true,
      format: (v) => pct(v),
    },
  ], [])

  if (loading || !run) return <div className="text-muted text-sm">Loading…</div>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-semibold text-ink">Glicko-2 team ratings</h1>
          <p className="text-muted text-xs max-w-2xl">
            Every team starts each season unrated at 1500 ± 350 and is rated on series results
            alone. Ratings are rebuilt from scratch for each year, so a 2026 number says nothing
            about 2025.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {yearPills.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setParam('year', y)}
                aria-pressed={y === year}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                style={pillStyle(y === year)}
              >
                {y}
              </button>
            ))}
          </div>
          {/* Was its own header row directly above the ratings table
              ("{year} ratings" + this checkbox) -- moved up under the year
              picker once that header was dropped, since it's a scope
              control for the SAME table the year picker already scopes,
              not something that needs a heading of its own to explain it. */}
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showProvisional}
              onChange={(e) => setShowProvisional(e.target.checked)}
              className="accent-accent"
            />
            Include provisional teams (RD above {PROVISIONAL_RD})
          </label>
        </div>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
          <span><span className="text-ink font-semibold">{summary.rated}</span> rated teams</span>
          <span><span className="text-ink font-semibold">{summary.teams - summary.rated}</span> provisional</span>
          <span><span className="text-ink font-semibold">{num(summary.series)}</span> series</span>
          <span><span className="text-ink font-semibold">{summary.periods}</span> weekly rating periods</span>
          {summary.medianRd != null && (
            <span>median RD <span className="text-ink font-semibold">{num(summary.medianRd)}</span></span>
          )}
        </div>
      )}

      {/* Chart panel, ratings table, and region tables tightened into their
          own gap-3 cluster instead of inheriting the page's outer gap-6 --
          the two <h2> headers that used to separate them ("{year} ratings",
          "By region") are gone (the year picker and the section above it
          already say what's being looked at), so the old spacing between
          these three would otherwise read as an unexplained gap where a
          heading used to sit. */}
      <div className="flex flex-col gap-3">
      <div style={PANEL_STYLE} className="flex flex-col gap-3">
        {chartSeries.length > 0 ? (
          <RatingChart
            series={chartSeries}
            // Once a chart IS an event's own window, a tint spanning
            // (near enough) the whole plot stops being a band -- it's just
            // the background -- so bands only render pre-zoom, when they're
            // still marking out a fraction of a season-long chart. The
            // color carries over as the title's accent swatch instead (see
            // accentColor below), rather than disappearing outright.
            eventBands={scopedEvent ? [] : eventBands}
            onBandClick={scopeToEvent}
            accentColor={scopedEvent ? STAGE_STYLE[scopedEvent.stage]?.color : undefined}
            // Starts one calendar day before the event itself, as a fixed
            // lead-in for the pre-event anchor point (dayBefore above) --
            // see RatingChart's own comment on how that point still
            // contributes its rating without setting the start date itself.
            xDomain={scopedEvent
              ? { start: dayBefore(scopedEvent.start), end: scopedEvent.end }
              : undefined}
            // The dashed "unrated 1500" reference line is a season-long
            // landmark -- where a team started the year -- and has nothing
            // to say about a single event's own window, so it's dropped in
            // event scope rather than drawn against dates it doesn't apply to.
            baseline={scopedEvent ? null : 1500}
            // Lives inline in RatingChart's own team-toggle row as a "+"
            // rather than a separate dropdown up here -- omitted entirely
            // in event scope, same as the dropdown it replaces (that field
            // is derived from the event itself, not a hand-built pick list).
            onAddTeam={scopedEvent ? undefined : addChartTeam}
            addTeamOptions={scopedEvent ? undefined : teamOptions.filter((o) => !chartTeams.includes(o.value))}
            addTeamDisabled={chartTeams.length >= MAX_SERIES}
            height={300}
            title={scopedEvent
              ? scopedEvent.name
              : (chartSeries.length === 1 ? 'Rating over the season' : `${year} title race`)}
            subtitle={scopedEvent
              ? (scopedEvent.teams.length > MAX_EVENT_TEAMS
                  ? `Top ${MAX_EVENT_TEAMS} of ${scopedEvent.teams.length} teams by rating, `
                  : 'Every team that played, ')
                + `${shortDate(scopedEvent.start)}–${shortDate(scopedEvent.end)}. `
                + 'Recomputed daily for this view, so ratings here can drift slightly from the season table.'
              : (chartSeries.length === 1
                ? 'Hover any week for the results that moved it. ± in the tooltip is the 95% interval.'
                : 'Click a team below to mute it. Drop to one team for markers and annotations.')}
            controls={(
              <Button
                variant="outline"
                size="sm"
                onClick={resetChart}
                className="hover:border-accent-bright/40 hover:text-accent-bright"
                title={scopedEvent ? 'Back to this season\'s top teams' : `Back to this season's top ${DEFAULT_CHART_TEAMS}`}
              >
                {scopedEvent ? 'Exit event view' : 'Reset'}
              </Button>
            )}
          />
        ) : (
          <p className="text-xs py-6" style={{ color: RC.textDim }}>Nothing to plot for {year}.</p>
        )}
        <p className="text-[11px]" style={{ color: RC.textDim, opacity: 0.85 }}>
          {scopedEvent
            ? 'One point per day a team played, so a multi-series day still shows as a single step.'
            : 'One point per week a team played. Flat stretches are weeks off — the rating holds, but ' +
              'its deviation widens — the ± figure in the tooltip grows even while the line holds flat.'}
        </p>
      </div>

      <DataTable columns={columns} rows={rows} defaultSortKey="rating" />

      <div className="flex flex-col gap-3">
        <p className="text-muted text-[11px] max-w-xl">
          The same ratings, split by league. Ratings stay comparable across these four tables —
          every team is rated in one pool, and the international events are what tie the regions
          to each other.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {REGION_ORDER.map((region) => (
            <RegionTable
              key={region}
              region={region}
              rows={byRegion.get(region) || []}
              showProvisional={showProvisional}
            />
          ))}
        </div>
      </div>
      </div>

      <Card className="p-4 flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold text-ink">How to read this</h2>
        <p className="text-muted text-xs">
          <span className="text-ink">Rating</span> is the estimate of team strength;{' '}
          <span className="text-ink">RD</span> is how uncertain that estimate is, and the{' '}
          <span className="text-ink">95% range</span> is the interval the system is confident the
          team's true strength sits in. RD shrinks as a team plays and grows again while it sits
          idle, so a team that hasn't played since Kickoff carries a wider range than its
          series count alone suggests.
        </p>
        <p className="text-muted text-xs">
          One game means one series, not one map. Maps inside a Bo3 are the same two rosters on the
          same day, and counting them as independent games makes the system about twice as
          confident as the evidence supports — measured, not assumed.
        </p>
        <p className="text-muted text-xs">
          Tested against every series from 2023 on, predicting each from ratings that existed
          beforehand, the ranking picks the winner{' '}
          <span className="text-ink">{pct(RATINGS_CAVEAT.accuracy)}</span> of the time
          (n={num(RATINGS_CAVEAT.sampleSize)}). That's real signal, but the implied probabilities
          are roughly twice as confident as they should be: teams a rating gap makes 85% favourites
          win about 65% of the time. Teams play too few series in a single season for a
          year-scoped rating to be sharper than that, which is why no win-probability is shown
          anywhere on this page.
        </p>
      </Card>
    </div>
  )
}
