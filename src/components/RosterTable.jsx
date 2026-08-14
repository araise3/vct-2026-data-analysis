import { Link } from 'react-router-dom'
import Flag from './Flag'
import DataTable from './DataTable'
import { rating, pct, num, shortDate } from '../lib/format'
import { coachStintRecord } from '../lib/coaches'

// Same stat-column set (keys, formatting, color scales) as Players.jsx's
// own table -- minus its Team column, redundant here since the whole
// table is already scoped to one team. `roster` rows come from the same
// aggregatePlayerBuckets() call Players.jsx uses, via TeamProfile.jsx's
// `roster` memo, so every field these columns read (kpr/apr/fkpr/fdpr/
// avgEcon/utilMaps included) is already present with no extra plumbing.
// Shared by both the current-season and historical branches below; only
// the Player/Status columns differ between them (Status needs Liquipedia
// lookups that only make sense for the current-season branch), so those
// are built inside the component instead of living here.
const STAT_COLUMNS = [
  { key: 'mapsPlayed', label: 'Maps', align: 'right', format: (v) => num(v) },
  { key: 'roundsPlayed', label: 'RND', align: 'right', format: (v) => num(v) },
  // width pinned: "R"'s single-character header otherwise makes table-
  // layout:auto size this column noticeably narrower than every sibling
  // (measured 46px unpinned vs. a 55-69px cluster for the rest of the
  // stat block, even though its own data -- "1.26" -- is the same length
  // as neighbors like K/D's "1.31") -- a quirk of auto-layout, not a real
  // content need. 60 sits inside that natural cluster rather than
  // reintroducing Players.jsx's own 73px (tuned for a wider table with
  // more columns, including a Team logo one this table doesn't have).
  { key: 'avgRating', label: 'R', align: 'right', colorScale: true, width: 60, format: (v) => rating(v) },
  { key: 'avgAcs', label: 'ACS', align: 'right', colorScale: true, format: (v) => num(v, 0) },
  { key: 'kd', label: 'K/D', align: 'right', colorScale: true, format: (v) => (v ? v.toFixed(2) : '—') },
  { key: 'avgKast', label: 'KAST', align: 'right', colorScale: true, format: (v) => pct(v) },
  { key: 'avgAdr', label: 'ADR', align: 'right', colorScale: true, format: (v) => num(v, 1) },
  { key: 'kpr', label: 'KPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  { key: 'apr', label: 'APR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  { key: 'fkpr', label: 'FKPR', align: 'right', colorScale: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  { key: 'fdpr', label: 'FDPR', align: 'right', colorScale: true, colorInvert: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  { key: 'avgHsPct', label: 'HS%', align: 'right', colorScale: true, format: (v) => pct(v) },
  { key: 'avgEcon', label: 'Econ', align: 'right', colorScale: true, format: (v, r) => (r.utilMaps ? Math.round(v) : '—') },
]

/**
 * The roster block on a team profile -- the page's headline component.
 *
 * Built on the same DataTable component/column layout Players.jsx uses
 * (STAT_COLUMNS above, plus a Player/Status/Active column built below),
 * for both branches -- current-season and historical alike, so a team's
 * roster always reads like the Players page filtered to this team. Only
 * the columns differ: the current-season branch adds a Status column (and
 * a captain star in the Player cell) sourced from Liquipedia, since that
 * data is only meaningful "as of today" -- see `resolveStatus`/`findStintAt`
 * below for how a historical scope still gets a real as-of-that-point
 * answer when it needs one (the Coaching Staff record, Active column).
 * The current-season branch deliberately does NOT pass DataTable a
 * `defaultSortKey`, so it opens on `sortedRows`' own STARTER-first order
 * (see the ROLE_RANK sort below) rather than a plain rating sort -- a
 * click on any column header still re-sorts normally from there, same as
 * every other DataTable on the site.
 *
 * The player table previously had a derived "Role" badge (CORE/
 * ROTATION/STAND-IN, guessed from each player's share of team maps
 * played) because VLR doesn't publish official starter/sub status.
 * That's gone now, replaced with real data from Liquipedia: a captain/
 * IGL indicator, a Starter/Benched status badge, and a real coaching
 * staff section, all sourced from public/data/liquipedia_rosters.json.
 *
 * Status is ONLY Liquipedia's own Active/Inactive table split (labeled
 * Starter/Benched here to match VLR's own terminology) -- a clean,
 * structured, reliable signal. An earlier version additionally tried
 * inferring finer-grained status from that team's History/Timeline
 * prose, which is fragile natural-language parsing; dropped entirely in
 * favor of the reliable table-based signal alone.
 *
 * `rows` (this team's roster) comes from OUR OWN VLR match data --
 * whoever has aggregated stats for this team in the current filter
 * scope, which is NOT the same question as "who is currently on this
 * team". A player who left months ago still has real match history
 * for this team within a wide-enough date range, and would otherwise
 * show up looking like a normal current member with no indication
 * they've departed. Liquipedia's Former Players list (NOT displayed
 * here, only used as a filter) is the ground truth for that: anyone
 * confirmed departed (present in formerPlayers, absent from the
 * current Active/Inactive list) is dropped from `rows` entirely rather
 * than shown unmarked. Confirmed against Natus Vincere specifically --
 * sociablEE, Filu, ComeBack, and Kolosha all have real match stats in
 * scope but have since left per Liquipedia, and were showing up
 * unflagged before this fix.
 */

function activeRange(first, last) {
  if (!first && !last) return '—'
  const a = shortDate(first)
  const b = shortDate(last)
  return a === b ? a : `${a} – ${b}`
}

/**
 * Real status from Liquipedia's own Active/Inactive table split -- labeled
 * Starter/Benched to match VLR's own terminology. An earlier version
 * additionally tried inferring status from that team's History/Timeline
 * prose (natural-language parsing, fragile, ~7% genuinely undetermined
 * even after several rounds of bug fixes); dropped entirely in favor of
 * this reliable table-based signal alone. A later version briefly guessed
 * a status from maps played when Liquipedia had no record at all (an
 * inferred, asterisked badge) -- removed per direct request, now that
 * `currentRows` below only ever admits a player Liquipedia actually
 * confirms, so there is nothing left to guess at.
 *
 * Anything other than the literal STARTER/BENCHED (e.g. SUBSTITUTE, or
 * whatever else Liquipedia's roster table uses in that same slot -- see
 * derive_player_status in build_liquipedia_data.py) renders as a plain
 * neutral badge with that value as its own label, generalizing to values
 * this component doesn't need to know about in advance.
 */
function statusBadge(status) {
  if (!status) return null
  if (status === 'STARTER') return { label: 'STARTER', cls: 'bg-good/15 text-good border-good/30' }
  if (status === 'BENCHED') return { label: 'BENCHED', cls: 'bg-bad/15 text-bad border-bad/30' }
  return { label: status, cls: 'bg-mid/15 text-mid border-mid/30' }
}

export default function RosterTable({ team, rows, liquipedia, matches, coaches = [], asOfDate = null, rosterIsCurrent = true }) {
  // `coaches` is computed once by TeamProfile.jsx (coachesInScope) --
  // whichever Head Coach(es) actually covered the page's currently
  // selected Year/Event scope, not just whoever is coaching today. A
  // scope spanning a coaching change can legitimately list more than one.
  // Each one's record is bounded to their own [joinDate, leaveDate) window
  // (coachStintRecord) AND to the page's own selected scope -- `matches`
  // is TeamProfile.jsx's `matchRows` (already filtered to the current
  // Year/Event picker), not the team's full history, so a coach who
  // straddles a year boundary shows only the wins/losses that happened
  // both during their tenure and within the selected scope. Direct
  // request, reversing an earlier version of this comment that bounded
  // the record to the stint alone regardless of scope -- e.g. Year=2023
  // used to show Chet's WHOLE stint record even though his tenure ran
  // into 2024, which read as "this year's record" but wasn't.
  const lqPlayersById = new Map(
    (liquipedia?.players ?? []).map((p) => [p.id.toLowerCase(), p])
  )

  // Every known Liquipedia STINT for this team, current roster included --
  // unified into ONE per-player timeline so status/inclusion get resolved
  // by matching a single reference DATE against whichever stint actually
  // covers it, instead of always trusting whatever the CURRENT table says
  // regardless of scope. A `liquipedia.players` entry becomes a stint with
  // `leaveDate: null` (still ongoing) so it competes on equal footing with
  // `formerPlayers` entries rather than being checked first no matter what.
  //
  // Real bug this fixes (Gentle Mates, EMEA Stage 1 2026 scope): bipo's
  // CURRENT entry says BENCHED, but Liquipedia separately logs a former
  // stint showing they were a STARTER from 2025-11-20 until being moved to
  // Inactive on 2026-08-05 -- EMEA Stage 1 2026 falls entirely inside that
  // STARTER window, so the row should show STARTER for that scope, not
  // whatever they are TODAY. Checking `liquipedia.players` first (the old
  // behavior) always won with the dateless "current" answer regardless of
  // which period was actually on screen. The same root cause hid GLYPH
  // entirely: he transferred to ENVY on 2026-06-08 (a real former stint,
  // 2025-11-20 to 2026-06-08, fully covering EMEA Stage 1 2026), but the
  // old whitelist below only ever checked `liquipedia.players` (today's
  // roster), which no longer lists him.
  const allStintsById = new Map()
  function addStint(id, stint) {
    const key = id.toLowerCase()
    if (!allStintsById.has(key)) allStintsById.set(key, [])
    allStintsById.get(key).push(stint)
  }
  for (const p of liquipedia?.players ?? []) {
    addStint(p.id, { joinDate: p.joinDate, leaveDate: null, playerStatus: p.playerStatus })
  }
  for (const p of liquipedia?.formerPlayers ?? []) {
    addStint(p.id, { joinDate: p.joinDate, leaveDate: p.leaveDate, playerStatus: p.playerStatus })
  }

  // Picks whichever of a player's stints (current or former) covers ONE
  // shared reference date (`asOfDate`, from TeamProfile.jsx -- the latest
  // date actually in the selected scope, e.g. the last match of Champions
  // when Champions is picked, or of a whole season when a Year chip is
  // picked). Deliberately a single date for the WHOLE roster, not each
  // player's own last-active date -- direct request: selecting a season
  // should show the roster the way it stood at the END of that scope, so
  // a player who started early and was benched before the scope's own
  // last event reads as BENCHED (their status as of THAT point), not
  // STARTER (their status during whichever weeks they personally played).
  // `activeRange`/the Maps/Rounds/Rating columns are unaffected by this --
  // those still reflect the player's own real per-scope activity; only
  // the STATUS badge and roster membership below answer "as of asOfDate".
  //
  // Liquipedia dates can legitimately overlap by a day or two around a
  // handover, and -- the case that actually matters here -- a same-org
  // internal status change (STARTER -> BENCHED with no real departure)
  // can log a former stint sharing the exact same joinDate as the current
  // one still covering `asOfDate` (Gentle Mates' bipo: current BENCHED
  // stint and former STARTER-to-2026-08-05 stint both start 2025-11-20).
  // Ties broken toward the SMALLER span (a bounded dated stint beats an
  // open-ended "current" one covering the same date just as validly),
  // falling back to whichever started more recently when spans also tie.
  function findStintAt(player, date) {
    const stints = allStintsById.get(player.toLowerCase())
    if (!stints || !date) return null
    let best = null
    let bestSpan = Infinity
    for (const s of stints) {
      if (!s.joinDate || s.joinDate > date) continue
      if (s.leaveDate && date >= s.leaveDate) continue
      const span = s.leaveDate ? new Date(s.leaveDate) - new Date(s.joinDate) : Infinity
      if (!best || span < bestSpan || (span === bestSpan && s.joinDate > best.joinDate)) {
        best = s
        bestSpan = span
      }
    }
    return best
  }

  // Only show players Liquipedia has SOME record of on this team as of
  // `asOfDate` -- either a stint covering that date (current or former,
  // via findStintAt above) or, as a belt-and-suspenders fallback for a
  // date mismatch, simply being on the CURRENT roster at all. Not the
  // same question as "who has match stats in scope": a player who left
  // months ago still has real match history for this team within a
  // wide-enough date range, and a scope spanning a whole year can easily
  // contain BOTH a since-departed player's real stats and their
  // replacement's -- showing every name that ever had a stat that year
  // isn't "the roster", it's everyone who ever suited up. Direct request:
  // a past year's roster should be whoever was actually there LAST that
  // year, i.e. exactly the same "confirmed as of asOfDate" test the
  // current season already uses, applied unconditionally rather than only
  // when the scope happens to reach the present.
  //
  // This is also what removes the last real use for guessing: a player
  // Liquipedia has genuinely never recorded on this team at all (the
  // Kolosha case -- real match stats for Natus Vincere, but absent from
  // every one of Liquipedia's Active/Inactive/Former tables, a 7-day
  // stint apparently never logged) no longer gets a special exemption to
  // show up anyway. Fewer rows, but every one of them is a real,
  // Liquipedia-confirmed fact rather than "we have a stat for them
  // somewhere in this scope, who knows when."
  // A team can have real Liquipedia data but literally zero rows here --
  // `rows` only ever contains a player once they have at least one played
  // map's worth of stats (TeamProfile.jsx's `roster` memo filters out
  // anyone with `!mapsPlayed`), so a team that hasn't played its first
  // match yet always has `rows = []` regardless of what Liquipedia says.
  // Real case: Sharper Esports, BESTIA, and several other current Play-Ins
  // participants -- team_buckets.json's `meta` table already knows their
  // name/region from the schedule, but `buckets` has nothing for them yet.
  // Without this, such a team's page was just a header and "No players in
  // this scope" even once Liquipedia coverage existed for it. Built
  // straight from `liquipedia.players` (no stat fields -- there are none
  // yet), so `playerColumn`/`statusColumn` below still work unmodified
  // (they only ever read `row.player`/`row.countryCode`/`row.countryName`),
  // but the STAT_COLUMNS/Active columns are skipped for this branch (see
  // `columns` below) rather than rendering a full row of "—".
  const liquipediaOnlyRows = rosterIsCurrent && liquipedia && rows.length === 0 && liquipedia.players?.length
    ? liquipedia.players.map((p) => ({ player: p.id, countryCode: p.flag, countryName: p.name }))
    : null

  const currentRows = liquipediaOnlyRows
    ? liquipediaOnlyRows
    : rosterIsCurrent && liquipedia
      ? rows.filter((p) => (
        lqPlayersById.has(p.player.toLowerCase()) || findStintAt(p.player, asOfDate)
      ))
      : rows

  // Every row that survives the whitelist above already has a stint
  // covering asOfDate or a current-roster entry (that's exactly what the
  // whitelist just checked), so this always resolves to real Liquipedia
  // data when `liquipedia` exists for the team at all -- there is nothing
  // left to fall back to. BUT the whitelist itself only runs when
  // `liquipedia` is truthy (see `currentRows` above); for a team
  // Liquipedia was never scraped for in the first place (confirmed real
  // case: challenger/Play-In teams outside DEFAULT_TEAMS in
  // liquipedia_roster_scraper.py, which only covers the ~48 VCT partner
  // orgs), `currentRows` falls back to unfiltered `rows` and every lookup
  // here misses -- returning 'BENCHED' in that case would assert a false
  // status for players Liquipedia actually lists as active, which is
  // exactly the bug this function used to have. `null` (no data at all)
  // is therefore a real, distinct answer from `'BENCHED'` (confirmed
  // data, just inactive) -- callers must check `hasLiquipediaData` rather
  // than treat every non-STARTER answer as "benched".
  function resolveStatus(p) {
    if (!liquipedia) return null
    const stint = findStintAt(p.player, asOfDate)
    if (stint) return stint.playerStatus
    const current = lqPlayersById.get(p.player.toLowerCase())?.playerStatus
    if (current) return current
    return 'BENCHED'
  }

  // Sorted by role, starters first -- Array.prototype.sort is stable
  // (guaranteed since ES2019), so within each tier this preserves
  // whatever order currentRows already came in (rating desc, set by
  // TeamProfile.jsx), it doesn't need its own secondary sort key here.
  // A middle tier for anything other than the literal STARTER/BENCHED
  // (SUBSTITUTE, STAND-IN, INACTIVE, or whatever other note Liquipedia's
  // roster table carries -- see statusBadge above) reads as "still on
  // the active roster, just not starting", which belongs between full
  // starters and fully benched players rather than arbitrarily lumped
  // with either.
  // A purely historical scope (rosterIsCurrent === false) has no
  // Liquipedia-derived status to rank by -- `currentRows` above is just
  // `rows` unfiltered in that case, already rating-desc from
  // TeamProfile.jsx's `roster` memo, so there's nothing to re-sort here.
  // No Liquipedia data at all for this team (see resolveStatus's own
  // comment) means no real STARTER/BENCHED signal to rank by -- sorting
  // would just be `roleRank(null)` ties, i.e. currentRows' incoming order
  // anyway, so skip it outright rather than call resolveStatus for no
  // reason.
  const ROLE_RANK = { STARTER: 0, BENCHED: 2 }
  const roleRank = (status) => ROLE_RANK[status] ?? 1
  const sortedRows = rosterIsCurrent && liquipedia
    ? [...currentRows].sort((a, b) => roleRank(resolveStatus(a)) - roleRank(resolveStatus(b)))
    : currentRows

  // Player/Status columns are built here rather than living in the
  // module-level STAT_COLUMNS array because they need lqPlayersById/
  // resolveStatus/statusBadge above, all of which close over this
  // render's own `liquipedia`/`asOfDate` props. Status (and the captain
  // star inside Player) is Liquipedia's own real-time record, so it's
  // only meaningful -- and only included -- on the current-season branch;
  // a historical scope has no such column at all, matching how it never
  // did on this table before it moved to DataTable either.
  const playerColumn = {
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
        {rosterIsCurrent && lqPlayersById.get(v.toLowerCase())?.captain && (
          <span className="text-accent text-xs shrink-0" title="Team captain / IGL">★</span>
        )}
      </div>
    ),
  }
  const statusColumn = {
    key: 'status', label: 'Status', align: 'left',
    // No `status` field on the row itself -- resolved per-row from
    // Liquipedia via resolveStatus, same as the Active column resolves
    // its own value from firstDate/lastDate rather than a stored field.
    format: (v, row) => {
      const badge = statusBadge(resolveStatus(row))
      return badge && (
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${badge.cls}`}>
          {badge.label}
        </span>
      )
    },
  }
  const activeColumn = {
    key: 'active', label: 'Active', align: 'right',
    format: (v, row) => activeRange(row.firstDate, row.lastDate),
  }
  // Status column only when there's real Liquipedia data to back it --
  // omitted entirely (not just blank) for a team Liquipedia was never
  // scraped for, rather than rendering a "Status" header over empty
  // cells with no explanation. `liquipediaOnlyRows` additionally drops
  // Active/STAT_COLUMNS -- every one of those fields is genuinely absent
  // (not just zero) for a player with no match stats yet, so showing them
  // would just be a full row of "—" per player rather than useful signal.
  const columns = liquipediaOnlyRows
    ? [playerColumn, statusColumn]
    : rosterIsCurrent && liquipedia
      ? [playerColumn, statusColumn, activeColumn, ...STAT_COLUMNS]
      : [playerColumn, activeColumn, ...STAT_COLUMNS]

  return (
    <div className="flex flex-col gap-4">
      {coaches.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold text-ink">Coaching Staff</h2>
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm divide-y divide-hairline">
            {coaches.map((coach) => {
              const coachRecord = coachStintRecord(matches, team, coach.joinDate, coach.leaveDate)
              return (
                <div key={`${coach.id}-${coach.joinDate}`} className="flex items-center justify-between px-5 py-3">
                  <Link
                    to={`/coaches/${encodeURIComponent(coach.id)}`}
                    className="text-sm text-ink font-medium flex items-center gap-2 hover:text-accent-bright transition-colors"
                  >
                    <Flag countryCode={coach.flag} countryName={coach.name} size={16} />
                    {coach.id}
                  </Link>
                  <div className="flex items-center gap-6 text-xs text-muted">
                    <span>Head Coach</span>
                    {coach.joinDate && (
                      <span>
                        {coach.leaveDate
                          ? `${shortDate(coach.joinDate)} – ${shortDate(coach.leaveDate)}`
                          : `Since ${shortDate(coach.joinDate)}`}
                      </span>
                    )}
                    {coachRecord && (
                      <span className={`font-medium ${coachRecord.winPct >= 0.5 ? 'text-good' : 'text-bad'}`}>
                        {coachRecord.wins}–{coachRecord.losses} ({pct(coachRecord.winPct)})
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="font-display text-sm font-semibold text-ink">Players of {team}</h2>
          <p className="text-muted text-xs">Reflects the filters above.</p>
        </div>

        {sortedRows.length === 0 ? (
          <div className="bg-grad-surface border border-hairline rounded-2xl shadow-depth-sm px-4 py-4 text-muted text-xs">
            No players in this scope.
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={sortedRows}
            // Historical: no role concept to preserve, so it opens sorted
            // by rating like every other DataTable on the site. Current
            // season: omitting this leaves `sorted` on its incoming order
            // (see DataTable's own `if (!sortKey) return rows`), which is
            // `sortedRows`' STARTER-first, rating-desc-within-tier order --
            // that's the "keep the Liquipedia active/inactive logic" part
            // of this table, still fully clickable/sortable from there.
            defaultSortKey={rosterIsCurrent ? undefined : 'avgRating'}
          />
        )}

        <p className="text-muted text-xs leading-relaxed">
          {liquipediaOnlyRows ? (
            <>
              This team has no completed matches in our data yet, so there are no stats to show --
              roster and status below are Liquipedia's current record on their own. Roster/status
              data from{' '}
              <a
                href="https://liquipedia.net/valorant"
                target="_blank"
                rel="noreferrer"
                className="hover:text-accent-bright transition-colors underline"
              >
                Liquipedia
              </a>
              , licensed CC-BY-SA 3.0.
            </>
          ) : rosterIsCurrent && liquipedia ? (
            <>
              Active is the first and last match week the player appeared in for this team, resolved
              to that week's actual play dates. Roster and status reflect Liquipedia's own record as
              of the most recent event in the selected scope -- a player benched (or gone) by that
              point shows that way even if they started earlier in the scope. Roster/captain/status
              data from{' '}
              <a
                href="https://liquipedia.net/valorant"
                target="_blank"
                rel="noreferrer"
                className="hover:text-accent-bright transition-colors underline"
              >
                Liquipedia
              </a>
              , licensed CC-BY-SA 3.0.
            </>
          ) : rosterIsCurrent ? (
            <>
              This team isn't covered by our Liquipedia roster data (currently limited to VCT partner
              orgs), so there's no Starter/Benched record or captain marker to show -- the roster below
              is simply every player with real stats for this team in the selected scope.
            </>
          ) : (
            <>
              This scope doesn't reach the team's current season, so the roster shows every player
              with real stats for this team in scope instead of Liquipedia's (present-day-only)
              Starter/Benched record -- a mid-season transfer already shows correctly on each team's
              own page, since every stat is tagged to the team it was actually played for.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
