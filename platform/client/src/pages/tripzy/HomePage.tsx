import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowRight, BatteryCharging, Brain, CalendarArrowUp, CloudSun, Compass, Dna, Fingerprint, Gauge, Luggage, MapPin,
  MapPinned, Package, Plane, Route, ShieldCheck, Sparkles, Train, Waves,
} from 'lucide-react'
import { PublicPage } from '../../tripzy/PublicLayout'
import { EnergyBar, ScoreRing, usePlacePhoto } from '../../tripzy/ui'

const PROMPTS = [
  'Hyderabad, 3 days, with my parents, vegetarian, Dec 20',
  'Jaipur weekend with friends, forts and photography, under ₹15,000',
  'Hyderabad 2 days with 2 kids, biryani and museums',
]

export default function HomePage(): React.ReactElement {
  useEffect(() => {
    document.title = 'Tripzy · Every journey deserves a smarter plan'
  }, [])
  return (
    <PublicPage>
      <Hero />
      <TrustStrip />
      <HowItWorks />
      <Features />
      <Preview />
      <About />
      <FinalCta />
    </PublicPage>
  )
}

// ---------------------------------------------------------------- hero

function Hero() {
  const nav = useNavigate()
  const [text, setText] = useState('')
  const golconda = usePlacePhoto('hyd-golconda')
  const hawa = usePlacePhoto('jai-hawamahal')
  const go = (t = text) => t.trim() && nav(`/plan?q=${encodeURIComponent(t.trim())}`)
  return (
    <section id="discover" className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
        <div>
          <span className="tz-coral-pill inline-flex items-center gap-2 rounded-full px-3 py-1 text-caption font-semibold">
            <Sparkles className="h-3.5 w-3.5" />One tourist · one package · a better trip
          </span>
          <h1 className="mt-5 text-[42px] font-bold leading-[1.05] tracking-[-0.02em] text-content sm:text-[60px]">
            Every journey deserves a <span className="text-accent-on">smarter plan.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-content-secondary">
            Discover destinations, build personalized itineraries, compare routes, and let Tripzy take care of the journey:
            from the first idea to the final memory.
          </p>

          <form onSubmit={(e) => (e.preventDefault(), go())} className="mt-8 rounded-3xl border border-edge bg-surface-card p-3 shadow-elevated">
            <label htmlFor="hero-trip" className="flex items-center gap-2 px-2 pt-1 text-caption font-semibold text-content-muted">
              <MapPin className="h-3.5 w-3.5" />Where would you like to go?
            </label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input id="hero-trip" value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Hyderabad, 3 days, with my parents, veg, Dec 20"
                className="h-12 flex-1 rounded-xl bg-transparent px-2 text-[16px] text-content outline-none placeholder:text-content-faint" />
              <button type="submit" disabled={!text.trim()} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-6 text-body font-semibold text-accent-text transition hover:bg-accent-hover disabled:opacity-50">
                Plan my trip <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 px-1 pb-1">
              {PROMPTS.map((p) => (
                <button key={p} type="button" onClick={() => go(p)} className="rounded-full bg-surface-secondary px-3 py-1 text-caption text-content-secondary transition hover:bg-accent-subtle hover:text-accent-on">{p}</button>
              ))}
            </div>
          </form>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-content-muted">
            <a href="#how" className="inline-flex items-center gap-1 font-semibold text-content hover:text-accent-on">Explore how it works <ArrowRight className="h-3.5 w-3.5" /></a>
            <span>No account needed to start · Hyderabad &amp; Jaipur live in V1</span>
          </div>
        </div>

        {/* composition: real places, real Tripzy components */}
        <div className="relative mx-auto h-[520px] w-full max-w-[560px]" aria-hidden>
          <div className="absolute right-0 top-0 h-[360px] w-[82%] overflow-hidden rounded-[28px] border border-edge bg-surface-tertiary shadow-elevated">
            {golconda && <img src={golconda} alt="" className="h-full w-full object-cover" />}
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/65 to-transparent p-5 pb-12 text-right text-white">
              <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Day 2 · 15:30</div>
              <div className="text-subtitle font-semibold">Golconda Fort at golden hour</div>
            </div>
          </div>
          <div className="absolute bottom-6 left-0 h-[210px] w-[46%] overflow-hidden rounded-[24px] border-4 border-[var(--bg-primary)] bg-surface-tertiary shadow-elevated">
            {hawa && <img src={hawa} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="absolute left-4 top-10 w-[230px] rounded-2xl border border-edge bg-surface-card p-4 shadow-elevated">
            <div className="flex items-center gap-3">
              <ScoreRing score={94} size={46} />
              <div><div className="text-body font-semibold text-content">Plan verified</div><div className="text-caption text-content-muted">Hours · closures · transit</div></div>
            </div>
            <div className="mt-3"><EnergyBar pct={72} compact /></div>
          </div>
          <div className="absolute bottom-0 right-2 w-[270px] rounded-2xl border border-edge bg-surface-card p-4 shadow-modal">
            <div className="text-[11px] font-semibold uppercase tracking-wider tz-coral-text">Ripple re-plan</div>
            <div className="mt-1 flex items-center gap-2 text-body font-semibold text-content"><Train className="h-4 w-4 text-accent-on" />Train 12723 +2h late</div>
            <div className="mt-2 space-y-1.5 text-caption text-content-secondary">
              <div className="flex items-center gap-2"><CalendarArrowUp className="h-3.5 w-3.5 text-warning" />Mecca Masjid moved to Day 2</div>
              <div className="flex items-center gap-2"><Waves className="h-3.5 w-3.5 text-success" />Hotel rest absorbs the delay</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <span className="rounded-lg bg-surface-secondary py-1.5 text-center text-caption font-semibold text-content-secondary">Keep</span>
              <span className="rounded-lg bg-accent py-1.5 text-center text-caption font-semibold text-accent-text">Accept</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TrustStrip() {
  const items: [React.ElementType, string][] = [
    [Route, 'Real road times · OpenStreetMap + OSRM'],
    [CloudSun, 'Live forecasts · Open-Meteo'],
    [ShieldCheck, 'Verified places, hours & weekly closures'],
    [Fingerprint, 'Your data stays yours: private by default'],
  ]
  return (
    <div className="border-y border-edge bg-surface-secondary">
      <div className="mx-auto grid max-w-7xl gap-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([I, t]) => (
          <div key={t} className="flex items-center gap-2.5 text-body text-content-secondary"><I className="h-4 w-4 shrink-0 text-accent-on" />{t}</div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- how

function HowItWorks() {
  const steps: [string, string, string, React.ElementType][] = [
    ['01', 'Discover', 'Explore destinations ranked against what you actually enjoy.', Compass],
    ['02', 'Personalize', 'Build your Travel DNA in 60 seconds: pace, energy, food, crowds, budget.', Dna],
    ['03', 'Plan', 'Optimized routes and timed itineraries, verified against real opening hours.', MapPinned],
    ['04', 'Travel', 'Live companion with leave-by alerts and one-tap re-planning when things change.', Plane],
    ['05', 'Remember', 'Every reaction teaches Tripzy, so your next trip starts smarter.', Brain],
  ]
  return (
    <section id="how" className="mx-auto max-w-7xl px-5 py-20">
      <SectionHead eyebrow="How Tripzy works" title="From the first idea to the final memory" sub="One continuous Trip Capsule carries your plan, bookings, budget and learning through every stage." />
      <ol className="mt-12 grid gap-4 md:grid-cols-5">
        {steps.map(([n, t, d, I]) => (
          <li key={n} className="relative rounded-3xl border border-edge bg-surface-card p-6 shadow-card">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold tabular-nums tz-coral-text">{n}</span>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-subtle text-accent-on"><I className="h-5 w-5" /></span>
            </div>
            <h3 className="mt-6 text-subtitle font-semibold text-content">{t}</h3>
            <p className="mt-1.5 text-body text-content-muted">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Features() {
  const f: [React.ElementType, string, string][] = [
    [Route, 'Smart route optimization', 'Stops ordered by real road times with traffic buffers, so less of the day goes on transit.'],
    [Dna, 'Travel DNA', 'A preference profile that ranks every place, sets your pace, and evolves as you travel.'],
    [ShieldCheck, 'Feasibility intelligence', 'Each day gets a 0–100 score with plain reasons: hours, closures, tight connections.'],
    [BatteryCharging, 'Energy-aware scheduling', 'No day planned beyond what your group can handle. Rests are added where they are needed.'],
    [CloudSun, 'Live weather insights', 'Forecast-aware plans with indoor alternatives prepared before the rain arrives.'],
    [Gauge, 'Ripple re-planning', 'A delay or closure ripples through the rest of the day. Review the changes, then accept.'],
    [Package, 'Trip Capsule', 'Itinerary, bookings, documents, budget and memories in one shareable package.'],
    [Brain, 'Self-learning', 'Your reactions adjust what Tripzy recommends next, transparently and under your control.'],
  ]
  return (
    <section id="features" className="bg-surface-secondary py-20">
      <div className="mx-auto max-w-7xl px-5">
        <SectionHead eyebrow="Why Tripzy" title="Plans that hold up in the real world" sub="Most planners stop when the itinerary is generated. Tripzy keeps validating, monitoring and adapting it." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {f.map(([I, t, d]) => (
            <div key={t} className="rounded-3xl border border-edge bg-surface-card p-6 transition hover:-translate-y-0.5 hover:shadow-elevated">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><I className="h-5 w-5" /></span>
              <h3 className="mt-5 font-semibold text-content">{t}</h3>
              <p className="mt-1.5 text-body text-content-muted">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Preview() {
  const shots: [string, string, string][] = [
    ['/showcase/intel.png', 'Trip Intelligence', 'Feasibility, energy, verified stops and Plan B on one day view.'],
    ['/showcase/live.png', 'Live Companion', 'Now, next, and a leave-by countdown, with disruptions handled in one tap.'],
    ['/showcase/lab.png', 'Ripple Engine', 'A train delay re-planned: what moved, what was swapped, before and after.'],
  ]
  const [active, setActive] = useState(0)
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <SectionHead eyebrow="Inside the product" title="Real screens from Tripzy" sub="These are screenshots of the working application, not mock-ups." />
      <div className="mt-10 flex flex-wrap justify-center gap-2">
        {shots.map(([, t], i) => (
          <button key={t} type="button" onClick={() => setActive(i)} aria-pressed={active === i}
            className={`h-10 rounded-full px-5 text-body font-semibold transition ${active === i ? 'bg-accent text-accent-text' : 'border border-edge bg-surface-card text-content-secondary hover:text-content'}`}>{t}</button>
        ))}
      </div>
      <figure className="mx-auto mt-6 max-w-5xl overflow-hidden rounded-[28px] border border-edge bg-surface-card shadow-modal">
        <div className="flex items-center gap-1.5 border-b border-edge bg-surface-secondary px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b4a]" /><span className="h-2.5 w-2.5 rounded-full bg-[#f5b942]" /><span className="h-2.5 w-2.5 rounded-full bg-[#3fbf7f]" />
          <span className="ms-3 text-caption text-content-faint">tripzy.app</span>
        </div>
        <img src={shots[active][0]} alt={`${shots[active][1]} screen`} loading="lazy" className="w-full" />
        <figcaption className="border-t border-edge px-5 py-3 text-body text-content-muted">{shots[active][2]}</figcaption>
      </figure>
    </section>
  )
}

function About() {
  return (
    <section id="about" className="border-t border-edge bg-surface-secondary py-20">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 lg:grid-cols-2">
        <div>
          <div className="text-caption font-semibold uppercase tracking-wider tz-coral-text">About</div>
          <h2 className="mt-2 text-[32px] font-bold leading-tight text-content">Built for the trip as it actually happens</h2>
        </div>
        <div className="space-y-4 text-[16px] leading-relaxed text-content-secondary">
          <p>Tripzy started from a simple observation: itineraries fall apart the moment a train runs late, it rains, or someone in the group gets tired. Planning tools stop at the plan.</p>
          <p>Tripzy keeps going. Deterministic engines check every stop against opening hours, real road times and your group's energy. The AI is used only to understand what you ask for, so it never invents a place, a time or a price.</p>
          <p className="flex items-center gap-2 text-body text-content-muted"><Luggage className="h-4 w-4" />Live today for Hyderabad and Jaipur, with more cities on the way.</p>
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  const nav = useNavigate()
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <div className="relative overflow-hidden rounded-[32px] bg-[#0f1a3d] px-8 py-14 text-center text-white sm:px-16">
        <h2 className="text-[32px] font-bold leading-tight sm:text-[40px]">Your next journey, intelligently orchestrated.</h2>
        <p className="mx-auto mt-3 max-w-xl text-white/70">Start with one sentence. Sign up when you want to save it.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => nav('/plan')} className="tz-coral-btn inline-flex h-12 items-center gap-2 rounded-2xl px-7 text-body font-semibold">Plan my trip <ArrowRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => nav('/signup')} className="inline-flex h-12 items-center rounded-2xl bg-white/10 px-7 text-body font-semibold hover:bg-white/20">Create a free account</button>
        </div>
      </div>
    </section>
  )
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-caption font-semibold uppercase tracking-wider tz-coral-text">{eyebrow}</div>
      <h2 className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-content sm:text-[38px]">{title}</h2>
      <p className="mt-3 text-[16px] text-content-muted">{sub}</p>
    </div>
  )
}
