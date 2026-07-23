import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Overview', icon: OverviewIcon },
  { to: '/players', label: 'Players', icon: PlayersIcon },
  { to: '/teams', label: 'Teams', icon: TeamsIcon },
  { to: '/agents', label: 'Agents', icon: AgentsIcon },
  { to: '/economy', label: 'Economy', icon: EconomyIcon },
  { to: '/graphics', label: 'Graphics', icon: GraphicsIcon },
]

export default function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 h-screen sticky top-0 border-r border-hairline bg-base flex flex-col py-6 px-3">
      <div className="px-3 mb-8">
        <div className="font-display font-semibold text-lg text-ink leading-tight">VCT 2026</div>
        <div className="text-muted text-xs mt-0.5">Season Stats</div>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-surface2 text-accent-bright'
                  : 'text-muted hover:text-ink hover:bg-surface'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-3 text-[11px] text-muted leading-relaxed">
        Data from vlr.gg · VCT 2026 tier-1 events
      </div>
    </aside>
  )
}

function OverviewIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="1.5" width="6" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="8.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function PlayersIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="5" r="2.7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function TeamsIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="5.5" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 14c0-2.5 1.8-4 4-4s4 1.5 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.8 10.2c1.7.2 2.9 1.4 2.9 3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function EconomyIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path d="M2 13.5V7l3-2 3 2 3-4 3 3v7.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M1.5 13.5h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function AgentsIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="5.2" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 8.2c-2.8 0-4.5 1.6-5 4.2h10c-.5-2.6-2.2-4.2-5-4.2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}

function GraphicsIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.3" cy="6" r="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.5 12l3.5-3.5 2.5 2.5 3-3.5 2 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
