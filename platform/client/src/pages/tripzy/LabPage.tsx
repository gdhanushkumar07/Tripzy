import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BatteryLow, CheckCircle2, CloudRain, FlaskConical, Hourglass, IndianRupee, Loader2, Play, Store, Train } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { engine, fmtMin, lastCapsule, rememberCapsule } from '../../tripzy/engine'
import { materialize, resyncDays } from '../../tripzy/bridge'
import IntelTimeline from '../../tripzy/IntelTimeline'
import type { Block, CapsuleX, Day, Proposal } from '../../tripzy/types'
import { Button, Card, Eyebrow, Pill, Toast } from '../../tripzy/ui'

type Scenario = { key: string; title: string; detail: string; icon: React.ElementType; build: (c: CapsuleX) => { day: number; now: number; event: Record<string, unknown> } | null }

const places = (d: Day) => d.blocks.filter((b) => b.kind === 'place')
const SCENARIOS: Scenario[] = [
  {
    key: 'train', title: 'Train delayed by 2 hours', icon: Train,
    detail: 'The arrival train slips 120 min. The fixed booking moves, and the rest of the day is re-timed, trimmed or moved to keep meals sane.',
    build: (c) => {
      const d = c.days.find((x) => x.blocks.some((b) => b.kind === 'anchor' && b.name.startsWith('Arrive')))
      if (!d) return null
      const a = d.blocks.find((b) => b.kind === 'anchor')!
      return { day: d.index, now: a.s - 30, event: { type: 'delay', minutes: 120 } }
    },
  },
  {
    key: 'rain', title: 'Heavy rain', icon: CloudRain,
    detail: 'Rain over an outdoor stop: it swaps to its pre-computed indoor Plan B and the day is re-verified.',
    build: (c) => {
      for (const d of c.days) {
        const b = places(d).find((x) => !x.indoor && x.plan_b?.rain)
        if (b) return { day: d.index, now: b.s - 20, event: { type: 'rain', from: b.start, to: fmtMin(b.e + 60) } }
      }
      return null
    },
  },
  {
    key: 'tired', title: 'Traveller is tired', icon: BatteryLow,
    detail: 'Mid-visit fatigue: wrap up, insert a recharge break nearby and soften heavy stops later in the day.',
    build: (c) => {
      const d = c.days[Math.min(1, c.days.length - 1)]
      const b = places(d)[0]
      return b ? { day: d.index, now: b.s + 20, event: { type: 'tired' } } : null
    },
  },
  {
    key: 'closed', title: 'Attraction unexpectedly closed', icon: Store,
    detail: 'The next sight is shut today: Tripzy swaps in the closest DNA-matched alternative that is open now.',
    build: (c) => {
      const d = c.days[Math.min(1, c.days.length - 1)]
      const ps = places(d)
      const b = ps[1] ?? ps[0]
      return b ? { day: d.index, now: b.s - 25, event: { type: 'closed', block_id: b.id } } : null
    },
  },
  {
    key: 'extend', title: 'Stay one hour longer', icon: Hourglass,
    detail: "Loving it: +60 min here. Everything after shifts, and the lowest-value stop moves or drops if the day can't absorb it.",
    build: (c) => {
      const d = c.days[c.days.length - 1]
      const b = places(d)[0]
      return b ? { day: d.index, now: b.s + 15, event: { type: 'extend', minutes: 60 } } : null
    },
  },
  {
    key: 'budget', title: 'Budget exceeded', icon: IndianRupee,
    detail: 'Spending ran over: remaining meals and paid sights swap to cheaper, still-matching options.',
    build: (c) => ({ day: 0, now: 6 * 60, event: { type: 'over_budget' } }),
  },
]
const PIPELINE = ['Event received', 'Trip Capsule loaded', 'Affected blocks found', 'Legs & hours re-checked', 'Energy & budget recomputed', 'Diff ready']

export default function LabPage(): React.ReactElement {
  const [c, setC] = useState<CapsuleX | null>(null)
  const [tripId, setTripId] = useState<number | null>(null)
  const [setup, setSetup] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [stage, setStage] = useState(0)
  const [prop, setProp] = useState<Proposal | null>(null)
  const [before, setBefore] = useState<Day | null>(null)
  const [toast, setToast] = useState('')

  const load = async (cid: string, tid: number) => {
    setC(await engine.capsule(cid))
    setTripId(tid)
  }
  useEffect(() => {
    const last = lastCapsule()
    if (last?.platformTripId) load(last.id, last.platformTripId).catch(() => undefined)
  }, [])

  const createDemo = async () => {
    try {
      setSetup('Composing demo trip')
      const { capsule_id } = await engine.demoSeed()
      const cap = await engine.capsule(capsule_id)
      const tid = await materialize(cap, setSetup)
      rememberCapsule(capsule_id, tid)
      await load(capsule_id, tid)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setSetup('')
    }
  }

  const run = async (s: Scenario) => {
    if (!c) return
    const spec = s.build(c)
    if (!spec) return setToast('This trip has no stop that fits this scenario. Use the demo trip.')
    setRunning(s.key)
    setProp(null)
    setBefore(c.days[spec.day])
    for (let i = 1; i <= PIPELINE.length - 1; i++) {
      setStage(i)
      await new Promise((r) => setTimeout(r, 140))
    }
    try {
      const p = await engine.ripple(c.id, spec.day, fmtMin(spec.now), spec.event)
      setStage(PIPELINE.length)
      if (p.auto_apply) {
        setC(await engine.capsule(c.id))
        setToast(`${p.diff.headline}: minor shift, applied automatically`)
      }
      setProp(p)
    } catch (e) {
      setToast((e as Error).message)
    }
  }
  const decide = async (accept: boolean) => {
    if (!c || !prop) return
    const x = accept ? await engine.accept(c.id, prop.id) : await engine.reject(c.id, prop.id)
    setC(x as CapsuleX)
    if (accept && tripId) await resyncDays(tripId, x, [...new Set([prop.day, ...prop.diff.moved.map((m) => m.to_day - 1)])])
    setToast(accept ? 'Accepted: saved to the Trip Capsule and synced to the trip' : 'Rejected: original plan kept')
    setProp(null)
    setRunning(null)
    setStage(0)
  }

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow className="tz-coral-text">Simulated events · demo</Eyebrow>
            <h1 className="mt-1 flex items-center gap-2 text-title font-bold text-content"><FlaskConical className="h-6 w-6 text-accent-on" />Ripple Test Lab</h1>
            <p className="max-w-2xl text-body text-content-muted">Trigger controlled disruptions against a real trip. Each runs the backend Ripple Engine and produces an actual diff you can accept or reject. These events are simulated and never shown as live data.</p>
          </div>
          <div className="flex gap-2">
            {c && tripId && <Link to={`/trips/${tripId}/intel`} className="inline-flex h-10 items-center rounded-xl border border-edge bg-surface-card px-4 text-body font-semibold text-content hover:bg-surface-hover">Open trip</Link>}
            <Button onClick={createDemo} disabled={!!setup}>{setup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{setup || (c ? 'New demo trip' : 'Create demo trip')}</Button>
          </div>
        </div>

        {!c && !setup && (
          <Card className="mt-6 p-10 text-center">
            <p className="text-body text-content-muted">No trip loaded. Create the demo trip: Hyderabad, 3 days, with parents, veg, arriving by train 12723 (sample booking).</p>
          </Card>
        )}

        {c && (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SCENARIOS.map((s) => {
                const I = s.icon
                const active = running === s.key
                return (
                  <Card key={s.key} className={`flex flex-col p-5 transition ${active ? 'ring-2 ring-[var(--accent)]' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-subtle text-accent-on"><I className="h-5 w-5" /></span>
                      <div className="font-semibold text-content">{s.title}</div>
                    </div>
                    <p className="mt-2 flex-1 text-body text-content-muted">{s.detail}</p>
                    <Button variant={active ? 'primary' : 'secondary'} className="mt-4" disabled={!!running && !active} onClick={() => run(s)}>
                      <Play className="h-4 w-4" />{active ? 'Running' : 'Trigger'}
                    </Button>
                  </Card>
                )
              })}
            </div>

            {running && (
              <Card className="mt-6 p-5">
                <Eyebrow className="mb-3">Ripple processing</Eyebrow>
                <ol className="flex flex-wrap gap-2">
                  {PIPELINE.map((p, i) => (
                    <li key={p} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium ${i < stage ? 'bg-success-soft text-success' : 'bg-surface-secondary text-content-muted'}`}>
                      {i < stage ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Loader2 className={`h-3.5 w-3.5 ${i === stage ? 'animate-spin' : 'opacity-40'}`} />}{p}
                    </li>
                  ))}
                </ol>
                {prop && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-subtitle font-bold text-content">{prop.diff.headline}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Pill tone="accent">Feasibility {prop.diff.feasibility.before} → {prop.diff.feasibility.after}</Pill>
                          <Pill>Energy {prop.diff.energy.before}% → {prop.diff.energy.after}%</Pill>
                          {prop.diff.swapped.map((s) => <Pill key={s.from} tone="accent">{s.from} → {s.to}</Pill>)}
                          {prop.diff.moved.map((m) => <Pill key={m.name} tone="warning">{m.name} → Day {m.to_day}</Pill>)}
                          {prop.diff.dropped.map((m) => <Pill key={m.name} tone="danger">dropped {m.name}</Pill>)}
                          {prop.diff.inserted.map((x) => <Pill key={x} tone="success">+ {x}</Pill>)}
                          {prop.diff.shifted.length > 0 && <Pill>{prop.diff.shifted.length} re-timed</Pill>}
                          {prop.auto_apply && <Pill tone="success">auto-applied (minor)</Pill>}
                        </div>
                      </div>
                      {!prop.auto_apply && (
                        <div className="flex gap-2">
                          <Button variant="secondary" onClick={() => decide(false)}>Reject</Button>
                          <Button onClick={() => decide(true)}>Accept & persist</Button>
                        </div>
                      )}
                      {prop.auto_apply && <Button variant="secondary" onClick={() => (setRunning(null), setProp(null), setStage(0))}>Done</Button>}
                    </div>
                    <div className="mt-5 grid gap-5 lg:grid-cols-2">
                      <div><Eyebrow className="mb-2">Before</Eyebrow>{before && <IntelTimeline day={before} compact />}</div>
                      <div><Eyebrow className="mb-2 tz-coral-text">After (proposed)</Eyebrow><IntelTimeline day={prop.preview_day} compact /></div>
                    </div>
                  </div>
                )}
              </Card>
            )}

            <Card className="mt-6 p-5">
              <Eyebrow className="mb-3">Event history · {c.city.name} trip</Eyebrow>
              {c.ripple_log.length === 0 && <p className="text-body text-content-muted">No events yet.</p>}
              <ol className="space-y-2">
                {[...c.ripple_log].reverse().map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2 text-body">
                    <b className="text-content">Day {r.day + 1} · {r.now}</b>
                    <span className="text-content-secondary">{r.diff.headline}</span>
                    {r.auto && <Pill>auto</Pill>}
                    <span className="ml-auto text-caption text-content-muted">{eventSummary(r.diff)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )}
      </div>
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </PageShell>
  )
}

function eventSummary(d: Proposal['diff']) {
  return [
    d.swapped.length && `${d.swapped.length} swapped`, d.moved.length && `${d.moved.length} moved`,
    d.dropped.length && `${d.dropped.length} dropped`, d.shifted.length && `${d.shifted.length} re-timed`,
  ].filter(Boolean).join(' · ')
}

export type { Block }
