import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Menu, X } from 'lucide-react'
import { useAuthStore } from '../store/authStore'

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="flex items-center" aria-label="Tripzy home">
      <img src={light ? '/logo-light.svg' : '/logo-dark.svg'} alt="Tripzy" className={`h-9 ${light ? '' : 'dark:hidden'}`} />
      {!light && <img src="/logo-light.svg" alt="" aria-hidden className="hidden h-9 dark:block" />}
    </Link>
  )
}

const LINKS = [
  ['/#discover', 'Discover'],
  ['/#how', 'How it works'],
  ['/#features', 'Features'],
  ['/#about', 'About'],
] as const

export function PublicNav() {
  const authed = useAuthStore((s) => s.isAuthenticated)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-[500] border-b border-edge bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5">
        <Brand />
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className="text-body font-medium text-content-secondary transition hover:text-content">{label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {authed ? (
            <button type="button" onClick={() => nav('/dashboard')} className="h-10 rounded-xl bg-accent px-5 text-body font-semibold text-accent-text hover:bg-accent-hover">Open Tripzy</button>
          ) : (
            <>
              <Link to="/login" className="h-10 rounded-xl px-4 text-body font-semibold leading-10 text-content hover:bg-surface-hover">Sign in</Link>
              <Link to="/signup" className="h-10 rounded-xl bg-accent px-5 text-body font-semibold leading-10 text-accent-text hover:bg-accent-hover">Get started</Link>
            </>
          )}
        </div>
        <button type="button" className="grid h-10 w-10 place-items-center rounded-xl border border-edge md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-edge bg-surface px-5 py-4 md:hidden">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)} className="block py-2.5 text-body font-medium text-content">{label}</a>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/login" className="h-11 rounded-xl border border-edge text-center text-body font-semibold leading-[44px] text-content">Sign in</Link>
            <Link to="/signup" className="h-11 rounded-xl bg-accent text-center text-body font-semibold leading-[44px] text-accent-text">Get started</Link>
          </div>
        </div>
      )}
    </header>
  )
}

export function PublicFooter() {
  const cols: [string, [string, string][]][] = [
    ['Product', [['/plan', 'Plan a trip'], ['/#how', 'How it works'], ['/status', 'Service status'], ['/login', 'Sign in']]],
    ['Features', [['/#features', 'Travel DNA'], ['/#features', 'Feasibility intelligence'], ['/#features', 'Ripple re-planning'], ['/#features', 'Trip Capsule']]],
    ['Company', [['/#about', 'About'], ['mailto:hello@tripzy.app', 'Contact'], ['/privacy', 'Privacy'], ['/terms', 'Terms']]],
  ]
  return (
    <footer className="border-t border-edge bg-surface-secondary">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Brand />
          <p className="mt-3 max-w-xs text-body text-content-muted">Your journey. Intelligently orchestrated. One tourist, one package, a better trip.</p>
          <p className="mt-4 text-caption text-content-faint">Maps © OpenStreetMap contributors · Routes OSRM · Weather Open-Meteo · Photos Wikimedia Commons</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <div className="text-caption font-semibold uppercase tracking-wider text-content-muted">{title}</div>
            <ul className="mt-3 space-y-2">
              {links.map(([href, label]) => (
                <li key={label}>
                  {href.startsWith('/') && !href.includes('#')
                    ? <Link to={href} className="text-body text-content-secondary hover:text-content">{label}</Link>
                    : <a href={href} className="text-body text-content-secondary hover:text-content">{label}</a>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-edge">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-caption text-content-faint">
          <span>© {new Date().getFullYear()} Tripzy. Built on the open-source TREK platform (AGPL-3.0).</span>
          <span>Made in India for travellers everywhere.</span>
        </div>
      </div>
    </footer>
  )
}

export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface text-content">
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
    </div>
  )
}
