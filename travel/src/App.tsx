import { firebaseConfigured } from './lib/firebase'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import AiPage from './ai/AiPage'
import CommutePage from './commute/CommutePage'
import { AuthProvider, RequireAuth, useAuth } from './lib/auth'
import { Skeleton, StatusProvider } from './lib/status'
import CreditsPage from './pages/CreditsPage'
import Dashboard from './pages/Dashboard'
import HomePage from './pages/HomePage'
import JoinPage from './pages/JoinPage'
import LoginPage from './pages/LoginPage'
import TourPage from './tour/TourPage'
import TripPage from './tour/TripPage'
import AppShell from './ui/AppShell'

/** Signed-in page: auth guard + the Tripzy navbar. */
const app = (el: ReactNode) => (
  <RequireAuth>
    <AppShell>{el}</AppShell>
  </RequireAuth>
)

/** "/" is the intro page for visitors and the dashboard once signed in. */
function Home() {
  const { user, loading } = useAuth()
  if (loading) return <div className="mx-auto max-w-3xl p-6"><Skeleton lines={4} /></div>
  return user ? <AppShell><Dashboard /></AppShell> : <HomePage />
}

export default function App() {
  if (!firebaseConfigured) return <main className="mx-auto max-w-xl px-6 py-24"><h1 className="font-serif text-4xl">Travel workspace is getting ready</h1><p className="my-6">Daily Traveller, group tours and Tripzy AI need their account service to be connected. Your existing trips, Travel DNA and Live Companion are available as usual.</p><a className="btn" href="/dashboard">Return to my trips</a></main>
  return (
    <BrowserRouter basename="/travel">
      <AuthProvider>
        <StatusProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/credits" element={<CreditsPage />} />
            <Route path="/commute" element={app(<CommutePage />)} />
            <Route path="/tour" element={app(<TourPage />)} />
            <Route path="/tour/:tripId" element={app(<TripPage />)} />
            <Route path="/join/:code" element={app(<JoinPage />)} />
            <Route path="/ai" element={app(<AiPage />)} />
            <Route path="/ai/:chatId" element={app(<AiPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </StatusProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
