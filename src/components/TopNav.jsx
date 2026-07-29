import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar'

const items = [
  { to: '/', label: 'Overview' },
  { to: '/players', label: 'Players' },
  { to: '/teams', label: 'Teams' },
  { to: '/agents', label: 'Agents' },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/economy', label: 'Economy' },
  { to: '/records', label: 'Records' },
  { to: '/graphics', label: 'Graphics' },
]

/**
 * Horizontal top navigation, replacing the former 220px left sidebar
 * (`Sidebar.jsx`, deleted). Parameters are copied from rft.gg's live
 * stylesheet rather than approximated:
 *
 *  - bar: `h-[47px] py-2 border-b sticky top-0 z-50 shadow-sm` on their
 *    `--navbar-background` (our `navbar` token, already the same #0d0f10).
 *  - inner row: `max-w-content mx-auto px-4 md:px-6 h-full flex items-center
 *    space-x-2 md:space-x-4` -- the same wrapper trio <main> uses, which is
 *    what aligns the nav links with the content below.
 *  - links: `text-xs font-semibold`, muted by default, hover -> accent.
 *
 * The active marker is their underline, not a pill: a 3px rounded bar
 * pinned to the bottom edge in the accent colour, `calc(100%+12px)` wide so
 * it overhangs the label slightly, plus their faint inset glow. The
 * `-mb-2 pb-2` pair is load-bearing for it -- the bar's `py-2` would
 * otherwise leave the underline floating 8px above the border, so each link
 * cancels that padding with negative margin and re-adds it as its own
 * padding, letting the underline sit flush on the bar's bottom border.
 *
 * Their `data-active:` variants are driven by a data attribute; NavLink
 * gives us `isActive` directly, so the same styles are applied through its
 * className callback instead.
 *
 * Icons were dropped in the move from the sidebar. They earned their keep in
 * a vertical list where each row had a full 220px to itself; in a horizontal
 * bar with eight items they only consume the space the labels need, and
 * rft.gg's own top nav is text-only.
 */
export default function TopNav() {
  return (
    <header className="bg-navbar w-full h-[47px] border-b border-hairline py-2 sticky top-0 z-50 shadow-sm">
      <div className="max-w-content mx-auto px-4 md:px-6 h-full flex items-center space-x-2 md:space-x-4">
        <NavLink to="/" end className="flex items-center shrink-0 group">
          <span className="font-display font-semibold text-sm leading-none text-ink group-hover:text-accent-bright transition-colors">
            VCT 2026
          </span>
        </NavLink>

        {/* Scrolls rather than wraps on narrow screens: wrapping to a second
            line would change the bar's height, and every sticky offset
            below it, only on small viewports. */}
        <nav className="flex items-center space-x-2 md:space-x-4 h-full shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:w-0">
          {items.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'relative text-xs font-semibold transition-colors flex items-center whitespace-nowrap',
                  '-mb-2 pb-2',
                  'after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2',
                  'after:h-[3px] after:rounded-full after:w-[calc(100%+12px)]',
                  isActive
                    ? 'text-ink after:bg-accent shadow-[inset_0_-8px_10px_-10px_var(--tw-shadow-color)] shadow-accent'
                    : 'text-muted hover:text-accent-bright after:bg-transparent',
                ].join(' ')
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* `flex-1 justify-end` (same as rft.gg) rather than `ml-auto` on
            the search box itself -- gives the box a real flex-shrink
            boundary so it degrades gracefully instead of overflowing the
            bar on narrow viewports where the nav links already eat most
            of the width. */}
        <div className="flex-1 flex justify-end min-w-0">
          <SearchBar />
        </div>
      </div>
    </header>
  )
}
