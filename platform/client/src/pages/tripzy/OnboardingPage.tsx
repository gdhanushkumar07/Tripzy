import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Accessibility, ArrowLeft, ArrowRight, Baby, Check, Heart, Loader2, Sparkles, User, Users, UsersRound, Wallet } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { Brand } from '../../tripzy/PublicLayout'
import { engine, type Profile, type ProfileInput } from '../../tripzy/engine'
import { useDnaCards } from '../../tripzy/useDnaCards'
import { DnaCardsStatus, DnaProgress, DnaQuestion } from '../../tripzy/DnaQuestion'
import { Button, Pill, Toast } from '../../tripzy/ui'

const STEPS = ['Welcome', 'Travel DNA', 'Preferences', 'Companions', 'Diet & access', 'Budget', 'Done']
const DRAFT = 'tripzy:onboarding-draft'
const BLANK: ProfileInput = {
  swipes: {}, interests: [], pace: 0.5, morning: 0.5, companions: 'solo', kids: 0, diet: 'any',
  no_stairs: false, wheelchair: false, budget_style: 'mid', budget_per_day: null, home_city: null, skipped: [],
}
type Draft = { a: ProfileInput; step: number; ci: number }
function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) || 'null') as Draft | null
    return d && d.a && typeof d.step === 'number' ? d : null
  } catch { return null }
}
const writeDraft = (d: Draft | null) => {
  try { if (d) localStorage.setItem(DRAFT, JSON.stringify(d)); else localStorage.removeItem(DRAFT) } catch { /* storage unavailable: the draft is a convenience only */ }
}

const INTERESTS = ['history', 'culture', 'food', 'shopping', 'nature', 'spiritual', 'art', 'nightlife', 'photography', 'adventure', 'kids', 'entertainment']

export default function OnboardingPage(): React.ReactElement {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const draft = readDraft()
  const [step, setStep] = useState(draft?.step ?? 0)
  const dna = useDnaCards()
  const cards = dna.cards
  const [ci, setCi] = useState(draft?.ci ?? 0)
  const [restored] = useState(!!draft)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<Profile | null>(null)
  const [toast, setToast] = useState('')
  const [a, setA] = useState<ProfileInput>(draft?.a ?? BLANK)
  const set = (p: Partial<ProfileInput>) => setA((x) => ({ ...x, ...p }))
  // Existing travellers start from their saved answers (unless a newer draft exists).
  useEffect(() => {
    if (restored) return
    let alive = true
    engine.profile().then((p) => { if (alive && p.answers) setA({ ...BLANK, ...p.answers, skipped: [] }) }).catch(() => undefined)
    return () => { alive = false }
  }, [restored])
  // Interrupted? Pick up where you left off after a refresh.
  useEffect(() => { if (step < 6) writeDraft({ a, step, ci }) }, [a, step, ci])
  const answer = useCallback((v: 'a' | 'b' | null) => {
    const card = cards[ci]
    if (!card) return
    setA((x) => {
      const swipes = { ...x.swipes }
      if (v) swipes[card.id] = v
      else delete swipes[card.id]
      return { ...x, swipes }
    })
    if (v) setCi((c) => c + 1)
  }, [cards, ci])

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const skip = () => (set({ skipped: [...a.skipped, STEPS[step]] }), next())
  const finish = async () => {
    setSaving(true)
    try {
      setDone(await engine.saveProfile(a))
      writeDraft(null)
      setStep(6)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const name = (user as { username?: string } | null)?.username ?? 'traveller'
  const card = cards[ci]

  return (
    <div className="min-h-screen bg-surface">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <Brand />
        {step < 6 && <button type="button" onClick={() => nav('/dashboard')} className="text-body text-content-muted hover:text-content">I'll do this later</button>}
      </header>
      <div className="mx-auto max-w-3xl px-5 pb-16">
        {/* progress */}
        <ol className="mb-8 mt-2 flex items-center gap-1.5" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-surface-tertiary'}`} />
              <div className={`mt-1.5 hidden text-[11px] font-medium sm:block ${i === step ? 'text-content' : 'text-content-faint'}`}>{s}</div>
            </li>
          ))}
        </ol>

        <section className="tz-rise rounded-[28px] border border-edge bg-surface-card p-6 shadow-elevated sm:p-10" key={step}>
          {step === 0 && (
            <div className="text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><Sparkles className="h-8 w-8" /></span>
              <h1 className="tz-h2 mt-5 text-content">Welcome to Tripzy, {name}</h1>
              <p className="mx-auto mt-2 max-w-md text-body text-content-muted">Two minutes of questions make every plan fit you: your pace, your energy, your food, your budget. You can change any of it later.</p>
              <Button className="mt-8 h-12 px-8" onClick={next}>Let's build my Travel DNA <ArrowRight className="h-4 w-4" /></Button>
            </div>
          )}

          {step === 1 && (
            <div>
              <Head title="Which sounds more like you?" sub={`${cards.length || 12} quick either/or choices. Answer as many as you like; use the ← → keys if you prefer.`} />
              <div className="mb-6"><DnaProgress answered={Object.keys(a.swipes).length} total={cards.length || 12} /></div>
              <DnaCardsStatus state={dna} />
              {dna.status === 'ready' && (ci < cards.length ? (
                <DnaQuestion card={cards[ci]} value={a.swipes[cards[ci].id]} onAnswer={answer} index={ci} total={cards.length} />
              ) : (
                <div className="py-10 text-center text-content-secondary">
                  <Check className="mx-auto h-8 w-8 text-success" />
                  <p className="mt-2">{Object.keys(a.swipes).length} of {cards.length} answered.</p>
                  <button type="button" className="mt-2 text-[14px] text-accent-on underline underline-offset-2" onClick={() => setCi(0)}>Review my answers</button>
                </div>
              ))}
              <Nav
                onBack={() => (ci > 0 && dna.status === 'ready' ? setCi(Math.min(ci, cards.length) - 1) : setStep(0))}
                onSkip={skip}
                onNext={() => (dna.status === 'ready' && ci < cards.length ? setCi(ci + 1) : next())}
                nextLabel={dna.status === 'ready' && ci < cards.length ? (a.swipes[cards[ci].id] ? 'Next question' : 'Skip question') : 'Continue'}
              />
            </div>
          )}

          {step === 2 && (
            <div>
              <Head title="How do you like to travel?" sub="These set the rhythm of every day Tripzy plans." />
              <Slider label="Pace" lo="2–3 places, done properly" hi="Pack in as much as possible" value={a.pace ?? 0.5} onChange={(v) => set({ pace: v })} />
              <Slider label="Mornings" lo="Late, slow starts" hi="Early bird, out by 8" value={a.morning ?? 0.5} onChange={(v) => set({ morning: v })} />
              <div className="mt-6 text-body font-semibold text-content">What do you love? <span className="font-normal text-content-muted">(pick any)</span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {INTERESTS.map((x) => {
                  const on = a.interests.includes(x)
                  return (
                    <button key={x} type="button" aria-pressed={on} onClick={() => set({ interests: on ? a.interests.filter((i) => i !== x) : [...a.interests, x] })}
                      className={`h-9 rounded-full border px-4 text-body capitalize transition ${on ? 'border-[var(--accent)] bg-accent text-accent-text' : 'border-edge bg-surface-card text-content-secondary hover:border-[var(--accent)]'}`}>{x}</button>
                  )
                })}
              </div>
              <Nav onBack={() => setStep(1)} onSkip={skip} onNext={next} />
            </div>
          )}

          {step === 3 && (
            <div>
              <Head title="Who do you usually travel with?" sub="The group's energy budget follows its most limited member." />
              <div className="grid gap-3 sm:grid-cols-3">
                {([['solo', 'Solo', User], ['couple', 'Partner', Heart], ['friends', 'Friends', Users], ['family', 'Family with kids', Baby], ['parents', 'With parents', UsersRound]] as const).map(([v, l, I]) => (
                  <Choice key={v} on={a.companions === v} onClick={() => set({ companions: v })} icon={<I className="h-5 w-5" />} label={l} />
                ))}
              </div>
              {a.companions === 'family' && (
                <label className="mt-5 flex items-center gap-3 text-body text-content">Kids
                  <input type="number" min={0} max={6} value={a.kids} onChange={(e) => set({ kids: +e.target.value })} className="tz-input !w-24" />
                </label>
              )}
              <Nav onBack={() => setStep(2)} onSkip={skip} onNext={next} />
            </div>
          )}

          {step === 4 && (
            <div>
              <Head title="Food and accessibility" sub="Hard limits Tripzy will never break. Only share what you're comfortable with." />
              <div className="text-body font-semibold text-content">Food</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {([['any', 'Anything'], ['veg', 'Vegetarian'], ['jain', 'Jain'], ['halal', 'Halal']] as const).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={a.diet === v} onClick={() => set({ diet: v })}
                    className={`h-10 rounded-full border px-5 text-body transition ${a.diet === v ? 'border-[var(--accent)] bg-accent text-accent-text' : 'border-edge bg-surface-card text-content-secondary'}`}>{l}</button>
                ))}
              </div>
              <div className="mt-6 space-y-3">
                <Toggle on={a.no_stairs} onChange={(v) => set({ no_stairs: v })} title="Avoid steep climbs and long stairs" sub="Forts and towers with big climbs are swapped for easier alternatives" />
                <Toggle on={a.wheelchair} onChange={(v) => set({ wheelchair: v })} title="Wheelchair access needed" sub="Lower daily energy budget, no stair-heavy stops" icon={<Accessibility className="h-4 w-4" />} />
              </div>
              <Nav onBack={() => setStep(3)} onSkip={skip} onNext={next} />
            </div>
          )}

          {step === 5 && (
            <div>
              <Head title="What's your budget style?" sub="Used to rank places and pick restaurants. Never to show you fake prices." />
              <div className="grid gap-3 sm:grid-cols-3">
                {([['low', 'Smart saver', 'Free sights, great value food'], ['mid', 'Balanced', 'Mix of value and comfort'], ['high', 'Splurge', 'Premium experiences first']] as const).map(([v, l, d]) => (
                  <Choice key={v} on={a.budget_style === v} onClick={() => set({ budget_style: v })} icon={<Wallet className="h-5 w-5" />} label={l} sub={d} />
                ))}
              </div>
              <label className="mt-6 block text-body font-semibold text-content">Typical daily spend per person (₹) <span className="font-normal text-content-muted">optional</span>
                <input type="number" min={0} value={a.budget_per_day ?? ''} onChange={(e) => set({ budget_per_day: e.target.value ? +e.target.value : null })} className="tz-input mt-2 !w-48" placeholder="e.g. 2500" />
              </label>
              <div className="mt-8 flex items-center justify-between">
                <button type="button" onClick={() => setStep(4)} className="inline-flex items-center gap-1 text-body text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Back</button>
                <Button className="h-11 px-7" onClick={finish} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save my Travel DNA</Button>
              </div>
            </div>
          )}

          {step === 6 && done && (
            <div className="text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success-soft text-success"><Check className="h-8 w-8" /></span>
              <h2 className="tz-h2 mt-5 text-content">Your Travel DNA is ready</h2>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">{(done.summary ?? []).map((s) => <Pill key={s} tone="accent">{s}</Pill>)}</div>
              <p className="mx-auto mt-4 max-w-md text-body text-content-muted">Every plan now starts from this profile, and it keeps learning from how you react on the road.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button variant="secondary" className="h-11" onClick={() => nav('/dashboard')}>Go to my dashboard</Button>
                <Button className="h-11 px-7" onClick={() => nav('/plan')}><Sparkles className="h-4 w-4" />Plan my first trip</Button>
              </div>
            </div>
          )}
        </section>
      </div>
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </div>
  )
}

function Head({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-6"><h2 className="tz-h3 text-content">{title}</h2><p className="mt-2 text-[15px] text-content-muted">{sub}</p></div>
}

function Nav({ onBack, onSkip, onNext, nextLabel = 'Continue' }: { onBack: () => void; onSkip: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-body text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Back</button>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onSkip}>Skip</Button>
        <Button onClick={onNext}>{nextLabel}<ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}

function Slider({ label, lo, hi, value, onChange }: { label: string; lo: string; hi: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="mt-5">
      <div className="text-body font-semibold text-content">{label}</div>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(+e.target.value)} className="mt-3 w-full accent-[var(--accent)]" aria-label={label} />
      <div className="mt-1 flex justify-between text-caption text-content-muted"><span>{lo}</span><span>{hi}</span></div>
    </div>
  )
}

function Choice({ on, onClick, icon, label, sub }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition ${on ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge bg-surface-card hover:border-[var(--accent)]'}`}>
      <span className={on ? 'text-accent-on' : 'text-content-muted'}>{icon}</span>
      <span className="font-semibold text-content">{label}</span>
      {sub && <span className="text-caption text-content-muted">{sub}</span>}
    </button>
  )
}

function Toggle({ on, onChange, title, sub, icon }: { on: boolean; onChange: (v: boolean) => void; title: string; sub: string; icon?: React.ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${on ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge'}`}>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-surface-tertiary'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <span><span className="flex items-center gap-1.5 font-semibold text-content">{icon}{title}</span><span className="text-caption text-content-muted">{sub}</span></span>
    </button>
  )
}
