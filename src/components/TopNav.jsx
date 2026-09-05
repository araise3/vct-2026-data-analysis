import { NavLink, useLocation } from 'react-router-dom'
import SearchBar from './SearchBar'
import { prefetchData } from '../lib/useData'

const groups = [
  { label: 'Statistics', items: [
    { to: '/players', label: 'Players', data: ['player_buckets'] },
    { to: '/teams', label: 'Teams', data: ['team_buckets'] },
    { to: '/agents', label: 'Agents', data: ['agents'] },
    { to: '/tournaments', label: 'Events', data: ['team_buckets'] },
  ] },
  { label: 'Analysis', items: [
    { to: '/compare', label: 'Compare players', data: [] },
    { to: '/ratings', label: 'Team ratings', data: ['match_results'] },
    { to: '/compositions', label: 'Compositions', data: ['match_results', 'match_players'] },
    { to: '/economy', label: 'Economy', data: ['team_buckets'] },
    { to: '/records', label: 'Records', data: ['match_results', 'series_length', 'map_length', 'player_buckets'] },
  ] },
  { label: 'Tools', items: [
    { to: '/graphics', label: 'Export graphics', data: ['player_buckets', 'team_buckets', 'series_length', 'map_length'] },
  ] },
]

export default function TopNav() {
  const { pathname } = useLocation()
  return (
    <>
      <header className="portal-header">
        <a href="#main-content" className="skip-link">Skip to statistics</a>
        <NavLink to="/" className="portal-wordmark">vct<span> / </span>data</NavLink>
        <div className="portal-search"><SearchBar /></div>
      </header>
      <nav className="portal-navigation" aria-label="Statistics navigation">
        {groups.map((group) => (
          <div key={group.label} className="portal-nav-group">
            <p className="portal-nav-label">{group.label}</p>
            {group.items.map(({ to, label, data }) => (
              <NavLink
                key={to}
                to={to}
                aria-current={pathname === '/' && to === '/players' ? 'page' : undefined}
                className={({ isActive }) => `portal-nav-link ${isActive || (pathname === '/' && to === '/players') ? 'is-active' : ''}`}
                onMouseEnter={() => data.forEach(prefetchData)}
                onFocus={() => data.forEach(prefetchData)}
              >{label}</NavLink>
            ))}
          </div>
        ))}
        <p className="portal-nav-footnote">Competitive VALORANT statistics</p>
      </nav>
    </>
  )
}
