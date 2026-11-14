import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Brain, Loader2, RefreshCw, Sparkles, Users } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { engine, lastCapsule, rememberCapsule } from '../../tripzy/engine'
import { resyncDays } from '../../tripzy/bridge'
import type { CapsuleX } from '../../tripzy/types'
import { Button, Card, Eyebrow, Pill, Toast } from '../../tripzy/ui'

const TRAITS: [keyof CapsuleX['dna'], string, string, string][] = [
  ['pace', 'Pace', 'Slow & deep', 'Packed days'],
  ['stamina', 'Stamina', 'Gentle', 'Climb anything'],
  ['food', 'Food adventure', 'Trusted classics', 'Street-food hunter'],
  ['crowd', 'Crowd tolerance', 'Avoids crowds', 'Loves the buzz'],
  ['budget', 'Budget style', 'Smart saver', 'Splurges'],
  ['morning', 'Mornings', 'Late starter', 'Early bird'],
]

export default function DnaPage(): React.ReactElement {
  const [c, setC] = useState<CapsuleX | null>(null)
  const [none, setNone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  useEffect(() => {
    const last = lastCapsule()
    if (!last) return setNone(true)
    engine.capsule(last.id).then(setC).catch(() => setNone(true))
  }, [])

  if (none) {
    return (
      <PageShell background="var(--bg-primary)">
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><Brain className="h-7 w-7" /></span>
          <h1 className="mt-4 text-title font-bold text-content">Your Travel DNA starts with a trip</h1>
          <p className="mt-2 text-body text-content-muted">Answer 12 quick either/or cards while planning. Tripzy turns them into pace, energy and interest weights, and keeps learning on the road.</p>
          <Link to="/plan" className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-body font-semibold text-accent-text"><Sparkles className="h-4 w-4" />Plan with Tripzy</Link>
        </div>
      </PageShell>
    )
  }
  if (!c) return <PageShell background="var(--bg-primary)"><div className="grid h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-accent-on" /></div></PageShell>

  const interests = Object.entries(c.dna.interests).sort((a, b) => b[1] - a[1])
  const retune = async () => {
    setBusy(true)
    try {
      const from = c.ripple_log.length ? Math.min(c.days.length - 1, Math.max(...c.ripple_log.map((r) => r.day)) + 1) : 0
      const x = await engine.retune(c.id, from)
      setC(x)
      if (c.platform_trip_id) {
        await resyncDays(c.platform_trip_id, x, x.days.filter((d) => d.index >= from).map((d) => d.index))
        rememberCapsule(c.id, c.platform_trip_id)
      }
      setToast(`Re-tuned Day ${from + 1} onward with your updated DNA`)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow className="tz-coral-text">Travel DNA</Eyebrow>
            <h1 className="mt-1 text-title font-bold text-content">How Tripzy understands you</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">{c.dna_summary.map((x) => <Pill key={x} tone="accent">{x}</Pill>)}</div>
          </div>
          <div className="flex gap-2">
            <Link to="/plan" className="inline-flex h-10 items-center rounded-xl border border-edge bg-surface-card px-4 text-body font-semibold text-content hover:bg-surface-hover">Retake on a new trip</Link>
            <Button onClick={retune} disabled={busy || !c.learned.length}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Apply learning to upcoming days</Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <Eyebrow className="mb-4">Traits · start of trip vs now</Eyebrow>
            <div className="space-y-5">
              {TRAITS.map(([k, label, lo, hi]) => {
                const now = c.dna[k] as number
                const was = (c.dna_initial?.[k] as number) ?? now
                return (
                  <div key={k}>
                    <div className="mb-1.5 flex justify-between text-body"><span className="font-medium text-content">{label}</span><span className="tabular-nums text-content-muted">{Math.round(now * 100)}</span></div>
                    <div className="relative h-2.5 rounded-full bg-surface-tertiary">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${now * 100}%` }} />
                      {Math.abs(was - now) > 0.005 && <div className="absolute -top-1 h-4.5 w-0.5 rounded bg-content" style={{ left: `${was * 100}%`, height: 18 }} title="Start of trip" />}
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-content-faint"><span>{lo}</span><span>{hi}</span></div>
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="space-y-5">
            <Card className="p-6">
              <Eyebrow className="mb-4">Interests (weights used to rank places)</Eyebrow>
              <div className="space-y-2.5">
                {interests.map(([k, val]) => {
                  const was = c.dna_initial?.interests?.[k] ?? val
                  const delta = val - was
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-body capitalize text-content">{k}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-tertiary"><div className="h-full rounded-full" style={{ width: `${val * 100}%`, background: val >= 0.65 ? 'var(--tz-coral)' : 'var(--accent)' }} /></div>
                      <span className={`w-10 text-right text-caption tabular-nums ${delta > 0.01 ? 'text-success' : delta < -0.01 ? 'text-danger' : 'text-content-faint'}`}>
                        {delta > 0.01 ? '▲' : delta < -0.01 ? '▼' : ''}{Math.round(val * 100)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
            <Card className="p-6">
              <Eyebrow className="mb-3 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Travelling group</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {c.travellers.map((t) => <Pill key={t.label}>{t.label} · {t.age}{t.mobility === 'limited' ? ' · limited mobility' : ''}</Pill>)}
              </div>
              <p className="mt-3 text-body text-content-muted">Daily energy budget is <b className="text-content">{c.days[0].energy_budget} units</b>, set by <b className="text-content">{c.days[0].limiter}</b>, because the group moves at the pace of its most limited member.</p>
            </Card>
          </div>
        </div>

        <Card className="mt-5 p-6">
          <Eyebrow className="mb-3 flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" />Learning history</Eyebrow>
          {c.learned.length === 0 && <p className="text-body text-content-muted">Rate stops in Live Companion (Loved it · It was okay · Skip next time). Each reaction adjusts these weights with a simple, transparent rule, not a trained model.</p>}
          <ol className="space-y-2">
            {c.learned.map((l, i) => (
              <li key={i} className="flex flex-wrap gap-2 rounded-xl bg-surface-secondary px-3 py-2 text-body">
                <b className="text-content">Day {l.day} · {l.from}</b><span className="text-content-secondary">{l.text}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
    </PageShell>
  )
}
