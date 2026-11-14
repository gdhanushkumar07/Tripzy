import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { scrollY } from './motion'

/** The Tripzy mark: a sun over a horizon, in forest and warm orange. */
export function Emblem({ className = 'h-8 w-8', light = false }: { className?: string; light?: boolean }) {
  return (
    <svg viewBox="0 0 34 34" className={className} aria-hidden>
      <circle cx="17" cy="17" r="16" fill={light ? '#F7F5EF' : 'var(--accent)'} />
      <path d="M5.5 22c3.8-2.4 7.6-3.6 11.5-3.6s7.7 1.2 11.5 3.6" stroke={light ? '#315C4C' : '#F7F5EF'} strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="17" cy="12.6" r="4.2" fill="#D98955" />
    </svg>
  )
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Tripzy home">
      <Emblem light={light} />
      <span className={`font-serif text-[28px] leading-none tracking-tight ${light ? 'text-white' : 'text-content'}`}>Tripzy</span>
    </Link>
  )
}

const LINKS = [
  ['/#story', 'The journey'],
  ['/#companion', 'Companion'],
  ['/plan', 'Plan a trip'],
] as const

/** Minimal navigation. With `overlay`, it floats transparent over a hero photo until you scroll. */
export function PublicNav({ overlay = false }: { overlay?: boolean }) {
  const authed = useAuthStore((s) => s.isAuthenticated)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(!overlay)

  useEffect(() => {
    if (!overlay) return
    const read = () => setScrolled(scrollY() > 60)
    read()
    // capture: catches scrolling of either the document or <body>
    document.addEventListener('scroll', read, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', read, { capture: true })
  }, [overlay])

  const onPhoto = overlay && !scrolled && !open
  const linkCls = `text-[14px] font-medium transition-colors ${onPhoto ? 'text-white/85 hover:text-white' : 'text-content-secondary hover:text-content'}`

  return (
    <header
      data-tz-nav
      className={`${overlay ? 'fixed inset-x-0' : 'sticky'} top-0 z-[500] transition-[background-color,border-color,backdrop-filter] duration-500 ${
        onPhoto ? 'border-b border-transparent bg-transparent' : 'border-b border-edge bg-surface/85 backdrop-blur-md'
      }`}
    >
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between gap-6 px-5 md:px-10">
        <Brand light={onPhoto} />
        <nav className="hidden items-center gap-9 md:flex" aria-label="Main">
          {LINKS.map(([href, label]) => (
            href.includes('#')
              ? <a key={href} href={href} className={linkCls}>{label}</a>
              : <Link key={href} to={href} className={linkCls}>{label}</Link>
          ))}
        </nav>
        <div className="hidden items-center gap-1.5 md:flex">
          {authed ? (
            <button type="button" onClick={() => nav('/dashboard')} className={`h-10 rounded-full px-5 text-[14px] font-semibold transition ${onPhoto ? 'bg-white text-[#18211F] hover:bg-white/90' : 'bg-accent text-accent-text hover:bg-accent-hover'}`}>Open Tripzy</button>
          ) : (
            <>
              <Link to="/login" className={`h-10 rounded-full px-4 text-[14px] font-semibold leading-10 transition ${onPhoto ? 'text-white hover:bg-white/10' : 'text-content hover:bg-surface-hover'}`}>Sign in</Link>
              <Link to="/signup" className={`h-10 rounded-full px-5 text-[14px] font-semibold leading-10 transition ${onPhoto ? 'bg-white text-[#18211F] hover:bg-white/90' : 'bg-accent text-accent-text hover:bg-accent-hover'}`}>Get started</Link>
            </>
          )}
        </div>
        <button type="button" className={`grid h-11 w-11 place-items-center rounded-full md:hidden ${onPhoto ? 'text-white' : 'border border-edge text-content'}`} aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-edge bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 md:hidden">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)} className="block border-b border-edge py-4 font-serif text-[26px] text-content">{label}</a>
          ))}
          <div className="mt-5 grid grid-cols-2 gap-2">
            {authed ? (
              <Link to="/dashboard" className="col-span-2 h-12 rounded-full bg-accent text-center text-body font-semibold leading-[48px] text-accent-text">Open Tripzy</Link>
            ) : (
              <>
                <Link to="/login" className="h-12 rounded-full border border-edge text-center text-body font-semibold leading-[48px] text-content">Sign in</Link>
                <Link to="/signup" className="h-12 rounded-full bg-accent text-center text-body font-semibold leading-[48px] text-accent-text">Get started</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

export function PublicFooter() {
  const cols: [string, [string, string][]][] = [
    ['Travel', [['/plan', 'Plan a trip'], ['/#story', 'How Tripzy works'], ['/login', 'Sign in'], ['/signup', 'Create an account']]],
    ['Trust', [['/status', 'Live service status'], ['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/credits', 'Photo credits']]],
  ]
  return (
    <footer className="bg-[#18211F] text-[#F7F5EF]">
      <div className="mx-auto max-w-[1400px] px-5 pb-10 pt-20 md:px-10">
        <div className="grid gap-12 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Brand light />
            <p className="mt-6 max-w-sm font-serif text-[28px] leading-[1.15] text-[#F7F5EF]/90">Every journey has a story. Let's make yours unforgettable.</p>
          </div>
          {cols.map(([title, links]) => (
            <div key={title}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6A39B]">{title}</div>
              <ul className="mt-5 space-y-3">
                {links.map(([href, label]) => (
                  <li key={label}>
                    {href.includes('#')
                      ? <a href={href} className="tz-link text-[15px] text-[#F7F5EF]/80 hover:text-[#F7F5EF]">{label}</a>
                      : <Link to={href} className="tz-link text-[15px] text-[#F7F5EF]/80 hover:text-[#F7F5EF]">{label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-20 flex flex-col gap-3 border-t border-white/10 pt-6 text-[12px] text-[#A6A39B] md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} Tripzy · Built on the open-source TREK platform (AGPL-3.0)</span>
          <span>Maps © OpenStreetMap · Routes OSRM · Weather Open-Meteo · Photos Wikimedia Commons <Link to="/credits" className="inline-flex items-center underline underline-offset-2">credits<ArrowUpRight className="h-3 w-3" /></Link></span>
        </div>
      </div>
    </footer>
  )
}

export function PublicPage({ children, overlay = false }: { children: React.ReactNode; overlay?: boolean }) {
  return (
    <div className="min-h-screen bg-surface text-content">
      <PublicNav overlay={overlay} />
      <main>{children}</main>
      <PublicFooter />
    </div>
  )
}
