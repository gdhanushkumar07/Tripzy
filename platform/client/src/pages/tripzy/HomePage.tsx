import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowDown, ArrowRight, BedDouble, BookHeart, Check, CloudRain, FileText, Landmark, Luggage, Map as MapIcon, MessageCircle,
  Plane, Receipt, Repeat, Route, ShieldCheck, Sparkles, Ticket, Wallet,
} from 'lucide-react'
import { PublicPage, Emblem } from '../../tripzy/PublicLayout'
import { PHOTOS, credit, photoSrc, photoSrcSet, type PhotoId } from '../../tripzy/photos'
import { gsap, prefersReducedMotion, useDocumentScroll, useGSAP, useReveal } from '../../tripzy/motion'
import { engine } from '../../tripzy/engine'

/* ======================================================================
   Tripzy homepage: eight chapters, one journey.
   Motion: GSAP + ScrollTrigger, scoped per chapter (useGSAP reverts on unmount).
   Reduced motion: every chapter renders its final, readable state.
   ====================================================================== */

export default function HomePage(): React.ReactElement {
  useEffect(() => {
    document.title = 'Tripzy · Some journeys stay with you forever'
  }, [])
  useDocumentScroll()
  return (
    <PublicPage overlay>
      <Opening />
      <Problem />
      <Solution />
      <PlanYourWay />
      <BeReady />
      <Companion />
      <Memories />
      <Invitation />
    </PublicPage>
  )
}

// ---------------------------------------------------------------- shared bits

function Photo({ id, className = '', imgClassName = '', eager = false, sizes = '100vw', showCredit = true, alt }: {
  id: PhotoId; className?: string; imgClassName?: string; eager?: boolean; sizes?: string; showCredit?: boolean; alt?: string
}) {
  return (
    <figure className={`tz-photo ${className}`}>
      <img
        src={photoSrc(id)} srcSet={photoSrcSet(id)} sizes={sizes} alt={alt ?? PHOTOS[id].place}
        loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})}
        className={imgClassName}
      />
      {showCredit && <figcaption className="tz-credit pointer-events-none absolute bottom-2 right-3 max-w-[80%] truncate text-right drop-shadow">{PHOTOS[id].place} · {PHOTOS[id].author} · {PHOTOS[id].license}</figcaption>}
    </figure>
  )
}

function Chapter({ n, title, light = false }: { n: string; title: string; light?: boolean }) {
  return (
    <div data-reveal className={`flex items-center gap-3 ${light ? 'text-white/70' : 'text-content-muted'}`}>
      <span className="font-serif text-[18px] italic text-[var(--tz-sun)]">{n}</span>
      <span className="h-px w-10 bg-current opacity-40" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">{title}</span>
    </div>
  )
}

function Lines({ lines, className = '' }: { lines: string[]; className?: string }) {
  return (
    <span className={className}>
      {lines.map((l) => (
        <span key={l} className="block overflow-hidden pb-[0.08em]"><span data-line className="block will-change-transform">{l}</span></span>
      ))}
    </span>
  )
}

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })

// ---------------------------------------------------------------- 01 · the opening

function Opening() {
  const nav = useNavigate()
  const root = useRef<HTMLElement>(null)
  useGSAP(() => {
    const q = gsap.utils.selector(root)
    if (prefersReducedMotion()) return
    const navEl = document.querySelector('[data-tz-nav]')
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    tl.fromTo(q('[data-hero-img]'), { scale: 1.18 }, { scale: 1.04, duration: 2.6, ease: 'power2.out' }, 0)
      .fromTo(q('[data-hero-veil]'), { opacity: 1 }, { opacity: 0, duration: 1.4 }, 0)
      .fromTo(q('[data-line]'), { yPercent: 110 }, { yPercent: 0, duration: 1.25, stagger: 0.12 }, 0.35)
      .fromTo(q('[data-hero-sub]'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.1 }, 0.95)
    if (navEl) tl.fromTo(navEl, { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.9, clearProps: 'transform,opacity' }, 0.7)
    gsap.to(q('[data-hero-img]'), {
      yPercent: 14, ease: 'none',
      scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
    })
    gsap.to(q('[data-hero-copy]'), {
      yPercent: -18, opacity: 0.2, ease: 'none',
      scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
    })
    return () => { if (navEl) gsap.set(navEl, { clearProps: 'transform,opacity' }) }
  }, { scope: root })

  return (
    <section ref={root} className="relative h-[100svh] min-h-[620px] overflow-hidden bg-[#18211F] text-white" aria-label="Tripzy">
      <div data-hero-img className="absolute inset-0 will-change-transform">
        <Photo id="amber-fort" eager showCredit={false} className="h-full w-full" imgClassName="object-[50%_60%]" alt="Amber Fort above Maota Lake, Jaipur, in warm morning light" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-[#18211F]/90 via-[#18211F]/25 to-[#18211F]/35" />
      <div data-hero-veil className="absolute inset-0 bg-[#18211F] opacity-0" />
      <div data-hero-copy className="relative mx-auto flex h-full max-w-[1400px] flex-col justify-end px-5 pb-16 md:px-10 md:pb-24">
        <h1 className="tz-display max-w-[13ch] text-white">
          <Lines lines={['Some journeys', 'stay with you', 'forever.']} />
        </h1>
        <p data-hero-sub className="mt-6 max-w-md text-[18px] leading-relaxed text-white/85 md:text-[20px]">Let's make every moment along the way count.</p>
        <div data-hero-sub className="mt-9 flex flex-wrap gap-3">
          <button type="button" onClick={() => nav('/plan')} className="group inline-flex h-14 items-center gap-3 rounded-full bg-[#F7F5EF] px-7 text-[15px] font-semibold text-[#18211F] transition hover:bg-white">
            Plan your journey <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
          <button type="button" onClick={() => scrollToId('story')} className="inline-flex h-14 items-center gap-2 rounded-full border border-white/40 px-7 text-[15px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/10">
            Discover Tripzy
          </button>
        </div>
      </div>
      <div className="absolute bottom-5 right-5 hidden items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-white/60 md:flex md:right-10">
        <span>{credit('amber-fort')}</span>
      </div>
      <button type="button" onClick={() => scrollToId('story')} aria-label="Scroll to the story" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 text-white/70 md:block">
        <ArrowDown className="h-5 w-5 animate-bounce motion-reduce:animate-none" />
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- 02 · the problem

type Fragment = { key: string; x: string; y: string; r: number; w: string; node: React.ReactNode }
const FRAGMENTS: Fragment[] = [
  { key: 'tabs', x: '2%', y: '4%', r: -4, w: 'w-[300px]', node: (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface-card">
      <div className="flex gap-1 bg-surface-tertiary px-2 pt-2">
        {['Hotels in Jaipur', 'Flights DEL→JAI', 'Amber Fort timi…', '+11'].map((t, i) => (
          <span key={t} className={`truncate rounded-t-md px-2 py-1 text-[11px] ${i === 0 ? 'bg-surface-card text-content' : 'text-content-muted'}`}>{t}</span>
        ))}
      </div>
      <div className="space-y-1.5 p-3">{[80, 64, 72].map((w) => <div key={w} className="h-2 rounded bg-surface-tertiary" style={{ width: `${w}%` }} />)}</div>
    </div>) },
  { key: 'flight', x: '58%', y: '0%', r: 5, w: 'w-[230px]', node: (
    <div className="rounded-xl border border-edge bg-surface-card p-3">
      <div className="flex items-center gap-2 text-[11px] text-content-muted"><Plane className="h-3.5 w-3.5" />Booking confirmation</div>
      <div className="mt-1 font-serif text-[22px] text-content">DEL → JAI</div>
      <div className="text-[12px] text-content-muted">Fri · 06:40 · seat 14C</div>
    </div>) },
  { key: 'notes', x: '70%', y: '40%', r: -3, w: 'w-[220px]', node: (
    <div className="rounded-xl bg-[#FFF6C9] p-3 text-[13px] leading-snug text-[#4b4320] shadow-sm">
      <div className="font-semibold">notes!!</div>ask hotel re early check-in<br />dad – no long stairs<br />Hawa Mahal before 10?
    </div>) },
  { key: 'budget', x: '4%', y: '48%', r: 3, w: 'w-[250px]', node: (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface-card text-[12px]">
      {[['Hotel', '₹ ?'], ['Cabs', '₹1,800'], ['Food', '₹ ?'], ['Total', '#REF!']].map(([a, b]) => (
        <div key={a} className="grid grid-cols-2 border-b border-edge last:border-0"><span className="border-r border-edge px-2 py-1.5 text-content-muted">{a}</span><span className="px-2 py-1.5 text-content">{b}</span></div>
      ))}
    </div>) },
  { key: 'map', x: '36%', y: '58%', r: -6, w: 'w-[200px]', node: (
    <div className="rounded-xl border border-edge bg-[#e9efe6] p-3">
      <svg viewBox="0 0 160 90" className="h-20 w-full"><path d="M5 70 C 40 20, 70 80, 100 40 S 150 30, 155 10" stroke="#315C4C" strokeWidth="2" fill="none" strokeDasharray="4 4" /><circle cx="100" cy="40" r="5" fill="#D98955" /></svg>
      <div className="text-[11px] text-content-muted">14 pins · 3 lists · 0 routes</div>
    </div>) },
  { key: 'pack', x: '40%', y: '20%', r: 2, w: 'w-[190px]', node: (
    <div className="rounded-xl border border-edge bg-surface-card p-3 text-[12px] text-content-secondary">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-content"><Luggage className="h-3.5 w-3.5" />Packing?</div>
      <div>☐ charger</div><div>☐ ID</div><div>☐ …</div>
    </div>) },
  { key: 'docs', x: '74%', y: '74%', r: 6, w: 'w-[180px]', node: (
    <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface-card p-3 text-[12px] text-content-secondary"><FileText className="h-4 w-4 text-[var(--tz-sun)]" />e-ticket_final_v2.pdf</div>) },
]

function Problem() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)
  useGSAP(() => {
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()
    mm.add({ desktop: '(min-width: 1024px)', reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      const { desktop, reduce } = ctx.conditions as { desktop: boolean; reduce: boolean }
      if (reduce) {
        // no scroll story: show both statements, one after the other
        gsap.set(q('[data-head-b]'), { position: 'static', opacity: 1, marginTop: 40 })
        return
      }
      const frags = q('[data-frag]')
      if (!desktop) {
        gsap.from(frags, { opacity: 0, y: 40, rotation: 0, stagger: 0.08, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: q('[data-stage]')[0], start: 'top 80%', once: true } })
        return
      }
      const stage = q('[data-stage]')[0] as HTMLElement
      const tl = gsap.timeline({
        scrollTrigger: { trigger: root.current, start: 'top top', end: '+=140%', scrub: 0.8, pin: true, anticipatePin: 1, invalidateOnRefresh: true },
      })
      tl.from(frags, { opacity: 0, y: 120, rotation: (i) => (i % 2 ? 14 : -12), stagger: 0.08, duration: 0.5, ease: 'power2.out' })
        .to({}, { duration: 0.25 })
        .to(frags, {
          x: (_i, el: HTMLElement) => stage.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2),
          y: (_i, el: HTMLElement) => stage.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2),
          rotation: 0, scale: 0.55, opacity: 0, duration: 0.7, ease: 'power2.in', stagger: 0.03,
        })
        .to(q('[data-head-a]'), { yPercent: -30, opacity: 0, duration: 0.3 }, '<0.2')
        .fromTo(q('[data-head-b]'), { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.35 }, '<0.15')
        .fromTo(q('[data-capsule]'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.6)' }, '<0.2')
    })
    return () => mm.revert()
  }, { scope: root })

  return (
    <section id="story" ref={root} className="relative overflow-hidden bg-surface lg:h-[100svh]">
      <div className="mx-auto grid h-full max-w-[1400px] items-center gap-12 px-5 py-24 md:px-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-0">
        <div>
          <Chapter n="02" title="The problem" />
          <h2 className="tz-h1 mt-6 text-content">The journey starts long before you leave.</h2>
          <div className="relative mt-8 min-h-[150px]">
            <div data-head-a>
              <p className="font-serif text-[30px] leading-tight text-content md:text-[38px]">Too many tabs.<br />Too many decisions.</p>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-content-muted">Hotels in one tab, trains in another, a note about Dad's knees somewhere, and a budget that never adds up.</p>
            </div>
            <div data-head-b className="absolute inset-0 opacity-0 max-lg:static max-lg:mt-10 max-lg:opacity-100">
              <p className="font-serif text-[30px] leading-tight text-[var(--accent)] md:text-[38px]">Your journey<br />deserves better.</p>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-content-muted">One Trip Capsule that holds the plan, the bookings, the money and the moments, and keeps them in sync.</p>
            </div>
          </div>
        </div>
        <div data-stage className="relative h-[560px] max-lg:h-auto">
          <div className="max-lg:grid max-lg:grid-cols-2 max-lg:gap-3">
            {FRAGMENTS.map((f) => (
              <div key={f.key} data-frag className={`lg:absolute ${f.w} max-lg:w-full`} style={{ left: f.x, top: f.y, transform: `rotate(${f.r}deg)` }}>
                {f.node}
              </div>
            ))}
          </div>
          <div data-capsule className="pointer-events-none absolute left-1/2 top-1/2 hidden w-[300px] -translate-x-1/2 -translate-y-1/2 opacity-0 lg:block">
            <div className="overflow-hidden rounded-[26px] border border-edge bg-surface-card shadow-[0_30px_80px_-30px_rgba(24,33,31,.45)]">
              <Photo id="hawa-mahal" sizes="300px" showCredit={false} className="h-36" />
              <div className="p-5">
                <div className="tz-kicker">Trip Capsule</div>
                <div className="mt-1 font-serif text-[26px] leading-tight text-content">Jaipur, 3 days</div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  {['Itinerary', 'Train', 'Stay', 'Budget', 'Packing', 'Docs'].map((x) => <span key={x} className="rounded-full bg-accent-subtle px-2 py-0.5 text-accent-on">{x}</span>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 03 · the solution

const NODES: [string, React.ComponentType<{ className?: string }>, string][] = [
  ['Itinerary', Route, 'Timed, feasible, yours'],
  ['Stay', BedDouble, 'Least travel to what you love'],
  ['Trains & flights', Ticket, 'Fixed anchors, watched for delays'],
  ['Readiness', ShieldCheck, 'Checklist that ticks itself'],
  ['Documents', FileText, 'Tickets read, stored privately'],
  ['Budget', Wallet, 'Full cost before you go'],
  ['Expenses', Receipt, 'Split and settle with the group'],
  ['Maps', MapIcon, 'Real roads, real times'],
  ['Companion', MessageCircle, 'Re-plans with your OK'],
  ['Memories', BookHeart, 'A journal that learns you'],
]

function Solution() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)
  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(root)
    const tl = gsap.timeline({ scrollTrigger: { trigger: q('[data-orbit]')[0], start: 'top 70%', once: true } })
    tl.fromTo(q('[data-core]'), { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'power3.out' })
      .fromTo(q('[data-spoke]'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, stagger: 0.05, ease: 'power2.inOut' }, '-=0.4')
      .fromTo(q('[data-node]'), { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.5, stagger: 0.05, ease: 'back.out(1.7)' }, '-=0.7')
  }, { scope: root })

  const pos = NODES.map((_, i) => {
    const a = (i / NODES.length) * Math.PI * 2 - Math.PI / 2
    return { x: 50 + Math.cos(a) * 41, y: 50 + Math.sin(a) * 40 }
  })

  return (
    <section ref={root} className="relative bg-[var(--tz-ivory)] py-28 dark:bg-surface md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex justify-center"><Chapter n="03" title="The Tripzy solution" /></div>
          <h2 data-reveal className="tz-h1 mt-6 text-content">Everything, finally in one place.</h2>
          <p data-reveal className="tz-lede mx-auto mt-6 max-w-xl">At the centre of every trip is a <em className="font-serif text-[1.15em] not-italic text-[var(--accent)]">Trip Capsule</em>. Everything else orbits it, and when one thing changes, everything connected to it knows.</p>
        </div>

        <div data-orbit className="relative mx-auto mt-16 hidden aspect-[1.35] max-w-5xl md:block">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {pos.map((p, i) => (
              <line key={i} data-spoke x1="50" y1="50" x2={p.x} y2={p.y} pathLength={1} strokeDasharray="1" strokeDashoffset="0" stroke="var(--accent)" strokeOpacity=".35" strokeWidth=".18" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div data-core className="absolute left-1/2 top-1/2 w-[30%] -translate-x-1/2 -translate-y-1/2">
            <div className="overflow-hidden rounded-full border-[6px] border-surface shadow-[0_40px_90px_-40px_rgba(24,33,31,.6)]">
              <Photo id="charminar" sizes="320px" showCredit={false} className="aspect-square" imgClassName="object-[50%_35%]" />
            </div>
            <div className="mt-3 text-center"><div className="tz-kicker">Trip Capsule</div><div className="font-serif text-[22px] text-content">Hyderabad · 3 days</div></div>
          </div>
          {NODES.map(([label, Icon, sub], i) => (
            <div key={label} data-node className="absolute w-[170px] -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}>
              <div className="flex items-center gap-2.5 rounded-2xl border border-edge bg-surface-card px-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-on"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0"><span className="block text-[14px] font-semibold text-content">{label}</span><span className="block truncate text-[11px] text-content-muted">{sub}</span></span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 md:hidden">
          <div data-reveal="mask" className="mx-auto w-2/3 overflow-hidden rounded-full"><Photo id="charminar" sizes="60vw" showCredit={false} className="aspect-square" /></div>
          <div data-reveal data-reveal-stagger className="mt-8 grid grid-cols-2 gap-2.5">
            {NODES.map(([label, Icon, sub]) => (
              <div key={label} className="rounded-2xl border border-edge bg-surface-card p-3">
                <Icon className="h-4 w-4 text-accent-on" /><div className="mt-2 text-[14px] font-semibold text-content">{label}</div><div className="text-[11px] text-content-muted">{sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-24 grid gap-6 md:grid-cols-3">
          {([['/showcase/intel.png', 'Trip Intelligence', 'Every day checked against opening hours, travel time and energy.'],
             ['/showcase/live.png', 'Live', 'Now, next and when to leave, while you travel.'],
             ['/showcase/lab.png', 'Ripple Engine', 'A delay re-planned, shown before anything changes.']] as const).map(([src, t, d], i) => (
            <figure key={src} className={i === 1 ? 'md:mt-16' : ''}>
              <div data-reveal="mask" className="overflow-hidden rounded-[22px] border border-edge bg-surface-card">
                <img src={src} alt={`${t}, a real Tripzy screen`} loading="lazy" className="aspect-[4/3] w-full object-cover object-top" />
              </div>
              <figcaption data-reveal className="mt-4"><span className="font-serif text-[22px] text-content">{t}</span><span className="mt-1 block text-[14px] text-content-muted">{d}</span></figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 text-center text-[12px] text-content-faint">Screens captured from the running Tripzy app.</p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 04 · plan your way

const STOPS = [
  { t: '08:30', name: 'Govind Dosa', note: 'Breakfast near the Old City', x: 70, y: 300, kind: 'meal' },
  { t: '09:20', name: 'Charminar', note: 'Before the crowds build', x: 150, y: 250, kind: 'stop' },
  { t: '11:05', name: 'Chowmahalla Palace', note: 'Flat courtyards, easy on the knees', x: 250, y: 290, kind: 'stop' },
  { t: '13:30', name: 'Rest at the hotel', note: 'Energy reset in the midday heat', x: 330, y: 180, kind: 'rest' },
  { t: '15:30', name: 'Salar Jung Museum', note: 'Indoor, so it is also the rain Plan B', x: 420, y: 230, kind: 'stop' },
  { t: '17:45', name: 'Hussain Sagar', note: 'Golden hour by the lake', x: 520, y: 110, kind: 'stop' },
]
const ROUTE = 'M70 300 C 100 270, 120 250, 150 250 S 220 300, 250 290 S 300 200, 330 180 S 390 240, 420 230 S 490 140, 520 110'

function PlanYourWay() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)
  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(root)
    const map = q('[data-map]')[0]
    gsap.fromTo(q('[data-route]'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: map, start: 'top 75%', end: 'bottom 45%', scrub: 0.6 } })
    gsap.fromTo(q('[data-marker]'), { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, stagger: 0.2, ease: 'back.out(2)', scrollTrigger: { trigger: map, start: 'top 70%', end: 'bottom 50%', scrub: 0.6 } })
    gsap.fromTo(q('[data-stop]'), { opacity: 0, x: -16 }, { opacity: 1, x: 0, stagger: 0.12, duration: 0.6, ease: 'power3.out', scrollTrigger: { trigger: q('[data-stops]')[0], start: 'top 75%', once: true } })
    gsap.fromTo(q('[data-gauge]'), { strokeDashoffset: 1 }, { strokeDashoffset: 0.06, duration: 1.6, ease: 'power2.out', scrollTrigger: { trigger: q('[data-stops]')[0], start: 'top 70%', once: true } })
    gsap.fromTo(q('[data-energy]'), { scaleX: 0 }, { scaleX: 1, duration: 1.4, ease: 'power2.out', transformOrigin: '0 50%', scrollTrigger: { trigger: q('[data-stops]')[0], start: 'top 70%', once: true } })
  }, { scope: root })

  const traits = ['Unhurried pace', 'Travelling with parents', 'No steep climbs', 'Vegetarian', 'History & food', 'Under ₹15,000']

  return (
    <section ref={root} className="bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Chapter n="04" title="Plan your way" />
            <h2 data-reveal className="tz-h1 mt-6 text-content">Not another generic itinerary.</h2>
            <p data-reveal className="tz-lede mt-6 max-w-md">Tell Tripzy who's going and how you like to travel. Your Travel DNA shapes every stop, every meal and every pause. The weakest knee in the group sets the pace, not the guidebook.</p>
            <div data-reveal data-reveal-stagger className="mt-8 flex flex-wrap gap-2">
              {traits.map((t) => <span key={t} className="rounded-full border border-edge bg-surface-card px-3.5 py-1.5 text-[13px] text-content-secondary">{t}</span>)}
            </div>
            <div data-reveal className="mt-10 flex items-center gap-6">
              <div className="relative h-20 w-20">
                <svg viewBox="0 0 40 40" className="h-20 w-20 -rotate-90"><circle cx="20" cy="20" r="17" stroke="var(--border-primary)" strokeWidth="3" fill="none" /><circle data-gauge cx="20" cy="20" r="17" pathLength={1} strokeDasharray="1" strokeDashoffset="0.06" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
                <span className="absolute inset-0 grid place-items-center font-serif text-[26px] text-content">94</span>
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-content">Feasible as planned</div>
                <div className="text-[12px] text-content-muted">Opening hours, real road times and energy all check out.</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-tertiary"><div data-energy className="h-full w-[62%] rounded-full bg-[var(--tz-sun)]" /></div>
                <div className="mt-1 text-[11px] text-content-muted">Energy 62% · comfortable for the group</div>
              </div>
            </div>
          </div>

          <div>
            <div data-map className="relative overflow-hidden rounded-[28px] border border-edge bg-[#ECEAE1] dark:bg-surface-secondary">
              <svg viewBox="0 0 600 380" className="block w-full" role="img" aria-label="Example route across Hyderabad's Old City to Hussain Sagar">
                <defs><pattern id="tz-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#18211F" strokeOpacity=".05" /></pattern></defs>
                <rect width="600" height="380" fill="url(#tz-grid)" />
                {[40, 90, 140].map((o) => <path key={o} d={`M-10 ${200 + o * 0.4} C 150 ${120 + o}, 300 ${260 - o / 2}, 620 ${90 + o}`} stroke="#315C4C" strokeOpacity=".08" fill="none" strokeWidth="1.2" />)}
                <path d="M-10 335 C 120 320, 220 350, 320 330 S 520 300, 620 320" stroke="#9fb9ad" strokeOpacity=".7" strokeWidth="9" fill="none" strokeLinecap="round" />
                <text x="455" y="345" fontSize="11" fill="#6c706a" fontStyle="italic" fontFamily="Instrument Serif, Georgia, serif">Musi river</text>
                <ellipse cx="535" cy="95" rx="48" ry="28" fill="#9fb9ad" fillOpacity=".55" />
                <path data-route d={ROUTE} pathLength={1} strokeDasharray="1" strokeDashoffset="0" stroke="#315C4C" strokeWidth="3" fill="none" strokeLinecap="round" />
                {STOPS.map((s, i) => (
                  <g key={s.name} data-marker>
                    <circle cx={s.x} cy={s.y} r="13" fill={s.kind === 'stop' ? '#315C4C' : s.kind === 'meal' ? '#D98955' : '#A6A39B'} stroke="#F7F5EF" strokeWidth="3" />
                    <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{i + 1}</text>
                  </g>
                ))}
              </svg>
              <div className="absolute left-4 top-4 rounded-full bg-surface-card/90 px-3 py-1 text-[11px] font-medium text-content-muted backdrop-blur">Example day · Hyderabad</div>
            </div>
            <ol data-stops className="mt-8">
              {STOPS.map((s, i) => (
                <li key={s.name} data-stop className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 border-b border-edge py-4 last:border-0">
                  <span className="pt-1 font-serif text-[20px] text-content-muted">{s.t}</span>
                  <div>
                    <div className="flex items-center gap-2"><span className="text-[12px] font-semibold text-content-faint">{String(i + 1).padStart(2, '0')}</span><span className="text-[17px] font-semibold text-content">{s.name}</span></div>
                    <div className="mt-0.5 text-[14px] text-content-muted">{s.note}</div>
                    {s.name === 'Salar Jung Museum' && <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-2.5 py-1 text-[12px] text-accent-on"><CloudRain className="h-3.5 w-3.5" />Plan B ready if it rains</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 05 · be ready

function BeReady() {
  const root = useRef<HTMLElement>(null)
  const [rate, setRate] = useState<{ usd: number; date: string | null } | null>(null)
  useReveal(root)
  useEffect(() => {
    let off = false
    engine.fx('INR').then((f) => { if (!off && f.rates?.USD) setRate({ usd: f.rates.USD, date: f.date }) }).catch(() => undefined)
    return () => { off = true }
  }, [])
  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(root)
    const list = q('[data-checks]')[0]
    gsap.timeline({ scrollTrigger: { trigger: list, start: 'top 75%', end: 'bottom 55%', scrub: 0.6 } })
      .fromTo(q('[data-tick]'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, stagger: 0.3 })
      .fromTo(q('[data-tick-label]'), { color: 'var(--text-primary)' }, { color: 'var(--text-muted)', stagger: 0.3 }, 0)
    gsap.fromTo(q('[data-pack]'), { scaleX: 0 }, { scaleX: 1, transformOrigin: '0 50%', ease: 'none', scrollTrigger: { trigger: list, start: 'top 70%', end: 'bottom 50%', scrub: 0.6 } })
    gsap.to(q('[data-ready-photo] img'), { yPercent: -8, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: true } })
  }, { scope: root })

  const checks = ['Train booked and watched for delays', 'Ticket saved: PNR read from the PDF', 'Stay chosen: 18 min to your stops', 'Original photo ID packed', 'Offline map downloaded']
  return (
    <section ref={root} className="bg-[#18211F] py-28 text-[#F7F5EF] md:py-36">
      <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-5 md:px-10 lg:grid-cols-2 lg:gap-24">
        <div className="relative">
          <div data-ready-photo data-reveal="mask" className="overflow-hidden rounded-[28px]">
            <Photo id="hawa-mahal" sizes="(min-width:1024px) 50vw, 100vw" className="aspect-[4/5] scale-110" imgClassName="object-[50%_40%]" />
          </div>
          <div data-reveal className="absolute -bottom-6 left-5 right-5 rounded-[22px] bg-[#F7F5EF] p-5 text-[#18211F] shadow-2xl md:left-auto md:right-[-28px] md:w-[300px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6c706a]">Departure</div>
            <div className="mt-1 font-serif text-[44px] leading-none">6 days</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e6e2d8]"><div className="h-full w-[75%] rounded-full bg-[#315C4C]" /></div>
            <div className="mt-1.5 text-[12px] text-[#6c706a]">75% ready · example trip</div>
          </div>
        </div>
        <div className="max-lg:pt-6">
          <Chapter n="05" title="Be ready for everything" light />
          <h2 data-reveal className="tz-h1 mt-6">The little things make the journey.</h2>
          <p data-reveal className="mt-6 max-w-md text-[18px] leading-relaxed text-[#F7F5EF]/75">Tripzy turns your plan into preparation: a checklist that ticks itself as bookings land, a packing list built from the forecast and your stops, and a city guide that links to the official source.</p>
          <ul data-checks className="mt-10 space-y-4">
            {checks.map((c) => (
              <li key={c} className="flex items-center gap-4">
                <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0"><circle cx="12" cy="12" r="11" fill="none" stroke="#F7F5EF" strokeOpacity=".25" /><path data-tick d="M7 12.5l3.2 3.2L17 9" pathLength={1} strokeDasharray="1" strokeDashoffset="0" stroke="#D98955" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span data-tick-label className="text-[17px]">{c}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 grid grid-cols-2 gap-6 border-t border-white/10 pt-8">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6A39B]">Packing</div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><div data-pack className="h-full w-[80%] rounded-full bg-[#D98955]" /></div>
              <div className="mt-2 text-[13px] text-[#F7F5EF]/70">11 items, each with a reason</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6A39B]">Currency</div>
              <div className="mt-2 font-serif text-[26px] leading-none">{rate ? `₹1,000 = $${(1000 * rate.usd).toFixed(2)}` : '₹ ⇄ $ € £'}</div>
              <div className="mt-2 text-[13px] text-[#F7F5EF]/70">{rate ? `Live ECB rate · ${rate.date}` : 'Live reference rates'}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 06 · the companion

function Companion() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)
  useGSAP(() => {
    const q = gsap.utils.selector(root)
    if (prefersReducedMotion()) {
      gsap.set(q('[data-typing]'), { display: 'none' })
      return
    }
    const tl = gsap.timeline({ scrollTrigger: { trigger: q('[data-chat]')[0], start: 'top 65%', once: true } })
    tl.from(q('[data-msg-user]'), { opacity: 0, y: 16, duration: 0.5, ease: 'power3.out' })
      .fromTo(q('[data-typing]'), { opacity: 0, height: 0 }, { opacity: 1, height: 'auto', duration: 0.3 }, '+=0.3')
      .to(q('[data-typing]'), { opacity: 0, height: 0, duration: 0.25 }, '+=1.1')
      .from(q('[data-msg-bot]'), { opacity: 0, y: 16, duration: 0.5, ease: 'power3.out' })
      .from(q('[data-diff]'), { opacity: 0, y: 40, scale: 0.96, duration: 0.7, ease: 'power3.out' }, '+=0.2')
      .from(q('[data-diff-row]'), { opacity: 0, x: -12, stagger: 0.12, duration: 0.4 }, '-=0.3')
      .to(q('[data-accept]'), { scale: 0.96, duration: 0.12, yoyo: true, repeat: 1 }, '+=0.8')
      .to(q('[data-accept-label]'), { opacity: 0, duration: 0.15 })
      .fromTo(q('[data-accepted]'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 })
      .to(q('[data-accept]'), { backgroundColor: '#315C4C', duration: 0.3 }, '<')
  }, { scope: root })

  return (
    <section id="companion" ref={root} className="relative overflow-hidden bg-[#18211F] py-28 text-white md:py-36">
      <div className="absolute inset-0 opacity-30"><Photo id="jal-mahal" showCredit={false} className="h-full w-full" /></div>
      <div className="absolute inset-0 bg-gradient-to-r from-[#18211F] via-[#18211F]/90 to-[#18211F]/60" />
      <div className="relative mx-auto grid max-w-[1400px] items-center gap-14 px-5 md:px-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-24">
        <div>
          <Chapter n="06" title="Your companion on the way" light />
          <h2 data-reveal className="tz-h1 mt-6">Plans change. Your journey doesn't have to.</h2>
          <p data-reveal className="mt-6 max-w-md text-[18px] leading-relaxed text-white/75">Rain, a late train, tired legs. Tell Tripzy what happened and it re-plans the rest of the day around what's still possible. It never changes anything until you've seen exactly what moves, and said yes.</p>
          <ul data-reveal data-reveal-stagger className="mt-8 space-y-3 text-[15px] text-white/80">
            <li className="flex gap-3"><Repeat className="mt-0.5 h-4 w-4 shrink-0 text-[#D98955]" />Bookings stay fixed. Meals stay on time.</li>
            <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#D98955]" />Every change is shown before it's saved.</li>
            <li className="flex gap-3"><MapIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#D98955]" />Nearby pharmacies, ATMs and cafés, from live map data.</li>
          </ul>
        </div>
        <div data-chat className="mx-auto w-full max-w-[460px]">
          <div className="rounded-[30px] border border-white/10 bg-[#F7F5EF] p-5 text-[#18211F] shadow-[0_40px_120px_-40px_rgba(0,0,0,.8)]">
            <div className="flex items-center gap-3 border-b border-[#e2ded3] pb-4">
              <Emblem className="h-10 w-10" />
              <div><div className="font-serif text-[22px] leading-none">Tripzy</div><div className="mt-1 text-[12px] text-[#6c706a]">Travelling with you · Hyderabad, Day 2</div></div>
            </div>
            <div className="space-y-3 pt-4 text-[15px]">
              <div data-msg-user className="ml-auto w-fit max-w-[80%] rounded-[20px] rounded-br-md bg-[#315C4C] px-4 py-2.5 text-white">It's raining. What should we do?</div>
              <div data-typing className="tz-typing w-fit overflow-hidden rounded-[20px] rounded-bl-md bg-white px-4 py-3 text-[#A6A39B]" aria-hidden><span /><span /><span /></div>
              <div data-msg-bot className="max-w-[88%] rounded-[20px] rounded-bl-md bg-white px-4 py-2.5">I found an indoor alternative nearby. It fits your remaining schedule and keeps your travel time low.</div>
              <div data-diff className="rounded-[20px] border border-[#e2ded3] bg-white p-4">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-[#c97a46]"><span>Ripple Engine</span><span className="text-[#A6A39B]">15:10</span></div>
                <div className="mt-1 font-serif text-[20px]">Rain expected 15:00–18:00</div>
                <div className="mt-3 space-y-2 text-[14px]">
                  <div data-diff-row className="flex items-center gap-2"><span className="text-[#A6A39B] line-through">Golconda Fort</span><ArrowRight className="h-3.5 w-3.5 text-[#A6A39B]" /><b>Salar Jung Museum</b><span className="text-[12px] text-[#6c706a]">· indoor</span></div>
                  <div data-diff-row className="flex items-center gap-2 text-[#3b4542]"><Route className="h-3.5 w-3.5" />Travel time 48 → 17 min</div>
                  <div data-diff-row className="flex items-center gap-2 text-[#3b4542]"><Landmark className="h-3.5 w-3.5" />Dinner booking unchanged at 20:00</div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" tabIndex={-1} className="h-10 rounded-full border border-[#e2ded3] text-[13px] font-semibold text-[#3b4542]">Keep original</button>
                  <button type="button" tabIndex={-1} data-accept className="relative h-10 rounded-full bg-[#D98955] text-[13px] font-semibold text-[#18211F]">
                    <span data-accept-label>Accept new plan</span>
                    <span data-accepted className="absolute inset-0 flex items-center justify-center gap-1.5 text-white opacity-0"><Check className="h-4 w-4" />Saved and synced</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-[12px] text-white/50">Example conversation. In the app, the Companion uses your real trip.</p>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 07 · memories

function Memories() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)
  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(root)
    q('[data-speed]').forEach((el: Element) => {
      const s = Number((el as HTMLElement).dataset.speed)
      gsap.fromTo(el, { yPercent: s * 6 }, { yPercent: -s * 6, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: true } })
    })
    gsap.fromTo(q('[data-trail]'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: q('[data-trail]')[0], start: 'top 85%', end: 'bottom 45%', scrub: 0.8 } })
  }, { scope: root })

  return (
    <section ref={root} className="overflow-hidden bg-surface py-28 md:py-40">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <Chapter n="07" title="The memories" />
            <h2 data-reveal className="tz-h1 mt-6 max-w-[14ch] text-content">Collect moments, not just destinations.</h2>
          </div>
          <p data-reveal className="tz-lede max-w-md">Every trip becomes a journal: where you went, what you loved, where the plan changed and why. Tripzy learns from each reaction, so your next journey starts closer to you.</p>
        </div>

        <div className="relative mt-16 grid grid-cols-12 gap-3 md:gap-5">
          <div data-speed="2" className="col-span-7 md:col-span-5"><div data-reveal="mask" className="overflow-hidden rounded-[22px]"><Photo id="charminar" sizes="40vw" className="aspect-[3/4]" /></div></div>
          <div data-speed="-1" className="col-span-5 mt-16 md:col-span-4 md:mt-28"><div data-reveal="mask" className="overflow-hidden rounded-[22px]"><Photo id="chowmahalla-palace" sizes="33vw" className="aspect-[4/5]" /></div></div>
          <div data-speed="3" className="col-span-12 md:col-span-3 md:mt-8">
            <div data-reveal className="rounded-[22px] border border-edge bg-surface-card p-6">
              <div className="tz-kicker">Day 2 · journal</div>
              <p className="mt-3 font-serif text-[24px] italic leading-snug text-content">"Stayed an hour longer at Chowmahalla. Tripzy moved lunch and nobody rushed."</p>
              <div className="mt-4 flex items-center gap-2 text-[12px] text-content-muted"><Sparkles className="h-3.5 w-3.5 text-[var(--tz-sun)]" />Learned: more time for palaces</div>
            </div>
            <svg viewBox="0 0 200 120" className="mt-6 hidden w-full md:block" aria-hidden><path data-trail d="M10 100 C 40 20, 80 120, 110 60 S 170 10, 190 30" pathLength={1} strokeDasharray="1" strokeDashoffset="0" stroke="var(--accent)" strokeWidth="1.6" fill="none" strokeLinecap="round" /><circle cx="10" cy="100" r="4" fill="var(--tz-sun)" /><circle cx="190" cy="30" r="4" fill="var(--accent)" /></svg>
          </div>
          <div data-speed="-2" className="col-span-6 md:col-span-4 md:col-start-2 md:-mt-10"><div data-reveal="mask" className="overflow-hidden rounded-[22px]"><Photo id="golconda" sizes="33vw" className="aspect-[4/3]" /></div></div>
          <div data-speed="1" className="col-span-6 mt-10 md:col-span-5 md:col-start-7 md:mt-6"><div data-reveal="mask" className="overflow-hidden rounded-[22px]"><Photo id="jantar-mantar-jaipur" sizes="40vw" className="aspect-[16/10]" /></div></div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 08 · the invitation

function Invitation() {
  const nav = useNavigate()
  const root = useRef<HTMLElement>(null)
  const [text, setText] = useState('')
  useReveal(root)
  useGSAP(() => {
    if (prefersReducedMotion()) return
    const q = gsap.utils.selector(root)
    gsap.fromTo(q('[data-final-img]'), { scale: 1.15 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom bottom', scrub: true } })
  }, { scope: root })
  const go = () => nav(text.trim() ? `/plan?q=${encodeURIComponent(text.trim())}` : '/plan')

  return (
    <section ref={root} className="relative flex min-h-[100svh] items-end overflow-hidden bg-[#18211F] text-white">
      <div data-final-img className="absolute inset-0"><Photo id="qutb-shahi-tombs" showCredit={false} className="h-full w-full" imgClassName="object-[50%_35%]" /></div>
      <div className="absolute inset-0 bg-gradient-to-t from-[#18211F] via-[#18211F]/50 to-transparent" />
      <div className="relative mx-auto w-full max-w-[1400px] px-5 pb-20 md:px-10 md:pb-28">
        <Chapter n="08" title="Your invitation" light />
        <h2 data-reveal className="tz-display mt-6 max-w-[12ch]">Your next story starts here.</h2>
        <p data-reveal className="mt-6 max-w-lg text-[18px] leading-relaxed text-white/80">Tell us where you want to go. We'll help take care of everything in between.</p>
        <form data-reveal onSubmit={(e) => { e.preventDefault(); go() }} className="mt-10 flex max-w-3xl flex-col gap-3 rounded-[28px] bg-white/10 p-2 backdrop-blur-md sm:flex-row sm:rounded-full">
          <label htmlFor="tz-final-input" className="sr-only">Describe your trip</label>
          <input id="tz-final-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Try: 5 days in Jaipur with friends, under ₹20,000…" className="h-14 min-w-0 flex-1 rounded-full bg-transparent px-5 text-[16px] text-white outline-none placeholder:text-white/55" />
          <button type="submit" className="group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#F7F5EF] px-8 text-[15px] font-semibold text-[#18211F] transition hover:bg-white">Start planning <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></button>
        </form>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/60">
          <span>Hyderabad and Jaipur today</span><span>No account needed to plan</span><Link to="/status" className="tz-link">Live service status</Link>
        </div>
        <p className="tz-credit mt-10">{credit('qutb-shahi-tombs')}</p>
      </div>
    </section>
  )
}
