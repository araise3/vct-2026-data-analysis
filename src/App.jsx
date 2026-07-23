import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './pages/Overview'
import Players from './pages/Players'
import PlayerProfile from './pages/PlayerProfile'
import Teams from './pages/Teams'
import TeamProfile from './pages/TeamProfile'
import Agents from './pages/Agents'
import Economy from './pages/Economy'
import Graphics from './pages/Graphics'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-base">
        <Sidebar />
        <main className="flex-1 px-8 py-8 max-w-[2400px]">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:name" element={<PlayerProfile />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:name" element={<TeamProfile />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/economy" element={<Economy />} />
            <Route path="/graphics" element={<Graphics />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
