import TeamLogo from './TeamLogo'
import EventLogo from './EventLogo'
import teamLogos from '../lib/teamLogos.json'

/**
 * One match block in the right-hand rail: a header line (time · format ·
 * LIVE · event logo) over two team rows with scores. Presentational only --
 * callers normalise their own shape into these props, because the rail shows
 * two genuinely different sources (Liquipedia's fixture feed and this site's
 * own completed matches) that share no field names.
 *
 * Team labels come from `teamLogos.json`'s `tag` rather than TeamLogo's own
 * `showTag`: at 220px only a short tag fits, but TeamLogo renders NOTHING
 * when a team has no entry at all (it guards on `entry?.tag`), and the feed
 * genuinely contains teams this site has never seen -- Pacific Stage 2's
 * Play-Ins pulls in Challengers sides (ONSIDE GAMING, QT DIG, Sharper
 * Esports, Xipto Esports) with no logo, no tag and no stats here. Falling
 * back to the full name keeps those rows readable instead of showing two
 * blank boxes.
 */
export default function RailMatch({
  href, external, time, format, live, eventName,
  team1, team2, score1, score2,
}) {
  const decided = score1 != null && score2 != null && score1 !== score2
  const Wrapper = href ? 'a' : 'div'
  const wrapperProps = href
    ? { href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }
    : {}

  return (
    <Wrapper
      {...wrapperProps}
      className={`block border-b border-hairline/40 px-2.5 py-1.5 last:border-b-0 ${
        href ? 'transition-colors hover:bg-surface2/60' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-[10px] font-semibold text-muted">
          {time}
          {format && <span className="font-normal opacity-70">{format}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {live && (
            <span className="rounded-[3px] bg-live px-1 py-px text-[9px] font-extrabold leading-none text-white">
              LIVE
            </span>
          )}
          <EventLogo event={eventName} size={12} />
        </span>
      </div>
      <TeamLine team={team1} score={score1} loser={decided && score1 < score2} />
      <TeamLine team={team2} score={score2} loser={decided && score2 < score1} />
    </Wrapper>
  )
}

function TeamLine({ team, score, loser }) {
  if (!team) {
    return (
      <div className="flex items-center gap-1.5 py-px">
        <span className="h-4 w-4 shrink-0 rounded bg-surface2/60" />
        <span className="flex-1 truncate text-[11px] italic text-muted/60">TBD</span>
      </div>
    )
  }
  const label = teamLogos[team]?.tag || team
  return (
    <div className="flex items-center gap-1.5 py-px">
      <TeamLogo team={team} size={16} showName={false} />
      <span className={`flex-1 truncate text-[11px] ${loser ? 'text-muted' : 'text-ink'}`}>
        {label}
      </span>
      {score != null && (
        <span
          className={`shrink-0 text-[11px] tabular-nums ${
            loser ? 'text-muted' : 'font-semibold text-ink'
          }`}
        >
          {score}
        </span>
      )}
    </div>
  )
}
