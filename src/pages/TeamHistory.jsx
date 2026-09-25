import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/useData'
import { buildRosterIterations } from '../lib/rosterIterations'
import { headCoachesForTeam } from '../lib/coaches'
import { teamBreakdownUrl, teamHistoryUrl } from '../lib/teamUrl'
import { eventLabel, longDate, num, pct, rating } from '../lib/format'
import RosterTimeline from '../components/RosterTimeline'
import TeamLogo from '../components/TeamLogo'
import Select from '../components/ui/Select'

function Metric({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

function IterationCard({ iteration, events }) {
  const seriesPlayed = iteration.seriesWon + iteration.seriesLost
  const roundDiff = iteration.roundsWon - iteration.roundsLost
  const dateRange = iteration.firstDate === iteration.lastDate
    ? longDate(iteration.firstDate)
    : `${longDate(iteration.firstDate)} – ${longDate(iteration.lastDate)}`
  const eventNames = iteration.eventIds
    .map((id) => eventLabel(events?.[id]?.name))
    .filter(Boolean)

  return (
    <article className="rounded-xl border border-hairline bg-grad-surface shadow-depth-xs overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-3 sm:px-5">
        <h3 className="font-display text-sm font-semibold text-ink">Iteration {iteration.number}</h3>
        <span className="text-xs text-muted">{dateRange} · {num(iteration.matchIds.length)} series</span>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap gap-1.5">
          {iteration.players.map((player) => (
            <Link key={player} to={`/players/${encodeURIComponent(player)}`}
              className="rounded border border-hairline bg-surface2 px-2 py-1 text-xs font-medium text-ink hover:border-accent-bright/50 hover:text-accent-bright">
              {player}
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <Metric label="Series" value={`${iteration.seriesWon}–${iteration.seriesLost}`}
            sub={seriesPlayed ? `${pct(iteration.seriesWon / seriesPlayed)} win` : undefined} />
          <Metric label="Maps" value={`${iteration.mapsWon}–${iteration.mapsLost}`} />
          <Metric label="Round difference" value={`${roundDiff > 0 ? '+' : ''}${num(roundDiff)}`} />
          <Metric label="Avg player rating" value={iteration.avgRating == null ? '—' : rating(iteration.avgRating)} />
          <Metric label="Player K/D" value={iteration.kd == null ? '—' : iteration.kd.toFixed(2)} />
        </div>
        {eventNames.length > 0 && <p className="text-xs text-muted">{eventNames.join(' · ')}</p>}
      </div>
    </article>
  )
}

export default function TeamHistory() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const team = params.get('team') || ''
  const { data: teamData, loading: teamsLoading } = useData('team_buckets')
  const { data: playerData, loading: playersLoading } = useData(team ? 'player_buckets' : null)
  const { data: matchData, loading: matchesLoading } = useData(team ? 'match_results' : null)
  const { data: matchPlayerData, loading: matchPlayersLoading } = useData(team ? 'match_players' : null)
  const { data: liquipediaData } = useData(team ? 'liquipedia_rosters' : null)

  const teams = useMemo(() => Object.keys(teamData?.meta || {}).sort((a, b) => a.localeCompare(b)), [teamData])
  const iterations = useMemo(
    () => buildRosterIterations(matchData, matchPlayerData, team),
    [matchData, matchPlayerData, team],
  )
  const headCoaches = useMemo(
    () => headCoachesForTeam(liquipediaData, team),
    [liquipediaData, team],
  )

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Team history</h1>
        <p className="mt-1 text-sm text-muted">Follow each roster through events and compare its results.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="team-history-picker" className="text-sm font-medium text-muted">Team</label>
        <Select
          id="team-history-picker"
          className="w-full sm:w-72"
          value={team}
          onChange={(next) => navigate(teamHistoryUrl(next))}
          options={teams}
          placeholder="Choose a team…"
          searchable
          disabled={teamsLoading}
        />
        {team && teamData?.meta?.[team] && (
          <Link to={teamBreakdownUrl(team)} className="text-xs text-accent-bright hover:underline">
            Current team breakdown →
          </Link>
        )}
      </div>

      {teamsLoading ? <p className="text-sm text-muted">Loading teams…</p>
        : !team ? <div className="rounded-xl border border-hairline bg-surface p-8 text-center text-sm text-muted">
          Choose a team to see its roster history.
        </div>
          : !teamData?.meta?.[team] ? <p className="text-sm text-muted">No team found matching “{team}”.</p>
            : playersLoading || matchesLoading || matchPlayersLoading || !playerData || !matchData || !matchPlayerData
              ? <p className="text-sm text-muted">Loading roster history…</p>
              : <>
                <section className="flex min-w-0 flex-col gap-3" aria-labelledby="roster-timeline-heading">
                  <div className="flex flex-wrap items-center gap-3">
                    <TeamLogo team={team} size={24} showName={false} />
                    <h2 id="roster-timeline-heading" className="font-display text-lg font-semibold text-ink">{team} roster timeline</h2>
                  </div>
                  <RosterTimeline
                    playerBuckets={playerData}
                    team={team}
                    matchResultsRows={matchData.rows}
                    matchPlayersRows={matchPlayerData.rows}
                    headCoaches={headCoaches}
                  />
                </section>

                <section className="flex flex-col gap-3" aria-labelledby="roster-iterations-heading">
                  <div>
                    <h2 id="roster-iterations-heading" className="font-display text-lg font-semibold text-ink">
                      Roster iterations <span className="text-sm font-normal text-muted">({iterations.length})</span>
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                      Each consecutive run with the same players appearing in a series is one iteration.
                      A series with substitutions gets its own lineup. Stats count only those series;
                      average rating weights each player’s series rating by rounds played.
                    </p>
                  </div>
                  {iterations.length === 0
                    ? <p className="rounded-xl border border-hairline bg-surface p-6 text-sm text-muted">No match lineups are available for this team.</p>
                    : [...iterations].reverse().map((iteration) => (
                      <IterationCard key={iteration.number} iteration={iteration} events={matchData.events} />
                    ))}
                </section>
              </>}
    </div>
  )
}
