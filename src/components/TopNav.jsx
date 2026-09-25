import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar'
import { prefetchData } from '../lib/useData'

const pages = [
  { to: '/tournaments', label: 'Overview & events', data: ['team_buckets'] },
  { to: '/players', label: 'Players', data: ['player_buckets'] },
  { to: '/teams', label: 'Teams', data: ['team_buckets'] },
  { to: '/agents', label: 'Agents', data: ['agents'] },
  { to: '/compare', label: 'Compare players', data: [] },
  { to: '/compositions', label: 'Compositions', data: ['match_results', 'match_players'] },
  { to: '/records', label: 'Records', data: ['match_results', 'series_length', 'map_length', 'player_buckets'] },
  { to: '/statistics', label: 'All statistics', data: [] },
  { to: '/graphics', label: 'Export graphics', data: ['player_buckets', 'team_buckets', 'series_length', 'map_length'] },
]

export default function TopNav() {
  return (
    <>
      <header className="portal-header">
        <a href="#main-content" className="skip-link">Skip to statistics</a>
        <NavLink to="/tournaments" className="portal-wordmark">vct<span> / </span>data</NavLink>
        <div className="portal-search"><SearchBar /></div>
      </header>
      <nav className="portal-navigation" aria-label="Statistics navigation">
        {pages.map(({ to, label, data }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/tournaments'}
            className={({ isActive }) => `portal-nav-link ${isActive ? 'is-active' : ''}`}
            onMouseEnter={() => data.forEach(prefetchData)}
            onFocus={() => data.forEach(prefetchData)}
          >{label}</NavLink>
        ))}
      </nav>
    </>
  )
}
