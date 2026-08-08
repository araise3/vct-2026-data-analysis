import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { expandMatchRows } from '../lib/entityBuckets'
import { stageStructureFor } from '../lib/tournamentStructure'
import {
  computeGroupRecords, remainingFixtures, buildGroupStandings, simulateQualifyingOdds,
} from '../lib/qualifyingOdds'
import MatchHistory from '../components/MatchHistory'
import EventLogo from '../components/EventLogo'
import TeamLogo from '../components/TeamLogo'
import BracketTree from '../components/BracketTree'
import StageTabs from '../components/StageTabs'
import { eventLabel, phaseLabel, pct, num } from '../lib/format'

const th = 'px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted'
const thNowrap = `${th} whitespace-nowrap`
const td = 'px-3 py-2 text-sm whitespace-nowrap align-middle'

/**
 * Per-tournament page: group standings (real, tiebreak-ranked -- never
 * user-sortable, since a click-to-resort DataTable would misrepresent a
 * rank that's the output of a 5-step recursive tiebreak chain, not a
 * single column value) plus simulated qualifying odds while a group's
 * round-robin still has fixtures left, plus the Play-Ins/Playoffs bracket
 * skeleton -- for the handful of events `tournament_structure.json`
 * actually covers (see that file's own TARGET_STAGES comment: only
 * currently-live/incomplete stages). Every other event (the ~50 completed/
 * historical ones) falls back to the same phase-grouped flat match list
 * Tournaments.jsx already shows inline, so this is never a dead page.
 */
export default function TournamentDetail() {
  const { event } = useParams()
  const decodedEvent = decodeURIComponent(event)

  const { data: matchData, loading: matchesLoading } = useData('match_results')
  const { data: tournamentData } = useData('tournament_structure')
  const { data: eventsData } = useData('events')

  const matches = useMemo(
    () => expandMatchRows(matchData).filter((m) => m.event === decodedEvent),
    [matchData, decodedEvent]
  )

  const stage = useMemo(
    () => stageStructureFor(tournamentData, eventsData, decodedEvent),
    [tournamentData, eventsData, decodedEvent]
  )

  // One computation per group: real records from this site's own match
  // data, the official-tiebreak-ranked standings, and -- only while any
  // round-robin fixtures remain -- simulated qualifying odds per seed
  // outcome. `trials` kept modest (4000) for a synchronous render; this
  // runs in well under a frame for a 6-team group (confirmed against the
  // sanity-check script -- a few thousand tiny simulated Bo3s plus a rank
  // pass each).
  const groupResults = useMemo(() => {
    if (!stage) return null
    const out = {}
    for (const [groupName, group] of Object.entries(stage.groups)) {
      const records = computeGroupRecords(matches, group.teams)
      const fixtures = remainingFixtures(records, group.teams)
      const standings = buildGroupStandings(records, stage.tiebreakers)
      const odds = fixtures.length
        ? simulateQualifyingOdds(records, group.teams, fixtures, stage.tiebreakers, stage.seedOutcomes, 4000)
        : null
      out[groupName] = { standings, fixtures, odds }
    }
    return out
  }, [stage, matches])

  // Stage tabs (rft.gg-style "TOURNAMENT STAGES" strip): what the tabs ARE
  // is decided here, per event -- structured events (tournament_structure.
  // json coverage) get a Group Stage tab plus one per non-empty bracket;
  // every other event falls back to one tab per chronological phase of its
  // own flat match list. StageTabs itself has no idea which case it's in.
  const tabs = useMemo(() => {
    if (stage) {
      const out = [{
        id: 'group',
        label: 'Group Stage',
        content: (
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(stage.groups).map(([groupName]) => (
              <GroupStandings
                key={groupName}
                title={groupName}
                stage={stage}
                result={groupResults[groupName]}
              />
            ))}
          </div>
        ),
      }]
      if (stage.brackets?.playIns?.length > 0) {
        out.push({ id: 'playIns', label: 'Play-Ins', content: <BracketTree rounds={stage.brackets.playIns} /> })
      }
      if (stage.brackets?.playoffs?.length > 0) {
        out.push({ id: 'playoffs', label: 'Playoffs', content: <BracketTree rounds={stage.brackets.playoffs} /> })
      }
      return out
    }

    const byPhase = new Map()
    for (const m of [...matches].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id)) {
      const p = phaseLabel(m.w) || 'Matches'
      if (!byPhase.has(p)) byPhase.set(p, [])
      byPhase.get(p).push(m)
    }
    return [...byPhase.entries()].map(([phase, phaseMatches]) => ({
      id: phase,
      label: phase,
      badge: phaseMatches.length,
      content: <MatchHistory matches={phaseMatches} perspective={null} showEvent={false} />,
    }))
  }, [stage, groupResults, matches])

  if (matchesLoading) return <div className="text-muted text-sm">Loading…</div>

  if (matches.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/tournaments" className="text-sm text-muted hover:text-ink w-fit">← Back to Tournaments</Link>
        <p className="text-muted text-sm">No tournament found matching "{decodedEvent}".</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/tournaments" className="text-sm text-muted hover:text-ink w-fit">← Back to Tournaments</Link>

      <div className="flex items-center gap-3">
        <EventLogo event={decodedEvent} size={36} />
        <h1 className="font-display text-2xl font-semibold text-ink">{eventLabel(decodedEvent)}</h1>
      </div>

      <StageTabs key={decodedEvent} tabs={tabs} />
    </div>
  )
}

// Every distinct outcome slug across `stage.seedOutcomes` (rank 1..N),
// stage-level and shared by every group in it -- a FIXED column set per
// stage, not derived from any one group's current provisional standings
// (a team sitting 4th today can still have nonzero simulated odds for the
// rank-1/2 bucket, so the columns must cover every possible outcome, not
// just whichever ranks happen to be occupied right now). The number of
// distinct outcomes varies by region: China Stage 2 2026 groups both
// top-2 seeds into one shared outcome; the other three regions split rank
// 1 (bye) from rank 2 (Upper Bracket Round 1).
function outcomeColumns(seedOutcomes) {
  const seen = new Map()
  for (const rank of Object.keys(seedOutcomes || {}).sort((a, b) => Number(a) - Number(b))) {
    const o = seedOutcomes[rank]
    if (o && !seen.has(o.slug)) seen.set(o.slug, o.text)
  }
  return [...seen.entries()]
}

function GroupStandings({ title, stage, result }) {
  const { standings, fixtures, odds } = result
  const annotated = standings.map((r, i) => {
    const seed = stage.seedOutcomes?.[String(i + 1)]
    return { ...r, rank: i + 1, seedSlug: seed?.slug, seedText: seed?.text }
  })
  const columns = outcomeColumns(stage.seedOutcomes)

  return (
    <div className="bg-surface border border-hairline rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        <p className="text-muted text-xs mt-0.5">
          {fixtures.length > 0
            ? `${fixtures.length} match${fixtures.length === 1 ? '' : 'es'} remaining -- odds are simulated from each team's own round-win rate this group, not a guarantee`
            : 'Round robin complete -- final standings'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr className="bg-surface2">
              <th className={`${thNowrap} text-right`}>#</th>
              <th className={`${thNowrap} text-left`}>Team</th>
              <th className={`${thNowrap} text-right`}>W-L</th>
              <th className={`${thNowrap} text-right`}>Map Diff</th>
              <th className={`${thNowrap} text-right`}>Round Diff</th>
              {columns.map(([slug, text]) => (
                <th key={slug} className={`${th} text-right w-[110px]`}>{text}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {annotated.map((r, i) => {
              const last = i === annotated.length - 1
              const bd = last ? '' : 'border-b border-hairline'
              return (
                <tr key={r.team} className="hover:bg-surface2/40 transition-colors">
                  <td className={`${td} ${bd} text-right text-muted`}>{r.rank}</td>
                  <td className={`${td} ${bd}`}>
                    <Link to={`/teams/${encodeURIComponent(r.team)}`} className="hover:text-accent-bright transition-colors">
                      <TeamLogo team={r.team} size={20} />
                    </Link>
                    {r.stillTiedWith && (
                      <span className="text-mid text-[10px] ml-1" title={`Still tied with ${r.stillTiedWith.join(', ')} after every tiebreak criterion -- needs a decider`}>
                        *
                      </span>
                    )}
                  </td>
                  <td className={`${td} ${bd} text-right tabular-nums`}>{r.wins}-{r.losses}</td>
                  <td className={`${td} ${bd} text-right tabular-nums ${r.mapsWon - r.mapsLost > 0 ? 'text-good' : r.mapsWon - r.mapsLost < 0 ? 'text-bad' : ''}`}>
                    {r.mapsWon - r.mapsLost > 0 ? '+' : ''}{r.mapsWon - r.mapsLost}
                  </td>
                  <td className={`${td} ${bd} text-right tabular-nums ${r.roundsWon - r.roundsLost > 0 ? 'text-good' : r.roundsWon - r.roundsLost < 0 ? 'text-bad' : ''}`}>
                    {r.roundsWon - r.roundsLost > 0 ? '+' : ''}{num(r.roundsWon - r.roundsLost)}
                  </td>
                  {columns.map(([slug]) => (
                    <td key={slug} className={`${td} ${bd} text-right tabular-nums`}>
                      {odds ? pct(odds[r.team]?.[slug] ?? 0) : pct(r.seedSlug === slug ? 1 : 0)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
