import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import TopNav from './components/TopNav'

/*
  Every page is lazy so a visit only downloads the route it actually opened.
  Statically importing all eleven put them in one 322KB bundle, which meant
  landing on the home page also paid for the Graphics page's html-to-image
  dependency -- by far the heaviest thing in the tree, and used by exactly one
  route that most visits never reach.

  TopNav (and therefore SearchBar) stays static for the statistics shell. The
  root start page deliberately omits that shell, but every data route shares it,
  so splitting it would still add a round trip to almost every first paint.
*/
const Players = lazy(() => import('./pages/Players'))
const Start = lazy(() => import('./pages/Start'))
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'))
const ComparePlayers = lazy(() => import('./pages/ComparePlayers'))
const Teams = lazy(() => import('./pages/Teams'))
const Ratings = lazy(() => import('./pages/Ratings'))
const TeamProfile = lazy(() => import('./pages/TeamProfile'))
const Agents = lazy(() => import('./pages/Agents'))
const Compositions = lazy(() => import('./pages/Compositions'))
const EventStats = lazy(() => import('./pages/EventStats'))
const MatchRedirect = lazy(() => import('./pages/MatchRedirect'))
const Economy = lazy(() => import('./pages/Economy'))
const Graphics = lazy(() => import('./pages/Graphics'))
const Records = lazy(() => import('./pages/Records'))
const Statistic = lazy(() => import('./pages/Statistic'))
const Analysis = lazy(() => import('./pages/Analysis'))

function AppShell() {
  const { pathname } = useLocation()
  const isStart = pathname === '/'

  return (
      <div className={isStart ? 'start-shell' : 'portal-shell'}>
        {!isStart && <TopNav />}
        {/*
          min-w-0 is still load-bearing here, not decorative -- keep it when
          refactoring this layout. A flex child's default min-width is
          `auto`, meaning it refuses to shrink below its own content's
          intrinsic width. DataTable deliberately has no fixed column widths
          (see its own comment), so once enough stat columns pile up its
          natural width exceeds the page; without min-w-0 THIS element grows
          to match instead of letting DataTable's own overflow-auto wrapper
          contain the horizontal scroll, which used to drag the sidebar and
          everything else off-screen. That has already recurred once (new
          stat cards/columns pushed the page wide again).
          `max-w-content` (tailwind.config.js) now caps it as well, but the
          two do different jobs: max-width stops the element growing past the
          site width, min-w-0 stops it refusing to shrink BELOW that on a
          narrower viewport.
          The 1400/1480 desktop pair is wider than the old event-site shell:
          tables and side-by-side comparisons are the primary content now.
        */}
        <main id="main-content" className={isStart ? 'start-main' : 'portal-main'} tabIndex={-1}>
          {/* Same "Loading…" line every page already renders while its own
              JSON is in flight, so a chunk fetch looks identical to a data
              fetch rather than introducing a second, different spinner. */}
          <Suspense fallback={<div className="text-muted text-sm">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Start />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:name" element={<PlayerProfile />} />
            <Route path="/compare" element={<ComparePlayers />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:name" element={<TeamProfile />} />
            <Route path="/ratings" element={<Ratings />} />
            <Route path="/coaches/:id" element={<Navigate to="/teams" replace />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/compositions" element={<Compositions />} />
            <Route path="/tournaments" element={<EventStats />} />
            <Route path="/tournaments/:event" element={<EventStats />} />
            {/* Legacy: this used to be the site's own match page. Kept as a
                redirect so already-shared links don't render blank -- see
                MatchRedirect. */}
            <Route path="/matches/:id" element={<MatchRedirect />} />
            <Route path="/economy" element={<Economy />} />
            <Route path="/patches" element={<Navigate to="/agents" replace />} />
            <Route path="/records" element={<Records />} />
            <Route path="/statistics/:entity/:stat" element={<Statistic />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/graphics" element={<Graphics />} />
            <Route path="*" element={<div className="py-12"><h1>Page not found</h1><a className="data-link" href="/players">Return to player statistics</a></div>} />
          </Routes>
          </Suspense>
          {!isStart && <footer className="portal-footer">VCT Data <span>Independent statistics · Not affiliated with Riot Games</span></footer>}
        </main>
      </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {/* dvh keeps the footer at the viewport edge even as mobile browser
          chrome expands and collapses. */}
      <AppShell />
    </BrowserRouter>
  )
}
