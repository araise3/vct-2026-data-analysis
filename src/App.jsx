import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import TopNav from './components/TopNav'

// Keep pages split so the overview does not download every data view and tool.
const Tournaments = lazy(() => import('./pages/Tournaments'))
const TournamentDetail = lazy(() => import('./pages/TournamentDetail'))
const EventStats = lazy(() => import('./pages/EventStats'))
const Players = lazy(() => import('./pages/Players'))
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'))
const ComparePlayers = lazy(() => import('./pages/ComparePlayers'))
const Teams = lazy(() => import('./pages/Teams'))
const TeamProfile = lazy(() => import('./pages/TeamProfile'))
const CoachProfile = lazy(() => import('./pages/CoachProfile'))
const Ratings = lazy(() => import('./pages/Ratings'))
const Agents = lazy(() => import('./pages/Agents'))
const Compositions = lazy(() => import('./pages/Compositions'))
const Economy = lazy(() => import('./pages/Economy'))
const Patches = lazy(() => import('./pages/Patches'))
const Records = lazy(() => import('./pages/Records'))
const Statistics = lazy(() => import('./pages/Statistics'))
const Statistic = lazy(() => import('./pages/Statistic'))
const Graphics = lazy(() => import('./pages/Graphics'))
const MatchRedirect = lazy(() => import('./pages/MatchRedirect'))

function AppSurface() {
  return (
    <div className="portal-shell">
      <TopNav />
      {/* min-w-0 lets wide tables scroll inside their own container. */}
      <main id="main-content" className="portal-main min-w-0" tabIndex={-1}>
        <Suspense fallback={<div className="text-muted text-sm">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/tournaments" replace />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/tournaments/:event" element={<TournamentDetail />} />
            <Route path="/event-stats" element={<EventStats />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:name" element={<PlayerProfile />} />
            <Route path="/compare" element={<ComparePlayers />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:name" element={<TeamProfile />} />
            <Route path="/coaches/:id" element={<CoachProfile />} />
            <Route path="/ratings" element={<Ratings />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/compositions" element={<Compositions />} />
            <Route path="/economy" element={<Economy />} />
            <Route path="/patches" element={<Patches />} />
            <Route path="/records" element={<Records />} />
            <Route path="/statistics" element={<Statistics />} />
            <Route path="/statistics/:entity/:stat" element={<Statistic />} />
            <Route path="/graphics" element={<Graphics />} />
            <Route path="/matches/:id" element={<MatchRedirect />} />
            <Route path="/analysis" element={<Navigate to="/statistics" replace />} />
            <Route path="*" element={<div className="py-12"><h1 className="text-2xl font-semibold">Page not found</h1><a className="data-link" href="/tournaments">Go to overview</a></div>} />
          </Routes>
        </Suspense>
        <footer className="portal-footer">VCT Data <span>Independent statistics · Not affiliated with Riot Games</span></footer>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppSurface />
    </BrowserRouter>
  )
}
