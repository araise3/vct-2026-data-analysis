import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { expandMatchRows } from '../lib/entityBuckets'
import { buildCoachIndex, coachStintRecord } from '../lib/coaches'
import TeamLogo from '../components/TeamLogo'
import Flag from '../components/Flag'
import { pct, longDate as shortDate } from '../lib/format'

const th = 'px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap'
const td = 'px-4 py-3 text-sm whitespace-nowrap align-middle'

/**
 * Profile page for one coach, mirroring PlayerProfile/TeamProfile's shape
 * (header + a stats table) but built around what actually exists for a
 * coach: no match-player stats (coaches don't play), so "fitting stats"
 * here is the coach's own record -- every stint they've held across every
 * team, each stint's own match win/loss while they held it, and one
 * combined career total. See coaches.js for why this has to be reassembled
 * from every team's own roster entry rather than read off a single record.
 */
export default function CoachProfile() {
  const { id } = useParams()
  const decodedId = decodeURIComponent(id)
  const { data: liquipediaData, loading: rostersLoading } = useData('liquipedia_rosters')
  const { data: matchData, loading: matchesLoading } = useData('match_results')

  const coachIndex = useMemo(() => buildCoachIndex(liquipediaData), [liquipediaData])
  const coach = coachIndex.get(decodedId.toLowerCase())

  const matches = useMemo(() => expandMatchRows(matchData), [matchData])

  const stints = useMemo(() => {
    if (!coach) return []
    return [...coach.stints]
      .sort((a, b) => (b.joinDate || '').localeCompare(a.joinDate || ''))
      .map((s) => ({ ...s, record: coachStintRecord(matches, s.team, s.joinDate, s.leaveDate) }))
  }, [coach, matches])

  const career = useMemo(() => {
    let wins = 0, losses = 0
    for (const s of stints) {
      if (!s.record) continue
      wins += s.record.wins
      losses += s.record.losses
    }
    const played = wins + losses
    return played ? { wins, losses, winPct: wins / played } : null
  }, [stints])

  const current = stints.find((s) => s.status === 'active')

  if (rostersLoading || matchesLoading) return <div className="text-muted text-sm">Loading…</div>

  if (!coach) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/teams" className="text-sm text-accent-bright hover:underline">← Back to Teams</Link>
        <p className="text-muted text-sm">No coach found matching "{decodedId}".</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/teams" className="text-sm text-muted hover:text-ink w-fit">← Back to Teams</Link>

      <div className="flex items-stretch gap-4">
        <div className="w-16 h-16 rounded-xl bg-surface2 border border-hairline flex items-center justify-center shrink-0">
          <Flag countryCode={coach.flag} countryName={coach.name} size={30} />
        </div>
        <div className="flex flex-col justify-center gap-0.5">
          <h1 className="font-display text-2xl font-semibold text-ink">{coach.id}</h1>
          {coach.name && coach.name !== coach.id && (
            <p className="text-muted text-sm">{coach.name}</p>
          )}
          {current ? (
            <p className="text-muted text-sm flex items-center gap-1.5">
              {current.role} of{' '}
              <Link to={`/teams/${encodeURIComponent(current.team)}`} className="text-ink hover:text-accent-bright inline-flex items-center gap-1.5">
                <TeamLogo team={current.team} size={16} showName={false} />
                {current.team}
              </Link>
            </p>
          ) : (
            <p className="text-muted text-sm">Not currently coaching</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-surface border border-hairline rounded-2xl p-4">
          <p className="text-muted text-xs uppercase tracking-wide mb-1">Career Record</p>
          <p className={`text-xl font-display font-semibold ${
            career ? (career.winPct >= 0.5 ? 'text-good' : 'text-bad') : 'text-ink'
          }`}>
            {career ? `${career.wins}–${career.losses}` : '—'}
          </p>
          <p className="text-muted text-xs mt-0.5">
            {career ? pct(career.winPct) : 'No scored matches in scope'}
          </p>
        </div>
        <div className="bg-surface border border-hairline rounded-2xl p-4">
          <p className="text-muted text-xs uppercase tracking-wide mb-1">Teams Coached</p>
          <p className="text-xl font-display font-semibold text-ink">
            {new Set(stints.map((s) => s.team)).size}
          </p>
        </div>
        <div className="bg-surface border border-hairline rounded-2xl p-4">
          <p className="text-muted text-xs uppercase tracking-wide mb-1">Stints</p>
          <p className="text-xl font-display font-semibold text-ink">{stints.length}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold text-ink">Coaching history</h2>
        <div className="bg-surface border border-hairline rounded-2xl overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-surface2">
                <th className={`${th} text-left border-b border-hairline`}>Team</th>
                <th className={`${th} text-left border-b border-hairline`}>Role</th>
                <th className={`${th} text-left border-b border-hairline`}>From</th>
                <th className={`${th} text-left border-b border-hairline`}>To</th>
                <th className={`${th} text-right border-b border-hairline`}>Record</th>
              </tr>
            </thead>
            <tbody>
              {stints.map((s, i) => {
                const last = i === stints.length - 1
                const bd = last ? '' : 'border-b border-hairline'
                return (
                  <tr key={`${s.team}-${s.role}-${s.joinDate}-${i}`} className="hover:bg-surface2/40 transition-colors">
                    <td className={`${td} ${bd}`}>
                      <Link
                        to={`/teams/${encodeURIComponent(s.team)}`}
                        className="flex items-center gap-2 text-ink hover:text-accent-bright transition-colors"
                      >
                        <TeamLogo team={s.team} size={16} showName={false} />
                        {s.team}
                      </Link>
                    </td>
                    <td className={`${td} ${bd} text-muted`}>{s.role}</td>
                    <td className={`${td} ${bd} text-muted`}>{shortDate(s.joinDate) || '—'}</td>
                    <td className={`${td} ${bd} text-muted`}>
                      {s.leaveDate ? shortDate(s.leaveDate) : 'Present'}
                    </td>
                    <td className={`${td} ${bd} text-right tabular-nums ${
                      s.record ? (s.record.winPct >= 0.5 ? 'text-good font-medium' : 'text-bad font-medium') : 'text-muted'
                    }`}>
                      {s.record ? `${s.record.wins}–${s.record.losses} (${pct(s.record.winPct)})` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted text-xs leading-relaxed">
          Record is this team's match win/loss while the coach held this role, matched by date
          against the team's own results. Roster/coach data from{' '}
          <a
            href="https://liquipedia.net/valorant"
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent-bright transition-colors underline"
          >
            Liquipedia
          </a>
          , licensed CC-BY-SA 3.0.
        </p>
      </div>
    </div>
  )
}
