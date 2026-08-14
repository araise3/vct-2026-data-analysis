import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar'
import { prefetchData } from '../lib/useData'

// `data`: the file(s) each route's page fetches unconditionally on mount
// (deferred/toggle-gated files -- player_sides, the idle-loaded
// player_agents on Players, etc. -- are deliberately left out, same reasoning
// those pages already defer them for). Kept next to `items` rather than
// derived from the page modules themselves, since those are lazy-loaded and
// inspecting them would defeat the point of splitting them out in the first
// place.
//
// No Tournaments entry here: it's the landing page at "/" now (formerly
// Overview, see Tournaments.jsx), and the brand logo link below already
// routes there -- a second "Tournaments" label pointing at the same place
// would be redundant, so the logo is that tab's nav.
const items = [
  { to: '/players', label: 'Players', data: ['player_buckets'] },
  // No player_buckets in `data`: it's a 6.7MB file, and this page doesn't
  // need it until someone actually types a name into one of its two boxes --
  // prefetching it on a mere nav hover would put a multi-megabyte download on
  // the path of every visitor who was just passing over the link.
  { to: '/compare', label: 'Compare', data: [] },
  { to: '/teams', label: 'Teams', data: ['team_buckets'] },
  { to: '/agents', label: 'Agents', data: ['agents'] },
  { to: '/compositions', label: 'Compositions', data: ['match_results', 'match_players'] },
  // Not player_agents: that 9.57MB file is idle-deferred inside the page
  // itself (AgentPatchTrend, same pattern as Players.jsx) -- prefetching it
  // on nav hover would defeat the point of deferring it in the first place.
  { to: '/patches', label: 'Patches', data: ['patch_notes', 'event_meta'] },
  { to: '/economy', label: 'Economy', data: ['team_buckets'] },
  { to: '/records', label: 'Records', data: ['match_results', 'series_length', 'map_length', 'player_buckets'] },
  { to: '/graphics', label: 'Graphics', data: ['player_buckets', 'team_buckets', 'series_length', 'map_length'] },
]

// Same fetch list Tournaments.jsx's two sections make on mount, prefetched
// on the brand logo the same way the old dedicated nav item did -- see the
// `items` comment above for why that item is gone.
const HOME_DATA = [
  'match_results', 'event_meta', 'upcoming_matches', 'player_week',
  'player_buckets', 'team_buckets',
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
 *    what aligns the nav links with the content below. `2xl:max-w-[1250px]`
 *    is the same responsive-pair override <main>/the footer carry (see
 *    tailwind.config.js's own comment on why the token itself can't encode
 *    a breakpoint-dependent jump).
 *  - brand + links grouped in their own `flex items-center gap-6` (rft.gg's
 *    real markup: `<a>` logo then `<nav>`, both inside one wrapping div with
 *    a 24px gap between them -- NOT spaced via the outer row's own
 *    `space-x-2 md:space-x-4`, which on their site only ever separates that
 *    whole group from the search box).
 *  - links: `text-xs font-semibold`, muted by default, hover -> accent
 *    (their real `hover:text-primary` -- the base accent, not a brightened
 *    variant).
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
      <div className="max-w-content mx-auto px-4 md:px-6 h-full flex items-center space-x-2 md:space-x-4 2xl:max-w-[1250px]">
        <div className="flex items-center gap-6 shrink-0 h-full">
          <NavLink
            to="/"
            end
            className="flex items-center shrink-0 group"
            onMouseEnter={() => HOME_DATA.forEach(prefetchData)}
            onFocus={() => HOME_DATA.forEach(prefetchData)}
          >
            <span className="font-display font-semibold text-sm leading-none text-ink group-hover:text-accent-bright transition-colors">
              VCT 2026
            </span>
          </NavLink>

          {/* Scrolls rather than wraps on narrow screens: wrapping to a
              second line would change the bar's height, and every sticky
              offset below it, only on small viewports. rft.gg instead hides
              its nav below `lg` in favour of a mobile menu it doesn't need
              here -- this site has no such menu, so scrolling is the
              adaptation that keeps every link reachable at every width
              instead of removing them. */}
          <nav className="flex items-center gap-6 h-full shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:w-0">
            {items.map(({ to, label, data }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                // Prefetch the destination page's data on hover/focus -- both,
                // not just hover, so keyboard/tab navigation gets the same
                // head start a mouse hover does. The route's own JS chunk is
                // a few KB (React.lazy already split it, see App.jsx) and
                // loads well within a hover's lead time regardless; the actual
                // multi-MB JSON is what benefits from starting early.
                onMouseEnter={() => data.forEach(prefetchData)}
                onFocus={() => data.forEach(prefetchData)}
                className={({ isActive }) =>
                  [
                    'relative text-xs font-semibold transition-colors flex items-center whitespace-nowrap',
                    '-mb-2 pb-2',
                    'after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2',
                    'after:h-[3px] after:rounded-full after:w-[calc(100%+12px)]',
                    isActive
                      ? 'text-ink after:bg-accent shadow-[inset_0_-8px_10px_-10px_var(--tw-shadow-color)] shadow-accent'
                      : 'text-muted hover:text-accent after:bg-transparent',
                  ].join(' ')
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Plain `flex-1 justify-end`, matching rft.gg's own real markup --
            NOT pinned to the true viewport edge. Confirmed live: at a 2560px
            viewport their own search box sits ~791px short of the actual
            screen edge, still inside their centred content column, rather
            than breaking out to it. A `md:fixed` version of this div used to
            exist here specifically to close that gap on very wide screens,
            but that was solving a problem rft.gg's real page doesn't try to
            solve -- and now that `max-w-content` matches their real
            (bounded, responsive) width instead of a plain static one, the
            gap it was compensating for is bounded too. */}
        <div className="flex-1 flex justify-end min-w-0">
          <SearchBar />
        </div>
      </div>
    </header>
  )
}
