import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './pages/Overview'
import Players from './pages/Players'
import PlayerProfile from './pages/PlayerProfile'
import Teams from './pages/Teams'
import TeamProfile from './pages/TeamProfile'
import Agents from './pages/Agents'
import Tournaments from './pages/Tournaments'
import MatchPage from './pages/MatchPage'
import Economy from './pages/Economy'
import Graphics from './pages/Graphics'
import Records from './pages/Records'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-base">
        <Sidebar />
        {/*
          min-w-0 is load-bearing here, not decorative. A flex child's
          default min-width is `auto`, which means it refuses to shrink
          below its own content's intrinsic width. DataTable deliberately
          has no fixed column widths (see its own comment), so once enough
          stat columns pile up its natural width can exceed the viewport --
          without min-w-0, THIS element grows to match instead of letting
          DataTable's own overflow-auto wrapper contain the horizontal
          scroll, dragging the sidebar and everything else off-screen with
          it. This has already recurred once (new stat cards/columns
          pushed the page wide again), so don't drop it when refactoring
          this layout.
        */}
        <main className="flex-1 min-w-0 px-8 py-8 max-w-[2400px]">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:name" element={<PlayerProfile />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:name" element={<TeamProfile />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/matches/:id" element={<MatchPage />} />
            <Route path="/economy" element={<Economy />} />
            <Route path="/records" element={<Records />} />
            <Route path="/graphics" element={<Graphics />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
