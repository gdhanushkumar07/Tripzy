import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { BatteryLow, CloudRain, Heart, Loader2, LocateFixed, Navigation, Plus, SkipForward, Store, ThumbsDown, ThumbsUp, Timer, Train, Wallet } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { budgetApi } from '../../api/client'
import { engine, fmtMin, lastCapsule, mapsLink, rememberCapsule, rupees } from '../../tripzy/engine'
import { resyncDays } from '../../tripzy/bridge'
import IntelTimeline from '../../tripzy/IntelTimeline'
import DiffSheet from '../../tripzy/DiffSheet'
import type { Block, CapsuleX, Proposal } from '../../tripzy/types'
import { Button, Card, EnergyBar, Eyebrow, Pill, PlaceImage, ScoreRing, Toast } from '../../tripzy/ui'

/** /live with no trip: open the most recent Tripzy trip. */
export function LiveRedirect(): React.ReactElement {
  const last = lastCapsule()
  if (last?.platformTripId) return <Navigate to={`/trips/${last.platformTripId}/live`} replace />
  return <Navigate to="/plan" replace />
}

const nowMinutes = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

export default function LivePage(): React.ReactElement {
  const { id = '' } = useParams()
  const tripId = Number(id)
  const [c, setC] = useState<CapsuleX | null>(null)
  const [err, setErr] = useState('')
  const [day, setDay] = useState(0)
  const [demoClock, setDemoClock] = useState(true)
  const [now, setNow] = useState(9 * 60)
  const [prop, setProp] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [amt, setAmt] = useState('')
  const [cat, setCat] = useState('Food')
  const [loc, setLoc] = useState<string>('')

  useEffect(() => {
    engine.getLink(tripId).then((l) => engine.capsule(l.capsule_id)).then((x) => {
      setC(x)
      rememberCapsule(x.id, tripId)
      const today = new Date().toISOString().slice(0, 10)
      const live = x.days.find((d) => d.date === today)
      if (live) {
        setDemoClock(false)
        setDay(live.index)
        setNow(nowMinutes())
      } else {
        setNow(Math.max(0, (x.days[0].blocks[0]?.s ?? 540) - 30))
      }
    }).catch(() => setErr('This trip has no Tripzy plan yet.'))
  }, [tripId])

  useEffect(() => {
    if (demoClock) return
    const t = setInterval(() => setNow(nowMinutes()), 30000)
    return () => clearInterval(t)
  }, [demoClock])

  const d = c?.days[day]
  const stops = useMemo(() => (d ? d.blocks.filter((b) => b.kind !== 'leg') : []), [d])
  if (err) return <PageShell background="var(--bg-primary)"><div className="mx-auto max-w-md px-4 py-20 text-center text-content-muted">{err} <Link className="text-accent-on underline" to="/plan">Plan one</Link></div></PageShell>
  if (!c || !d) return <PageShell background="var(--bg-primary)"><div className="grid h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-accent-on" /></div></PageShell>

  const current = stops.find((b) => b.s <= now && now < b.e)
  const next = stops.find((b) => b.s > now && (!current || b.s >= current.e))
  const legToNext = next ? d.blocks.find((b) => b.kind === 'leg' && b.e <= next.s && b.s >= (current?.e ?? now) - 1) : undefined
  const arrival = d.blocks.find((b) => b.kind === 'anchor' && b.name.startsWith('Arrive') && b.e > now)
  const toRate = stops.filter((b) => b.kind === 'place' && b.e <= now && !b.feedback)
  const leaveIn = legToNext ? legToNext.s - now : next ? next.s - now : 0
  const dayBudget = c.budget.per_day[day]

  const fire = async (event: Record<string, unknown>) => {
    setBusy(true)
    try {
      const p = await engine.ripple(c.id, day, fmtMin(now), event)
      if (p.auto_apply) {
        const x = await engine.capsule(c.id)
        setC(x)
        await resyncDays(tripId, x, [day])
        setToast(`${p.diff.headline}. Small shift applied automatically (${p.diff.shifted.length} stops re-timed).`)
      } else setProp(p)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const accept = async () => {
    if (!prop) return
    setBusy(true)
    try {
      const x = await engine.accept(c.id, prop.id)
      setC(x)
      const days = [prop.day, ...prop.diff.moved.map((m) => m.to_day - 1)]
      await resyncDays(tripId, x, [...new Set(days)])
      setProp(null)
      setToast('New plan locked in and synced to your trip. Leave-by times updated.')
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const reject = async () => {
    if (!prop) return
    await engine.reject(c.id, prop.id)
    setProp(null)
  }
  const react = async (b: Block, reaction: string) => {
    const r = await engine.feedback(c.id, { day, block_id: b.id, reaction, actual_dwell: reaction === 'loved' ? Math.round(b.dwell * 1.4) : undefined })
    setC(await engine.capsule(c.id))
    setToast(r.learned.length ? `Learned: ${r.learned.join('; ')}` : 'Thanks, noted.')
  }
  const addExpense = async () => {
    if (!amt) return
    const label = `${cat} · Day ${day + 1}`
    const budget = await engine.expense(c.id, day, +amt, label)
    await budgetApi.create(tripId, { name: label, category: cat, total_price: +amt, currency: 'INR' }).catch(() => undefined)
    setC({ ...c, budget })
    setAmt('')
    setToast(budget.over_budget ? 'Spending is above plan. Use “Budget exceeded” to get cheaper picks for the rest of today.' : `Logged ${rupees(+amt)} to your Trip Wallet`)
  }
  const locate = () => {
    if (!navigator.geolocation) return setLoc('Location not available on this device')
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc(`You are at ${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)} (±${Math.round(p.coords.accuracy)} m)`),
      () => setLoc('Location permission denied, so Tripzy uses your plan instead'),
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 px-4 py-5 lg:grid-cols-[440px_minmax(0,1fr)]">
        <section className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="tz-coral-btn inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>
                <span className="text-body font-semibold text-content">{c.city.name}</span>
              </div>
              <select className="tz-input !h-9 !w-auto" value={day} aria-label="Trip day"
                onChange={(e) => (setDay(+e.target.value), demoClock && setNow(Math.max(0, (c.days[+e.target.value].blocks[0]?.s ?? 540) - 30)))}>
                {c.days.map((x) => <option key={x.index} value={x.index}>Day {x.index + 1} · {x.weekday}</option>)}
              </select>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="w-16 text-[26px] font-bold tabular-nums text-content">{fmtMin(now)}</span>
              {demoClock ? (
                <>
                  <input type="range" min={300} max={23 * 60} step={5} value={now} onChange={(e) => setNow(+e.target.value)} className="flex-1 accent-[var(--accent)]" aria-label="Demo clock" />
                  <button type="button" className="rounded-lg border border-edge px-2 py-1 text-caption text-content-secondary hover:bg-surface-hover" onClick={() => setNow(Math.min(23 * 60, now + 30))}>+30m</button>
                </>
              ) : <span className="text-body text-content-muted">Real time</span>}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-content-faint">
              <span>{demoClock ? 'Demo clock: the trip is not today, so you can scrub through the day' : 'Following your phone clock'}</span>
              <button type="button" onClick={locate} className="inline-flex items-center gap-1 text-content-muted hover:text-content"><LocateFixed className="h-3 w-3" />Use my location</button>
            </div>
            {loc && <div className="mt-1 text-caption text-content-muted">{loc}</div>}
          </Card>

          <Card className="overflow-hidden">
            <div className="relative bg-[#0f1a3d] p-5 text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Now</div>
              <div className="mt-1 text-[22px] font-bold leading-tight">{current ? current.name : next ? 'Free time' : 'Day complete'}</div>
              {current && <div className="text-body text-white/70">until {current.end} · {current.e - now} min left</div>}
              <div className="mt-3 max-w-[260px]"><EnergyBarDark pct={d.verify.energy.pct} /></div>
            </div>
            {next ? (
              <div className="flex gap-4 p-5">
                <PlaceImage id={next.place_id} cat={next.cat} alt={next.name} className="h-20 w-20 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <Eyebrow>Next</Eyebrow>
                  <div className="mt-0.5 truncate text-subtitle font-semibold text-content">{next.name}</div>
                  <div className="text-caption tabular-nums text-content-muted">{next.start}–{next.end}</div>
                  {legToNext && (
                    <div className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-body ${leaveIn <= 10 ? 'tz-coral-pill' : 'bg-surface-secondary text-content-secondary'}`}>
                      <Timer className="h-4 w-4 shrink-0" />
                      <span>Leave by <b>{legToNext.depart_by}</b> {leaveIn > 0 ? `(in ${leaveIn} min)` : '(now)'} · {legToNext.mode} {legToNext.minutes} min{legToNext.cost ? ` · ~${rupees(legToNext.cost)}` : ''}</span>
                    </div>
                  )}
                  <a className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-body font-semibold text-accent-text hover:bg-accent-hover" target="_blank" rel="noreferrer" href={mapsLink(next.lat, next.lon, next.name)}>
                    <Navigation className="h-4 w-4" />Navigate
                  </a>
                </div>
              </div>
            ) : <div className="p-5 text-body text-content-muted">Nothing else planned today.</div>}
          </Card>

          <Card className="p-4">
            <Eyebrow className="mb-2.5">Something changed?</Eyebrow>
            <div className="grid grid-cols-2 gap-2">
              <Act icon={<Timer />} label="Running 30 min late" onClick={() => fire({ type: 'late', minutes: 30 })} disabled={busy} />
              <Act icon={<BatteryLow />} label="I'm tired" onClick={() => fire({ type: 'tired' })} disabled={busy} />
              <Act icon={<Heart />} label="Loving it, stay longer" onClick={() => fire({ type: 'extend', minutes: 45 })} disabled={busy || !current} />
              <Act icon={<SkipForward />} label="Skip this stop" onClick={() => (current || next) && fire({ type: 'skip', block_id: (current?.kind === 'place' ? current : next)!.id })} disabled={busy || !(current || next)} />
              <Act icon={<Store />} label="Next place closed" onClick={() => next && fire({ type: 'closed', block_id: next.id })} disabled={busy || next?.kind !== 'place'} />
              <Act icon={<CloudRain />} label="Rain coming" onClick={() => fire({ type: 'rain', from: fmtMin(now), to: fmtMin(now + 180) })} disabled={busy} />
              {arrival && <Act icon={<Train />} label="Train delayed 2 h" onClick={() => fire({ type: 'delay', minutes: 120 })} disabled={busy} coral />}
            </div>
          </Card>

          {toRate.length > 0 && (
            <Card className="p-4">
              <Eyebrow className="mb-2">How was it? Tripzy learns</Eyebrow>
              {toRate.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate text-body text-content">{b.name}</span>
                  <span className="flex shrink-0 gap-1">
                    <Rate label="Loved it" onClick={() => react(b, 'loved')}><Heart className="h-4 w-4" /></Rate>
                    <Rate label="It was okay" onClick={() => react(b, 'ok')}><ThumbsUp className="h-4 w-4" /></Rate>
                    <Rate label="Skip next time" onClick={() => react(b, 'skip')}><ThumbsDown className="h-4 w-4" /></Rate>
                  </span>
                </div>
              ))}
            </Card>
          )}

          <Card className="p-4">
            <Eyebrow className="mb-2 flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" />Trip Wallet · today</Eyebrow>
            <div className="flex items-end justify-between text-body">
              <span className="text-content">Spent <b>{rupees(dayBudget?.spent ?? 0)}</b> <span className="text-content-muted">of {rupees(dayBudget?.planned ?? 0)} planned</span></span>
              {c.budget.over_budget && <Pill tone="danger">over plan</Pill>}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-tertiary">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, ((dayBudget?.spent ?? 0) / Math.max(1, dayBudget?.planned ?? 1)) * 100)}%`, background: c.budget.over_budget ? 'var(--danger)' : 'var(--accent)' }} />
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), addExpense())}>
              <select className="tz-input !w-32" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                {['Food', 'Transport', 'Activities', 'Shopping', 'Accommodation', 'Other'].map((x) => <option key={x}>{x}</option>)}
              </select>
              <input className="tz-input" inputMode="numeric" placeholder="₹ amount" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ''))} aria-label="Amount" />
              <Button type="submit" disabled={!amt} aria-label="Add expense"><Plus className="h-4 w-4" /></Button>
            </form>
            <button type="button" className="mt-2 text-caption font-semibold text-accent-on" onClick={() => fire({ type: 'over_budget' })} disabled={busy}>Budget exceeded? Get cheaper picks for the rest of today →</button>
          </Card>
        </section>

        <section>
          <Card className="mb-3 flex flex-wrap items-center gap-6 p-4">
            <ScoreRing score={d.verify.score} label="feasible" />
            <EnergyBar pct={d.verify.energy.pct} sub={`set by ${d.limiter}`} />
            <Link to={`/trips/${tripId}/intel`} className="ml-auto text-body font-semibold text-accent-on">Full plan →</Link>
          </Card>
          <IntelTimeline day={d} nowMin={now} compact />
        </section>
      </div>
      {prop && <DiffSheet p={prop} onAccept={accept} onReject={reject} busy={busy} simulated={demoClock} />}
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </PageShell>
  )
}

function EnergyBarDark({ pct }: { pct: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-white/60"><span>Today's energy load</span><span className="font-semibold text-white">{pct}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: pct > 95 ? '#ff6b4a' : '#7dd3a8' }} /></div>
    </div>
  )
}

function Act({ icon, label, onClick, disabled, coral }: { icon: React.ReactElement; label: string; onClick: () => void; disabled?: boolean; coral?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-body font-medium transition disabled:opacity-40 ${coral ? 'tz-coral-pill border-transparent' : 'border-edge bg-surface-card text-content hover:border-[var(--accent)]'}`}>
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}
    </button>
  )
}

function Rate({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-content-secondary hover:border-[var(--accent)] hover:text-accent-on">{children}</button>
}
