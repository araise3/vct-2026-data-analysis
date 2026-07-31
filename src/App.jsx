import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import TopNav from './components/TopNav'

/*
  Every page is lazy so a visit only downloads the route it actually opened.
  Statically importing all eleven put them in one 322KB bundle, which meant
  landing on the Overview page also paid for the Graphics page's html-to-image
  dependency -- by far the heaviest thing in the tree, and used by exactly one
  route that most visits never reach.

  TopNav (and therefore SearchBar) stays static: it renders on every route, so
  splitting it would only add a round trip to the first paint of every page.
*/
const Overview = lazy(() => import('./pages/Overview'))
const Players = lazy(() => import('./pages/Players'))
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'))
const Teams = lazy(() => import('./pages/Teams'))
const TeamProfile = lazy(() => import('./pages/TeamProfile'))
const Agents = lazy(() => import('./pages/Agents'))
const Tournaments = lazy(() => import('./pages/Tournaments'))
const MatchRedirect = lazy(() => import('./pages/MatchRedirect'))
const Economy = lazy(() => import('./pages/Economy'))
const Graphics = lazy(() => import('./pages/Graphics'))
const Records = lazy(() => import('./pages/Records'))

export default function App() {
  return (
    <BrowserRouter>
      {/* rft.gg's own page wrapper: `flex min-h-dvh flex-col`. dvh (not vh)
          so mobile browser chrome collapsing doesn't leave a gap. */}
      <div className="flex min-h-dvh flex-col bg-base">
        <TopNav />
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
          Wrapper trio (`max-w-content mx-auto px-4 md:px-6`) is rft.gg's,
          matching TopNav's inner row so content lines up with the nav.
        */}
        <main className="w-full max-w-content mx-auto min-w-0 flex-1 px-4 md:px-6 py-8">
          {/* Same "Loading…" line every page already renders while its own
              JSON is in flight, so a chunk fetch looks identical to a data
              fetch rather than introducing a second, different spinner. */}
          <Suspense fallback={<div className="text-muted text-sm">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:name" element={<PlayerProfile />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:name" element={<TeamProfile />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/tournaments" element={<Tournaments />} />
            {/* Legacy: this used to be the site's own match page. Kept as a
                redirect so already-shared links don't render blank -- see
                MatchRedirect. */}
            <Route path="/matches/:id" element={<MatchRedirect />} />
            <Route path="/economy" element={<Economy />} />
            <Route path="/records" element={<Records />} />
            <Route path="/graphics" element={<Graphics />} />
          </Routes>
          </Suspense>
        </main>
        {/* Was the sidebar's bottom-pinned caption; now a real footer, in
            the same centered wrapper so it aligns with the content. */}
        <footer className="w-full max-w-content mx-auto px-4 md:px-6 py-5 mt-4 border-t border-hairline text-[11px] text-muted">
          Data from vlr.gg · VCT 2026 tier-1 events
        </footer>
      </div>
    </BrowserRouter>
  )
}
