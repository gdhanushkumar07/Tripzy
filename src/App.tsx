import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router'
import CommutePage from './commute/CommutePage'
import { AuthProvider, RequireAuth, useAuth } from './lib/auth'
import { OfflineBanner, StatusProvider } from './lib/status'
import Dashboard from './pages/Dashboard'
import JoinPage from './pages/JoinPage'
import LoginPage from './pages/LoginPage'
import TourPage from './tour/TourPage'
import TripPage from './tour/TripPage'

function Header() {
  const { user, profile, logout } = useAuth()
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:text-slate-900'}`
  return (
    <header className="sticky top-0 z-[500] border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-3 py-2">
        <NavLink to="/" className="mr-2 flex items-center gap-1 text-lg font-bold text-brand-800" aria-label="Tripzy home">
          <span aria-hidden>🧭</span> Tripzy
        </NavLink>
        {user && (
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Main">
            <NavLink to="/commute" className={link}>Daily Traveller</NavLink>
            <NavLink to="/tour" className={link} end={false}>Tourist Planner</NavLink>
          </nav>
        )}
        {user && (
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 sm:inline">{profile.name}</span>
            <button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void logout()}>Log out</button>
          </div>
        )}
      </div>
      <OfflineBanner />
    </header>
  )
}

function Layout() {
  return (
    <div className="min-h-screen pb-16">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  )
}

const guard = (el: React.ReactNode) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StatusProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={guard(<Dashboard />)} />
              <Route path="/commute" element={guard(<CommutePage />)} />
              <Route path="/tour" element={guard(<TourPage />)} />
              <Route path="/tour/:tripId" element={guard(<TripPage />)} />
              <Route path="/join/:code" element={guard(<JoinPage />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </StatusProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
