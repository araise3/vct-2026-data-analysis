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

        {/* Below `md`: an ordinary flex-1 child, same as before -- shrinks
            gracefully (down to 0 if it must) so it can never overlap the
            nav links, which don't reserve room for it (`shrink-0` +
            horizontal scroll, see above).
            At `md` and up: pinned to the true viewport edge instead, not
            just this row's own edge -- this row is wrapped in
            `max-w-content mx-auto`, so on a browser window wider than that
            max-width, staying a flex-1 child inside it only ever reached
            the content column's own right edge, leaving a growing empty
            gap out to the actual edge of the screen. `md:fixed` breaks it
            out of the centered row entirely so it stays flush with the
            real edge regardless of viewport width -- safe to do only from
            `md` up, where the nav links (by then already wrapped onto
            their own row's worth of width well short of the viewport
            edge) have no risk of running underneath it the way they do on
            a narrow phone-width screen. Sized to the header's own height
            (`h-[47px]`) and centered within it via flex, rather than
            `top-1/2 -translate-y-1/2` against the full viewport height --
            the header is `sticky top-0`, but the search box's fixed
            positioning is relative to the viewport as a whole, not just
            the header bar, so that trick would center it in the page
            instead of in the 47px bar. */}
        <div className="flex-1 flex justify-end min-w-0 md:flex-none md:fixed md:top-0 md:right-4 lg:right-6 md:h-[47px] md:items-center">
          <SearchBar />
        </div>
      </div>
    </header>
  )
}
