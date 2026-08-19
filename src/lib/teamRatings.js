/**
 * Glicko-2 team ratings, scoped per calendar year.
 *
 * This is the domain half; the algorithm itself is in glicko2.js, kept free
 * of anything VALORANT-shaped so it can be checked against Glickman's paper
 * line by line (it is -- glicko2.js reproduces the paper's worked example).
 * Everything here is a judgement call about how to map a VCT season onto
 * the system's assumptions.
 *
 * Every one of those calls was swept against held-out predictive log loss
 * before being fixed in place, and the intuitive answer lost twice: maps
 * looked like the obvious game unit and are clearly worse than series, and
 * tau -- the one constant the paper asks you to tune -- turned out to make
 * no measurable difference here at all. The numbers behind each choice are
 * in the comments below, and the honest summary of all of them is in
 * RATINGS_CAVEAT: this ranks teams credibly, and its probabilities are
 * roughly twice as confident as they should be.
 *
 * Source data is `match_results.json` (one row per series). Nothing is
 * precomputed into `public/data/`: the run is a few milliseconds over ~2000
 * series, and the data pipeline is a scheduled GitHub Action that can't be
 * exercised locally (see CLAUDE.md), so deriving ratings in the browser
 * keeps them in lockstep with whatever match data `main` currently carries
 * rather than adding a second artefact that has to be regenerated.
 *
 * Note this deliberately does NOT plug into useFacetedFilter like every
 * other page's numbers do. A Glicko-2 rating is path-dependent: it's the
 * end state of a sequence of updates over every game in order, so there's
 * no such thing as "this team's rating, playoffs only" -- dropping the
 * group stage doesn't filter the rating, it computes a different rating
 * from a different tournament history. The only coherent scope is a whole
 * self-contained run, which is why the page offers a year picker rather
 * than the usual facet panel.
 */

import {
  DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, DEFAULT_TAU,
  updatePlayer, applyInactivity, ratingInterval, winProbability,
} from './glicko2'

/**
 * One game = one SERIES, not one map.
 *
 * Maps look like the better unit -- there are 4960 of them against 1961
 * series, and a per-year run is sample-starved either way -- and that was
 * the first implementation. Measured over 2023-2026 it is decisively worse:
 *
 *   unit     log loss   Brier    calibration slope   median end-of-year RD
 *   map       0.7635    0.2604         0.44                   68
 *   series    0.6985    0.2467         0.52                  101
 *
 * (Coin flip is 0.6931 / 0.2500. Calibration slope is the actual outcome
 * regressed on the predicted probability across probability bins; 1.0 is
 * perfect, below 1 is overconfident.)
 *
 * The reason is independence, which Glicko-2 assumes and maps violate:
 * maps inside one Bo3 are the same two rosters, on the same day, on the
 * same patch, with the same read on each other. Counting them as three
 * independent games shrinks RD roughly twice as fast as the evidence
 * justifies, and an RD that is too small is a rating that is too confident
 * -- which is exactly what the table shows. A series is both the unit the
 * teams actually contest and the unit whose outcomes are near-independent,
 * so that is the unit rated here.
 *
 * The cost is real and accepted: a 2-0 and a 2-1 are identical evidence to
 * this system. Feeding the map margin back in as a fractional score
 * (s = mapsWon / mapsPlayed, so a 2-1 scores 0.67) was tried and is worse
 * than binary series outcomes (0.7125 / 0.2488) -- it reintroduces the
 * correlated-map problem in a softer form without adding real information.
 * Round differential is left out for the same reason plus a stronger one:
 * it isn't part of Glicko-2, and bolting it on would make this
 * "Glicko-2-ish" rather than Glicko-2.
 */
export const GAME_UNIT = 'series'

/**
 * One rating period = one calendar week.
 *
 * The period is the window the system pretends happened simultaneously, so
 * its length trades sample size against staleness. Glickman asks for 10-15
 * games per competitor per period, which nothing in this data can supply --
 * the median team plays 13-23 series in an entire year. So the choice is
 * really only about how stale a rating gets before it updates, and shorter
 * wins:
 *
 *   period       log loss   Brier    accuracy
 *   day           0.6920    0.2437     59.1%
 *   week          0.6985    0.2467     59.3%
 *   half-month    0.6978    0.2466     60.3%
 *   month         0.7119    0.2520     58.9%
 *
 * Day through half-month are within noise of each other (n=1788; the spread
 * between them is smaller than the standard error), and month is clearly
 * off the pace. Week is picked from inside that indistinguishable band on
 * non-predictive grounds: it's the unit the VCT calendar is actually built
 * in -- the source data labels its own rows "Week 1", "Week 2" -- and it
 * gives the trend chart a readable number of points, where daily periods
 * would give it one per match day.
 *
 * Weeks also handle the calendar's long gaps correctly for free: a team
 * idle between Kickoff and Champions collects Step 6 decay for every week
 * it sat out, so it arrives with an honestly widened RD rather than a
 * stale-but-confident number.
 */
export function periodOf(date) {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() - t.getUTCDay())
  return t.toISOString().slice(0, 10)
}

/**
 * tau stays at the paper's default 0.5, because sweeping it changed
 * nothing: 0.2, 0.3, 0.5, 0.8 and 1.2 all produce a log loss of 0.6911 and
 * a Brier score of 0.2435 -- identical to four decimal places.
 *
 * That non-result is informative rather than a bug. tau constrains how fast
 * volatility may move, and volatility only moves when results are
 * surprising *relative to how uncertain the system already is*. With RD
 * sitting near 100 all season almost nothing clears that bar, so sigma
 * never leaves 0.06 and the constant governing its speed never gets to
 * matter. It would start to bite on a longer, denser history -- which is
 * exactly what per-year scoping rules out.
 */
export const TAU = DEFAULT_TAU

/**
 * A rating is provisional while its RD is above this.
 *
 * Gated on RD rather than on a games-played count, because RD *is* the
 * system's own statement of how much it trusts the number, and it already
 * accounts for something a game count misses -- notably a team that played
 * a full split and then went quiet for four months, whose rating deserves
 * the same scepticism as a debutant's.
 *
 * 150 is where the two populations separate rather than an arbitrary round
 * number. End-of-year RD by series played: median 222 at 1-4 series, 176 at
 * 5-8, 138 at 9-12, 118 at 13-20, 87 at 21+. Teams with a real season land
 * at 75-120; three-series EWC-qualifier entrants land near 200. Nothing
 * sits on the boundary.
 */
export const PROVISIONAL_RD = 150

/**
 * What the page has to tell the reader, kept next to the code that earns it
 * so the two can't drift apart.
 *
 * Prequential evaluation over 2023-2026 -- every series predicted from
 * ratings that existed before its rating period began, counting only series
 * where both teams were already rated: log loss 0.6985 against a coin
 * flip's 0.6931, accuracy 59.3%, calibration slope 0.52.
 *
 * So the ordering carries real signal -- 59% on series outcomes is well
 * above chance -- but the probabilities are about twice as confident as
 * they should be: series this system calls at 85% are won about 65% of the
 * time. That isn't an implementation error, it's the small-sample reality
 * of the scoping. A team plays 13-23 series a year and the run resets every
 * January, so the spread of estimated ratings is inflated by estimation
 * noise that RD alone doesn't fully absorb. It's why the UI shows no
 * win-probability column anywhere: the ranking is worth showing, a "78% to
 * win" derived from it would not be.
 *
 * The yearly reset is the cheaper half of that, for reference. One
 * continuous 2023-2026 run scores 0.6798 / 60.3% against the per-year
 * 0.6985 / 59.3% -- so scoping costs about 0.019 of log loss and a point of
 * accuracy, and buys a 2026 number that means 2026 form and nothing else.
 */
export const RATINGS_CAVEAT = {
  logLoss: 0.6985,
  coinFlipLogLoss: 0.6931,
  accuracy: 0.593,
  calibrationSlope: 0.52,
  sampleSize: 1788,
}

/**
 * Series format, read exactly off the scoreline rather than guessed from
 * the map count: the winner's score IS the format's win threshold (1 = Bo1,
 * 2 = Bo3, 3 = Bo5), and every row satisfies s1 + s2 === maps.length, so
 * there's nothing ambiguous to resolve. Display only -- the rating itself
 * treats every series as one game regardless of length.
 */
export function bestOfFor(row) {
  return Math.max(row.s1, row.s2) * 2 - 1
}

function sortedRows(data) {
  const rows = (data?.rows || []).filter(
    (r) => r.team1 && r.team2 && r.s1 != null && r.s2 != null && r.s1 !== r.s2
  )
  // `ts` is a full timestamp and `date` only a day; sort on ts where it
  // exists so two series on the same day still resolve in real order. Order
  // within a period doesn't affect the ratings (a period is simultaneous by
  // construction) but it does set the order of the per-series rows the UI
  // lists.
  return rows.sort((a, b) => (a.ts || a.date).localeCompare(b.ts || b.date))
}

/**
 * Region shown next to a team, derived from the events it actually played
 * rather than read out of `team_buckets.json` -- that file is 1.9MB and
 * this page would want exactly one string per team from it. A team's league
 * region is whichever non-International region it appears in most; teams
 * seen only at international events keep "International".
 */
function regionsByTeam(data, rows) {
  const counts = new Map()
  for (const r of rows) {
    const region = data.events?.[String(r.e)]?.region
    if (!region) continue
    for (const team of [r.team1, r.team2]) {
      if (!counts.has(team)) counts.set(team, new Map())
      const m = counts.get(team)
      m.set(region, (m.get(region) || 0) + 1)
    }
  }
  const out = new Map()
  for (const [team, m] of counts) {
    let best = null
    let bestN = -1
    for (const [region, n] of m) {
      if (region === 'International') continue
      if (n > bestN) { best = region; bestN = n }
    }
    out.set(team, best || 'International')
  }
  return out
}

const UNRATED = { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL }

/**
 * Run the system over one year's series.
 *
 * Every team enters at the paper's unrated defaults (1500 / 350 / 0.06) in
 * its first period of the year -- that's what "scoped to each year" means
 * here: independent runs, with no rating, RD or volatility crossing the New
 * Year boundary.
 *
 * `unit` and `period` are options rather than hardcoded constants purely so
 * the sweep that chose them can be re-run against the shipped code; the
 * defaults are the measured winners.
 *
 * Returns the final table, per-period history for plotting, and one row per
 * series carrying the ratings both teams held going into it.
 */
export function buildYearRun(rows, regions, {
  tau = TAU, unit = GAME_UNIT, period: periodFn = periodOf,
} = {}) {
  const state = new Map()     // team -> { rating, rd, vol }
  const stats = new Map()     // team -> counters
  const history = new Map()   // team -> [{ period, date, rating, rd, ... }]
  const matches = []

  const periods = []
  const byPeriod = new Map()
  for (const row of rows) {
    const key = periodFn(row.date)
    if (!byPeriod.has(key)) { byPeriod.set(key, []); periods.push(key) }
    byPeriod.get(key).push(row)
  }

  function statsFor(team) {
    if (!stats.has(team)) {
      stats.set(team, {
        team,
        maps: 0, mapWins: 0, mapLosses: 0,
        series: 0, seriesWins: 0, seriesLosses: 0,
        peak: null, peakDate: null,
      })
    }
    return stats.get(team)
  }

  for (const period of periods) {
    const periodRows = byPeriod.get(period)
    const lastDate = periodRows[periodRows.length - 1].date

    // Snapshot every rating at the start of the period. A rating period's
    // games are simultaneous by definition, so opponents must be read at
    // their pre-period value even when they also played earlier the same
    // week -- updating in place while walking the rows would quietly turn
    // this into a sequential, Elo-like system instead.
    const atStart = new Map(state)
    const played = new Map()

    for (const row of periodRows) {
      const a = atStart.get(row.team1) || UNRATED
      const b = atStart.get(row.team2) || UNRATED
      const team1Won = row.s1 > row.s2

      matches.push({
        id: row.id,
        date: row.date,
        period,
        event: row.e,
        team1: row.team1,
        team2: row.team2,
        s1: row.s1,
        s2: row.s2,
        bestOf: bestOfFor(row),
        // Both teams exactly as they stood going into this series -- never
        // a number informed by the result it's being compared against.
        r1: a.rating, rd1: a.rd,
        r2: b.rating, rd2: b.rd,
        // Positive when the winner was the lower-rated side: the size of
        // the upset, in rating points.
        upset: team1Won ? b.rating - a.rating : a.rating - b.rating,
        seriesProb: winProbability(a, b),
        // Both teams already rated in an earlier period. The only rows a
        // fair predictive score may count, since a 1500-vs-1500 debut is a
        // forced coin flip rather than a forecast.
        rated: state.has(row.team1) && state.has(row.team2),
      })

      const s1 = statsFor(row.team1)
      const s2 = statsFor(row.team2)
      s1.series += 1
      s2.series += 1
      if (team1Won) { s1.seriesWins += 1; s2.seriesLosses += 1 }
      else { s2.seriesWins += 1; s1.seriesLosses += 1 }

      // Map counts are display-only -- the rating never sees them.
      for (const m of row.maps || []) {
        if (m.s1 == null || m.s2 == null || (!m.s1 && !m.s2)) continue
        s1.maps += 1
        s2.maps += 1
        if (m.s1 > m.s2) { s1.mapWins += 1; s2.mapLosses += 1 }
        else { s2.mapWins += 1; s1.mapLosses += 1 }
      }

      if (!played.has(row.team1)) played.set(row.team1, [])
      if (!played.has(row.team2)) played.set(row.team2, [])
      if (unit === 'map') {
        for (const m of row.maps || []) {
          if (m.s1 == null || m.s2 == null || (!m.s1 && !m.s2)) continue
          played.get(row.team1).push({ rating: b.rating, rd: b.rd, score: m.s1 > m.s2 ? 1 : 0 })
          played.get(row.team2).push({ rating: a.rating, rd: a.rd, score: m.s1 > m.s2 ? 0 : 1 })
        }
      } else {
        const score = unit === 'seriesFraction' ? row.s1 / (row.s1 + row.s2) : (team1Won ? 1 : 0)
        played.get(row.team1).push({ rating: b.rating, rd: b.rd, score })
        played.get(row.team2).push({ rating: a.rating, rd: a.rd, score: 1 - score })
      }
    }

    // Teams that played get the full update; teams already in the run that
    // sat this period out get Step 6 alone. Teams that haven't debuted yet
    // are left untouched -- they must not accrue decay for weeks they were
    // not part of, or a Champions-only entrant would arrive rated worse
    // than an unrated team.
    for (const [team, results] of played) {
      state.set(team, updatePlayer(atStart.get(team) || UNRATED, results, tau))
    }
    for (const [team, player] of atStart) {
      if (!played.has(team)) state.set(team, applyInactivity(player))
    }

    for (const [team, player] of state) {
      const st = statsFor(team)
      // Peak only counts periods where the rating was actually settled.
      // Without the RD gate the column fills up with numbers a team held
      // for one week on a 3-0 start at +/-400 uncertainty -- Nongshim
      // RedForce's 2026 "peak" was 2116 that way, against a 1737 finish.
      // A peak nobody could have believed at the time isn't a peak.
      if (player.rd <= PROVISIONAL_RD && (st.peak === null || player.rating > st.peak)) {
        st.peak = player.rating
        st.peakDate = lastDate
      }
      if (!history.has(team)) history.set(team, [])
      history.get(team).push({
        period,
        date: lastDate,
        rating: player.rating,
        rd: player.rd,
        vol: player.vol,
        games: played.get(team)?.length || 0,
      })
    }
  }

  const table = []
  for (const [team, player] of state) {
    const st = stats.get(team)
    const [low, high] = ratingInterval(player)
    const hist = history.get(team) || []
    // "Last move" is the change across the most recent period this team
    // actually played, not the most recent period on the calendar -- an
    // idle team's rating doesn't move, and a run of 0.0s would read as flat
    // form rather than as absence.
    let lastActive = -1
    hist.forEach((h, i) => { if (h.games > 0) lastActive = i })
    const prev = lastActive > 0 ? hist[lastActive - 1] : null
    table.push({
      ...st,
      region: regions.get(team) || '—',
      rating: player.rating,
      rd: player.rd,
      vol: player.vol,
      low,
      high,
      provisional: player.rd > PROVISIONAL_RD,
      lastChange: prev ? hist[lastActive].rating - prev.rating : null,
      lastPlayed: lastActive >= 0 ? hist[lastActive].date : null,
      mapWinPct: st.maps ? st.mapWins / st.maps : null,
      seriesWinPct: st.series ? st.seriesWins / st.series : null,
    })
  }
  table.sort((a, b) => b.rating - a.rating)

  return { table, history, periods, matches }
}

/**
 * Every year in the data, each as its own independent run, keyed by year
 * and ordered newest first. Building all of them costs a few milliseconds
 * in total, so there's no laziness worth the complexity.
 */
export function buildRatings(data, opts = {}) {
  const rows = sortedRows(data)
  const regions = regionsByTeam(data, rows)

  const byYear = new Map()
  for (const row of rows) {
    const year = data.events?.[String(row.e)]?.year ?? Number(row.date.slice(0, 4))
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year).push(row)
  }

  const runs = new Map()
  for (const [year, yearRows] of [...byYear].sort((a, b) => b[0] - a[0])) {
    runs.set(year, buildYearRun(yearRows, regions, opts))
  }
  return runs
}

/**
 * One team's plottable rating history, enriched with the results that
 * caused each move.
 *
 * Presentation-facing only -- it reads the finished run and joins it back
 * against the run's own per-series rows. Nothing here feeds the rating
 * calculation, which is complete before this is ever called.
 *
 * `events` is the raw `match_results.json` events table, used only to turn
 * a bucket's event id into a name for the tooltip.
 */
export function buildTeamPoints(run, team, events) {
  const hist = run?.history?.get(team)
  if (!hist) return []

  // Series indexed by the rating period they fell in, so each point can
  // name the opponents that moved it.
  const byPeriod = new Map()
  for (const m of run.matches) {
    if (m.team1 !== team && m.team2 !== team) continue
    if (!byPeriod.has(m.period)) byPeriod.set(m.period, [])
    const isTeam1 = m.team1 === team
    byPeriod.get(m.period).push({
      opponent: isTeam1 ? m.team2 : m.team1,
      score: isTeam1 ? `${m.s1}–${m.s2}` : `${m.s2}–${m.s1}`,
      won: isTeam1 ? m.s1 > m.s2 : m.s2 > m.s1,
      event: events?.[String(m.event)]?.name ?? null,
      date: m.date,
    })
  }

  // History carries a row for every period once a team enters the run;
  // anything before its first game would draw a flat 1500 tail that reads
  // as "played and stayed level" rather than "wasn't there yet".
  const first = hist.findIndex((h) => h.games > 0)
  if (first === -1) return []

  // `change` is measured against the previous period this team PLAYED, not
  // the previous row -- idle weeks don't move a rating, so diffing against
  // one would report a 0 that looks like a drawn week rather than a break.
  let lastPlayedRating = null
  return hist.slice(first).map((h) => {
    const change = h.games > 0 && lastPlayedRating != null ? h.rating - lastPlayedRating : null
    if (h.games > 0) lastPlayedRating = h.rating
    return {
      date: h.date,
      period: h.period,
      rating: h.rating,
      rd: h.rd,
      low: h.rating - 2 * h.rd,
      high: h.rating + 2 * h.rd,
      games: h.games,
      settled: h.rd <= PROVISIONAL_RD,
      change,
      results: byPeriod.get(h.period) || [],
    }
  })
}

/**
 * How a team's rank has moved since the last week it played, overall and
 * within its own region.
 *
 * Ranks are taken among settled ratings at each of the two periods, the
 * same rule the tables use -- a provisional team on a 3-0 start shouldn't
 * shunt everyone below it down a place and manufacture movement arrows on
 * profiles that had a quiet week.
 *
 * Returns null when there's no earlier period to compare against, which is
 * the caller's cue to show no indicator at all rather than a zero.
 */
export function rankMovementFor(run, team, region) {
  const hist = run?.history?.get(team)
  if (!hist) return null

  const activeIdx = []
  hist.forEach((h, i) => { if (h.games > 0) activeIdx.push(i) })
  if (activeIdx.length < 2) return null
  const nowPeriod = hist[activeIdx[activeIdx.length - 1]].period
  const thenPeriod = hist[activeIdx[activeIdx.length - 2]].period

  function ranksAt(period) {
    const standing = []
    for (const [t, rows] of run.history) {
      const row = rows.find((r) => r.period === period)
      if (!row || row.rd > PROVISIONAL_RD) continue
      standing.push({ team: t, rating: row.rating })
    }
    standing.sort((a, b) => b.rating - a.rating)
    const overall = standing.findIndex((s) => s.team === team)
    const regional = region
      ? standing.filter((s) => (run.table.find((t) => t.team === s.team)?.region) === region)
      : standing
    const inRegion = regional.findIndex((s) => s.team === team)
    return {
      overall: overall === -1 ? null : overall + 1,
      region: inRegion === -1 ? null : inRegion + 1,
    }
  }

  const now = ranksAt(nowPeriod)
  const then = ranksAt(thenPeriod)
  const delta = (a, b) => (a == null || b == null ? null : b - a) // positive = moved up
  return {
    overall: delta(now.overall, then.overall),
    region: delta(now.region, then.region),
  }
}
