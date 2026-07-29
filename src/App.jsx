import { BrowserRouter, Routes, Route } from 'react-router-dom'
import TopNav from './components/TopNav'
import Overview from './pages/Overview'
import Players from './pages/Players'
import PlayerProfile from './pages/PlayerProfile'
import Teams from './pages/Teams'
import TeamProfile from './pages/TeamProfile'
import Agents from './pages/Agents'
import Tournaments from './pages/Tournaments'
import MatchRedirect from './pages/MatchRedirect'
import Economy from './pages/Economy'
import Graphics from './pages/Graphics'
import Records from './pages/Records'

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
