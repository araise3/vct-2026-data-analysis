import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './pages/Overview'
import Players from './pages/Players'
import Teams from './pages/Teams'
import Agents from './pages/Agents'
import Economy from './pages/Economy'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-base">
        <Sidebar />
        <main className="flex-1 px-8 py-8 max-w-[1400px]">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/players" element={<Players />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/economy" element={<Economy />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
