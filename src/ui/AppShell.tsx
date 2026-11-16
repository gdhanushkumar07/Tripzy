import { ChevronDown, Home, LogOut, Moon, Route, Sparkles, Sun, Luggage } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../lib/auth'
import { OfflineBanner } from '../lib/status'
import { Brand } from './PublicLayout'

const TABS = [
  { path: '/', label: 'Home', Icon: Home, match: (p: string) => p === '/' },
  { path: '/commute', label: 'Daily Traveller', Icon: Route, match: (p: string) => p.startsWith('/commute') },
  { path: '/tour', label: 'Tourist Planner', Icon: Luggage, match: (p: string) => p.startsWith('/tour') },
  { path: '/ai', label: 'Tripzy AI', Icon: Sparkles, match: (p: string) => p.startsWith('/ai') },
]

/**
 * Remember the last page visited inside each section (per account), so a tab
 * reopens your plan or chat instead of starting over.
 */
const lastKey = (uid: string, path: string) => `tripzy:last:${uid}:${path}`
function useLastPlaces(uid: string | undefined) {
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (!uid) return
    const tab = TABS.find((t) => t.path !== '/' && t.match(pathname))
    if (!tab) return
    try { localStorage.setItem(lastKey(uid, tab.path), pathname + search) } catch { /* storage blocked */ }
  }, [uid, pathname, search])
  return (path: string) => readLast(uid, path)
}
function readLast(uid: string | undefined, path: string) {
  if (!uid || path === '/') return path
  try { return localStorage.getItem(lastKey(uid, path)) || path } catch { return path }
}

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('tripzy:theme', dark ? 'dark' : 'light') } catch { /* storage blocked */ }
  }, [dark])
  return [dark, () => setDark((d) => !d)]
}

/**
 * The signed-in navbar, in the original Tripzy look: glass bar, brand on the left,
 * the centred liquid-glass tab pill, then the light/dark toggle and the user menu.
 */
function Navbar() {
  const { user, profile, logout } = useAuth()
  const { pathname } = useLocation()
  const [dark, toggleDark] = useDarkMode()
  const [open, setOpen] = useState(false)
  const name = profile.name || user?.email?.split('@')[0] || 'Traveller'
  const lastIn = useLastPlaces(user?.uid)

  return (
    <nav className="tz-glass fixed inset-x-0 top-0 z-[500] border-b border-edge">
      <div className="mx-auto flex h-[var(--nav-h)] max-w-[1400px] items-center gap-3 px-4 md:px-8">
        <div className="flex min-w-max flex-1 basis-0 items-center"><Brand /></div>

        <div
          className="flex min-w-0 shrink gap-1 overflow-x-auto rounded-[14px] border border-edge-faint p-1 [scrollbar-width:none]"
          style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', backdropFilter: 'blur(20px) saturate(180%)' }}
        >
          {TABS.map(({ path, label, Icon, match }) => {
            const active = match(pathname)
            return (
              <Link
                key={path} to={lastIn(path)} aria-label={label} aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-[5px] text-[13.5px] font-medium transition-colors sm:px-4 ${
                  active ? 'bg-surface-card text-content shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.05)]' : 'text-content-muted hover:text-content'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            )
          })}
        </div>

        <div className="flex min-w-max flex-1 basis-0 items-center justify-end gap-2">
          <button
            type="button" onClick={toggleDark} title={dark ? 'Light mode' : 'Dark mode'} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="relative hidden h-8 w-8 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-hover sm:flex"
          >
            <Sun className="absolute h-4 w-4 transition-[transform,opacity] duration-300" style={{ opacity: dark ? 1 : 0, transform: dark ? 'rotate(0) scale(1)' : 'rotate(-90deg) scale(.6)' }} />
            <Moon className="absolute h-4 w-4 transition-[transform,opacity] duration-300" style={{ opacity: dark ? 0 : 1, transform: dark ? 'rotate(90deg) scale(.6)' : 'rotate(0) scale(1)' }} />
          </button>
          <div className="relative">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-hover sm:px-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-inverse text-xs font-bold text-inverse-text">{name.charAt(0).toUpperCase()}</span>
              <span className="hidden max-w-40 truncate text-sm text-content-secondary sm:inline">{name}</span>
              <ChevronDown className="h-4 w-4 text-content-faint" />
            </button>
            {open && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" role="presentation" onClick={() => setOpen(false)} />
                <div role="menu" className="tz-rise fixed end-2 z-[9999] w-56 overflow-hidden rounded-xl border border-edge bg-surface-card shadow-dropdown" style={{ top: 'var(--nav-h)' }}>
                  <div className="border-b border-edge-secondary px-4 py-3">
                    <p className="text-sm font-medium text-content">{name}</p>
                    <p className="truncate text-xs text-content-muted">{user?.email}</p>
                  </div>
                  <button type="button" role="menuitem" onClick={() => { toggleDark(); setOpen(false) }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-content-secondary hover:bg-surface-hover sm:hidden">
                    {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{dark ? 'Light mode' : 'Dark mode'}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setOpen(false); void logout() }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger transition-colors hover:bg-danger-soft">
                    <LogOut className="h-4 w-4" />Log out
                  </button>
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>
      </div>
      <OfflineBanner />
    </nav>
  )
}

/** Standard signed-in page chrome: themed root, the fixed navbar, content offset below it. */
export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  return (
    <div className="min-h-screen bg-surface text-content">
      <Navbar />
      <div style={{ paddingTop: 'var(--nav-h)' }}>{children}</div>
      {/* Tripzy AI is one tap away from Daily Traveller and the Tourist Planner */}
      {!pathname.startsWith('/ai') && (
        <Link to={readLast(user?.uid, '/ai')} className="btn fixed bottom-5 end-5 z-30 !rounded-full shadow-lg" aria-label="Ask Tripzy AI"><Sparkles className="h-4 w-4" />Ask Tripzy AI</Link>
      )}
    </div>
  )
}
