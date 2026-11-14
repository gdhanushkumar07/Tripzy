import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, ArrowRight, CheckCircle2, CloudRain, Gauge, Loader2, MapPinned, Mic, Route, ShieldCheck, Sparkles, Wand2, Zap } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { useAuthStore } from '../../store/authStore'
import { composeStream, engine, rememberCapsule, rupees } from '../../tripzy/engine'
import { useDnaCards } from '../../tripzy/useDnaCards'
import { DnaCardsStatus, DnaProgress, DnaQuestion } from '../../tripzy/DnaQuestion'
import { materialize } from '../../tripzy/bridge'
import type { Brief, CapsuleX, Step } from '../../tripzy/types'
import { PublicNav } from '../../tripzy/PublicLayout'
import type { Profile } from '../../tripzy/engine'
import { Button, Card, EnergyBar, Eyebrow, Pill, PlaceImage, ScoreRing, Toast, usePlacePhoto } from '../../tripzy/ui'

type Stage = 'describe' | 'shape' | 'compose' | 'preview'
const EXAMPLES = [
  'Hyderabad, 3 days, with my parents, veg, Dec 18',
  'Jaipur weekend with friends, love forts and photography, budget',
  'Hyderabad 2 days with 2 kids, biryani and museums',
]
const AGENTS = ['Brief Agent', 'Profile Agent', 'Live Watcher', 'Discovery Agent', 'Route Agent', 'Planner Agent', 'Shadow Agent', 'Time-Truth Agent', 'Capsule Agent']
const DRAFT_KEY = 'tripzy:draft'

export default function PlanPage(): React.ReactElement {
  const authed = useAuthStore((s) => s.isAuthenticated)
  const body = <PlanFlow authed={authed} />
  if (authed) return <PageShell background="var(--bg-primary)">{body}</PageShell>
  return (
    <div className="min-h-screen bg-surface">
      <PublicNav />
      {body}
    </div>
  )
}

function PlanFlow({ authed }: { authed: boolean }) {
  const nav = useNavigate()
  const saved = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
  }, [])
  const [stage, setStage] = useState<Stage>(saved?.capsuleId ? 'preview' : 'describe')
  const [text, setText] = useState('')
  const [brief, setBrief] = useState<Brief | null>(saved?.brief ?? null)
  const [swipes, setSwipes] = useState<Record<string, string>>(saved?.swipes ?? {})
  const [capsuleId, setCapsuleId] = useState<string | null>(saved?.capsuleId ?? null)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  useEffect(() => {
    if (authed) engine.profile().then(setProfile).catch(() => undefined)
  }, [authed])
  // Arriving from the homepage with a sentence: start straight away.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) {
      setText(q)
      setCapsuleId(null)
      window.history.replaceState(null, '', '/plan')
      void start(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ brief, swipes, capsuleId })) } catch { /* ignore */ }
  }, [brief, swipes, capsuleId])

  const start = async (t = text) => {
    if (!t.trim()) return
    setBusy(true)
    try {
      const b = await engine.parseBrief(t)
      // Saved Travel DNA fills what the sentence didn't say (diet, access, usual companions).
      const p = profile ?? (authed ? await engine.profile().catch(() => null) : null)
      if (p?.completed) {
        const said = (re: RegExp) => re.test(t.toLowerCase())
        if (b.diet === 'any' && p.constraints?.diet && p.constraints.diet !== 'any') b.diet = p.constraints.diet as Brief['diet']
        if (p.constraints?.no_stairs) b.no_stairs = true
        if (b.party === 'solo' && p.companions && !said(/solo|alone|myself|friends|parents|family|kids|wife|husband|partner|couple/)) {
          b.party = p.companions as Brief['party']
          b.kids = p.kids ?? b.kids
        }
        if (b.budget_style === 'mid' && p.budget_style) b.budget_style = p.budget_style as Brief['budget_style']
      }
      setBrief(b)
      setSwipes({})
      setStage('shape')
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const demo = async () => {
    setBusy(true)
    try {
      const { capsule_id } = await engine.demoSeed()
      setCapsuleId(capsule_id)
      setStage('preview')
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">
      {stage === 'describe' && <Describe text={text} setText={setText} onGo={start} onDemo={demo} busy={busy} />}
      {stage === 'shape' && brief && (
        <Shape brief={brief} setBrief={setBrief} swipes={swipes} setSwipes={setSwipes} profile={profile}
          onBack={() => setStage('describe')} onBuild={() => setStage('compose')} />
      )}
      {stage === 'compose' && brief && (
        <Compose brief={brief} swipes={swipes} onDone={(id) => (setCapsuleId(id), setStage('preview'))} onError={(m) => (setToast(m), setStage('shape'))} />
      )}
      {stage === 'preview' && capsuleId && (
        <Preview id={capsuleId} authed={authed} onRestart={() => (setCapsuleId(null), setBrief(null), setStage('describe'))}
          onSaved={(tripId) => {
            try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
            nav(`/trips/${tripId}/intel`)
          }} onError={setToast} />
      )}
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </div>
  )
}

// ---------------------------------------------------------------- 1. describe

function Describe({ text, setText, onGo, onDemo, busy }: { text: string; setText: (s: string) => void; onGo: (t?: string) => void; onDemo: () => void; busy: boolean }) {
  const hero1 = usePlacePhoto('hyd-charminar')
  const hero2 = usePlacePhoto('jai-hawamahal')
  const hero3 = usePlacePhoto('hyd-golconda')
  const [listening, setListening] = useState(false)
  const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec })
  const Rec = SR.SpeechRecognition ?? SR.webkitSpeechRecognition
  const voice = () => {
    if (!Rec) return
    const r = new Rec()
    r.lang = 'en-IN'
    r.onresult = (e) => setText(e.results[0][0].transcript)
    r.onend = () => setListening(false)
    setListening(true)
    r.start()
  }
  return (
    <div className="grid items-center gap-10 py-6 lg:grid-cols-[1.1fr_1fr] lg:py-12">
      <div>
        <Pill tone="coral">One tourist · one package · a better trip</Pill>
        <h1 className="mt-4 text-[40px] font-bold leading-[1.08] tracking-tight text-content sm:text-[52px]">
          Your journey.<br /><span className="text-accent-on">Intelligently orchestrated.</span>
        </h1>
        <p className="mt-4 max-w-xl text-subtitle font-normal text-content-secondary">
          Describe the trip in one sentence. Tripzy checks every stop against real opening hours and road times,
          fits the day to your group's energy, prepares a Plan B, and re-plans live when the trip changes.
        </p>
        <form onSubmit={(e) => (e.preventDefault(), onGo())} className="mt-7 flex flex-col gap-2 rounded-2xl border border-edge bg-surface-card p-2 shadow-elevated sm:flex-row">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Describe your trip"
            placeholder="Hyderabad, 3 days, with my parents, veg, Dec 18"
            className="h-12 flex-1 rounded-xl bg-transparent px-3 text-[15px] text-content outline-none placeholder:text-content-faint" />
          <div className="flex gap-2">
            {Rec && (
              <button type="button" onClick={voice} aria-label="Speak your trip" className={`grid h-12 w-12 place-items-center rounded-xl border border-edge ${listening ? 'tz-coral-btn' : 'text-content-secondary hover:bg-surface-hover'}`}>
                <Mic className="h-5 w-5" />
              </button>
            )}
            <Button type="submit" className="h-12 flex-1 px-6 sm:flex-none" disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Plan it
            </Button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => (setText(e), onGo(e))}
              className="rounded-full border border-edge bg-surface-card px-3 py-1.5 text-caption text-content-secondary transition hover:border-[var(--accent)] hover:text-content">
              {e}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-caption text-content-muted">
          <Button variant="secondary" onClick={onDemo} disabled={busy}><Wand2 className="h-4 w-4" />Open the demo trip</Button>
          <span>Hyderabad and Jaipur in V1 · no sign-up to try</span>
        </div>
      </div>
      <div className="relative hidden h-[460px] lg:block">
        <HeroTile src={hero1} label="Charminar · golden hour 16:00–17:30" className="absolute left-0 top-0 h-[300px] w-[62%]" />
        <HeroTile src={hero2} label="Hawa Mahal · morning light" className="absolute right-0 top-16 h-[220px] w-[44%]" />
        <HeroTile src={hero3} label="Golconda · sunset from Bala Hissar" className="absolute bottom-0 right-6 h-[190px] w-[58%]" />
        <Card className="absolute bottom-10 left-4 w-[260px] p-4 tz-rise">
          <div className="flex items-center gap-3">
            <ScoreRing score={94} size={48} />
            <div>
              <div className="text-body font-semibold text-content">Day 2 verified</div>
              <div className="text-caption text-content-muted">Hours, closures, transit and energy checked</div>
            </div>
          </div>
        </Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
        {[
          [Route, 'Smart routes', 'Real OpenStreetMap road times with traffic buffers'],
          [ShieldCheck, 'Time-Truth', 'Hours, weekly closures and best time of day, verified'],
          [Zap, 'Energy-aware', 'No day planned beyond what your group can handle'],
          [CloudRain, 'Plan B built in', 'Rain, crowd and tired versions ready before you leave'],
          [Gauge, 'Live re-planning', 'A delay ripples through the rest of the day in one tap'],
          [MapPinned, 'One Trip Capsule', 'Itinerary, bookings, budget, map and memories together'],
        ].map(([Icon, t, d]) => {
          const I = Icon as React.ElementType
          return (
            <div key={t as string} className="flex gap-3 rounded-2xl border border-edge bg-surface-card p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent-on"><I className="h-5 w-5" /></span>
              <div><div className="font-semibold text-content">{t as string}</div><div className="text-body text-content-muted">{d as string}</div></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type SpeechRec = { lang: string; start: () => void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void }

function HeroTile({ src, label, className }: { src: string | null; label: string; className: string }) {
  return (
    <div className={`overflow-hidden rounded-3xl border border-edge bg-surface-tertiary shadow-elevated ${className}`}>
      {src && <img src={src} alt={label} className="h-full w-full object-cover" />}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------- 2. brief + DNA

function Shape({ brief, setBrief, swipes, setSwipes, onBack, onBuild, profile }: {
  brief: Brief; setBrief: (b: Brief) => void; swipes: Record<string, string>; setSwipes: (s: Record<string, string>) => void; onBack: () => void; onBuild: () => void
  profile: Profile | null
}) {
  const [customise, setCustomise] = useState(false)
  const useSaved = !!profile?.completed && !customise
  const dna = useDnaCards()
  const cards = dna.cards
  const [i, setI] = useState(Object.keys(swipes).length)
  const card = cards[i]
  const done = dna.status === 'ready' && i >= cards.length
  const patch = (p: Partial<Brief>) => setBrief({ ...brief, ...p })
  const pick = useCallback((v: 'a' | 'b' | null) => {
    if (!card) return
    const next = { ...swipes }
    if (v) next[card.id] = v
    else delete next[card.id]
    setSwipes(next)
    if (v) setI((n) => n + 1)
  }, [card, swipes, setSwipes])
  const ready = !!brief.city && !!brief.start_date
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-body text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Start over</button>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="h-fit p-5">
          <Eyebrow>Trip brief</Eyebrow>
          <p className="mt-1 text-body italic text-content-muted">“{brief.raw}”</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Destination">
              <select className="tz-input" value={brief.city ?? ''} onChange={(e) => patch({ city: e.target.value || null })}>
                <option value="">Choose…</option><option value="hyderabad">Hyderabad</option><option value="jaipur">Jaipur</option>
              </select>
            </Field>
            <Field label="Start date"><input type="date" className="tz-input" value={brief.start_date} onChange={(e) => patch({ start_date: e.target.value })} /></Field>
            <Field label="Days"><input type="number" min={1} max={7} className="tz-input" value={brief.days} onChange={(e) => patch({ days: Math.max(1, Math.min(7, +e.target.value)) })} /></Field>
            <Field label="Travelling">
              <select className="tz-input" value={brief.party} onChange={(e) => patch({ party: e.target.value as Brief['party'] })}>
                <option value="solo">Solo</option><option value="couple">Couple</option><option value="friends">Friends</option>
                <option value="family">Family with kids</option><option value="parents">With parents</option>
              </select>
            </Field>
            {brief.party === 'family' && (
              <Field label="Kids"><input type="number" min={0} max={6} className="tz-input" value={brief.kids} onChange={(e) => patch({ kids: +e.target.value })} /></Field>
            )}
            <Field label="Food">
              <select className="tz-input" value={brief.diet} onChange={(e) => patch({ diet: e.target.value as Brief['diet'] })}>
                <option value="any">Anything</option><option value="veg">Vegetarian</option><option value="jain">Jain</option><option value="halal">Halal</option>
              </select>
            </Field>
            <Field label="Budget (₹)"><input type="number" className="tz-input" placeholder="Optional" value={brief.budget_total ?? ''} onChange={(e) => patch({ budget_total: e.target.value ? +e.target.value : null })} /></Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-body text-content">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={brief.no_stairs} onChange={(e) => patch({ no_stairs: e.target.checked })} />
            Avoid steep climbs and long stairs
          </label>
          {brief.assumptions.length > 0 && <ul className="mt-3 space-y-1 text-caption text-warning">{brief.assumptions.map((a) => <li key={a}>• {a}</li>)}</ul>}
          {brief.interests.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{brief.interests.map((x) => <Pill key={x} tone="accent">{x}</Pill>)}</div>}
        </Card>

        {useSaved ? (
          <Card className="flex min-h-[460px] flex-col items-center justify-center p-8 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><Sparkles className="h-8 w-8" /></span>
            <Eyebrow className="mt-5 tz-coral-text">Your saved Travel DNA</Eyebrow>
            <h2 className="mt-1 text-title font-bold text-content">Planning around you</h2>
            <div className="mt-3 flex max-w-md flex-wrap justify-center gap-1.5">{(profile?.summary ?? []).map((x) => <Pill key={x} tone="accent">{x}</Pill>)}</div>
            <p className="mt-3 max-w-sm text-body text-content-muted">Including everything Tripzy has learned from your past trips. Diet and accessibility limits are applied automatically.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => setCustomise(true)}>Answer the 12 questions for this trip</Button>
              <Button className="h-12 px-7" disabled={!ready} onClick={() => (setSwipes({}), onBuild())}><Wand2 className="h-5 w-5" />Build my trip</Button>
            </div>
            {!ready && <p className="mt-2 text-body text-danger">Choose a destination and start date first.</p>}
          </Card>
        ) : (
        <Card className="flex min-h-[460px] flex-col p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Eyebrow className="tz-coral-text">Travel DNA · 60 seconds</Eyebrow>
              <h2 className="mt-1 text-title font-bold text-content">Which sounds more like this trip?</h2>
              <p className="text-body text-content-muted">Your choices change real rankings, pace and energy limits. Use ← → keys.</p>
            </div>
            <span className="shrink-0 text-body font-semibold tabular-nums text-content-muted">{Object.keys(swipes).length}/{cards.length || 12}</span>
          </div>
          <div className="mt-4"><DnaProgress answered={Object.keys(swipes).length} total={cards.length || 12} /></div>
          <div className="mt-8"><DnaCardsStatus state={dna} /></div>
          {!done && card && (
            <>
              <div className="flex-1"><DnaQuestion card={card} value={swipes[card.id]} onAnswer={pick} index={i} total={cards.length} /></div>
              <div className="mt-4 flex justify-between text-body">
                <button type="button" className="text-content-muted disabled:opacity-30" disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
                <div className="flex gap-4">
                  <button type="button" className="text-content-muted hover:text-content" onClick={() => setI(i + 1)}>{swipes[card.id] ? 'Next' : 'Skip question'}</button>
                  <button type="button" className="text-content-muted hover:text-content" onClick={() => setI(cards.length)}>Finish</button>
                </div>
              </div>
            </>
          )}
          {done && (
            <div className="tz-rise flex flex-1 flex-col items-center justify-center text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><Sparkles className="h-8 w-8" /></span>
              <h3 className="mt-4 text-title font-bold text-content">Travel DNA captured</h3>
              <p className="mt-1 max-w-sm text-body text-content-muted">{Object.keys(swipes).length} of {cards.length} answered. Tripzy keeps learning from your reactions during the trip.</p>
              <button type="button" className="mt-2 text-[14px] text-accent-on underline underline-offset-2" onClick={() => setI(0)}>Review my answers</button>
              <Button className="mt-6 h-12 px-7" disabled={!ready} onClick={onBuild}><Wand2 className="h-5 w-5" />Build my trip</Button>
              {!ready && <p className="mt-2 text-body text-danger">Choose a destination and start date first.</p>}
            </div>
          )}
        </Card>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-caption font-medium text-content-muted">{label}</span><div className="mt-1">{children}</div></label>
}

// ---------------------------------------------------------------- 3. agents

function Compose({ brief, swipes, onDone, onError }: { brief: Brief; swipes: Record<string, string>; onDone: (id: string) => void; onError: (m: string) => void }) {
  const [steps, setSteps] = useState<Step[]>([])
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    composeStream({ brief, swipes }, (s) => setSteps((x) => [...x, s]))
      .then((id) => setTimeout(() => onDone(id), 700))
      .catch((e) => onError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const next = AGENTS[steps.length]
  return (
    <div className="mx-auto max-w-2xl py-6">
      <Eyebrow className="tz-coral-text">Tripzy agents at work</Eyebrow>
      <h1 className="mt-1 text-title font-bold text-content">Composing your Trip Capsule</h1>
      <p className="text-body text-content-muted">Each agent is deterministic: no invented places, times or prices.</p>
      <ol className="mt-6 space-y-2.5">
        {steps.map((s) => (
          <li key={s.node} className="tz-rise flex gap-3 rounded-2xl border border-edge bg-surface-card p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{s.agent}</div>
              <div className="font-semibold text-content">{s.title}</div>
              <div className="text-body text-content-secondary">{s.detail}</div>
            </div>
          </li>
        ))}
        {next && (
          <li className="flex items-center gap-3 rounded-2xl border border-dashed border-edge p-4 text-content-muted">
            <Loader2 className="h-5 w-5 animate-spin text-accent-on" />{next} working…
          </li>
        )}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- 4. preview + save

function Preview({ id, authed, onSaved, onRestart, onError }: { id: string; authed: boolean; onSaved: (tripId: number) => void; onRestart: () => void; onError: (m: string) => void }) {
  const nav = useNavigate()
  const [c, setC] = useState<CapsuleX | null>(null)
  const [saving, setSaving] = useState('')
  useEffect(() => { engine.capsule(id).then(setC).catch((e) => onError(e.message)) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <div className="grid h-64 place-items-center"><Loader2 className="h-8 w-8 animate-spin text-accent-on" /></div>

  const save = async () => {
    if (!authed) {
      nav('/login?redirect=%2Fplan')
      return
    }
    try {
      if (c.platform_trip_id) return onSaved(c.platform_trip_id)
      const tripId = await materialize(c, setSaving)
      rememberCapsule(c.id, tripId)
      onSaved(tripId)
    } catch (e) {
      setSaving('')
      onError((e as Error).message)
    }
  }
  const stops = c.days.reduce((a, d) => a + d.blocks.filter((b) => b.kind === 'place').length, 0)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow className="tz-coral-text">{c.demo ? 'Demo trip · sample booking' : 'Your plan is ready'}</Eyebrow>
          <h1 className="text-[32px] font-bold leading-tight text-content">{c.city.name}, {c.brief.days} days</h1>
          <p className="text-body text-content-muted">{c.days[0].date} → {c.days[c.days.length - 1].date} · {c.travellers.map((t) => t.label).join(', ')} · stay {c.stay.name}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{c.dna_summary.map((x) => <Pill key={x} tone="accent">{x}</Pill>)}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRestart}>Start over</Button>
          <Button className="h-11 px-6" onClick={save} disabled={!!saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {saving || (authed ? 'Save to My Trips' : 'Sign in to save')}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4"><div className="text-caption text-content-muted">Stops placed</div><div className="text-title font-bold text-content">{stops}</div></Card>
        <Card className="p-4"><div className="text-caption text-content-muted">Planned spend (incl. stay)</div><div className="text-title font-bold text-content">{rupees(c.budget.planned_total)}</div></Card>
        <Card className="p-4"><div className="text-caption text-content-muted">Plan B ready for</div><div className="text-title font-bold text-content">{c.days.reduce((a, d) => a + d.blocks.filter((b) => b.plan_b && Object.keys(b.plan_b).length).length, 0)} stops</div></Card>
        <Card className="p-4"><div className="text-caption text-content-muted">Energy budget</div><div className="text-title font-bold text-content">{c.days[0].energy_budget} <span className="text-body font-normal text-content-muted">set by {c.days[0].limiter}</span></div></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {c.days.map((d) => (
          <Card key={d.index} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-edge p-4">
              <div>
                <div className="text-caption text-content-muted">{d.weekday} · {d.date}</div>
                <div className="text-subtitle font-semibold text-content">Day {d.index + 1}</div>
              </div>
              <ScoreRing score={d.verify.score} size={46} />
            </div>
            <div className="space-y-2.5 p-4">
              <EnergyBar pct={d.verify.energy.pct} compact />
              {d.blocks.filter((b) => b.kind === 'place' || b.kind === 'meal').map((b) => (
                <div key={b.id} className="flex items-center gap-3">
                  {b.kind === 'place'
                    ? <PlaceImage id={b.place_id} cat={b.cat} alt={b.name} className="h-11 w-11 shrink-0 rounded-lg" />
                    : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg tz-coral-pill text-caption font-bold">{b.meal?.[0]?.toUpperCase()}</span>}
                  <div className="min-w-0">
                    <div className="truncate text-body font-medium text-content">{b.name}</div>
                    <div className="text-caption tabular-nums text-content-muted">{b.start}–{b.end}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {c.notes.length > 0 && <Card className="p-4 text-body text-warning">{c.notes.map((n) => <div key={n}>{n}</div>)}</Card>}
    </div>
  )
}
