import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

const Start = lazy(() => import('./pages/Start'))
const Analysis = lazy(() => import('./pages/Analysis'))

function AppSurface() {
  const { pathname } = useLocation()
  const isCanvas = pathname === '/analysis'

  return (
    <div className={isCanvas ? 'analysis-shell' : 'start-shell'}>
      <main id="main-content" className={isCanvas ? 'analysis-main' : 'start-main'} tabIndex={-1}>
        <Suspense fallback={<div className="start-stage text-sm text-muted">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Start />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
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
