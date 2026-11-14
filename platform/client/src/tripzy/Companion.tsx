import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, MapPin, Navigation, Phone, Send, Sparkles, Star, X } from 'lucide-react'
import { engine, mapsLink } from './engine'
import type { CompanionAction, CompanionCard, TripAlert } from './engine'
import { resyncDays } from './bridge'
import DiffSheet from './DiffSheet'
import type { CapsuleX, Proposal } from './types'
import { Button, Pill } from './ui'

type Msg = { role: 'user' | 'tripzy'; text: string; cards?: CompanionCard[]; action?: CompanionAction | null; source?: string }

const SUGGESTIONS = ["What's next?", "We're running 30 min late", 'Find a pharmacy nearby', 'Will it rain?', 'How much have we spent?', 'Show hotels']

/**
 * Tripzy Companion: floating, context-aware help for one trip. It answers from
 * the real plan, and any change it suggests goes through confirmation and the
 * Ripple Diff Card before it is saved and synced to the platform trip.
 */
export default function Companion({ capsuleId, tripId, day, now, onCapsule }: {
  capsuleId: string; tripId: number; day: number; now?: string; onCapsule?: (c: CapsuleX) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState<TripAlert[]>([])
  const [prop, setProp] = useState<Proposal | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    engine.alerts(capsuleId).then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]))
  }, [capsuleId])
  useEffect(() => {
    // newer browsers return a Promise here; an effect must return nothing
    void end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, busy])

  const say = async (m: string) => {
    const q = m.trim()
    if (!q || busy) return
    setText('')
    setMsgs((x) => [...x, { role: 'user', text: q }])
    setBusy(true)
    try {
      const r = await engine.companion(capsuleId, q, day, now)
      setMsgs((x) => [...x, { role: 'tripzy', text: r.reply, cards: r.cards, action: r.action, source: r.source }])
    } catch (e) {
      setMsgs((x) => [...x, { role: 'tripzy', text: `Sorry, that didn't work: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  const run = async (a: CompanionAction) => {
    setBusy(true)
    try {
      const p = await engine.ripple(capsuleId, a.day, a.now, a.event)
      if (p.auto_apply) {
        const x = await engine.capsule(capsuleId)
        await resyncDays(tripId, x, [a.day])
        onCapsule?.(x)
        setMsgs((m) => [...m, { role: 'tripzy', text: `${p.diff.headline}. Small change, applied and synced to your trip.` }])
      } else setProp(p)
    } catch (e) {
      setMsgs((m) => [...m, { role: 'tripzy', text: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }
  const accept = async () => {
    if (!prop) return
    setBusy(true)
    try {
      const x = await engine.accept(capsuleId, prop.id)
      await resyncDays(tripId, x, [...new Set([prop.day, ...prop.diff.moved.map((m) => m.to_day - 1)])])
      onCapsule?.(x)
      setMsgs((m) => [...m, { role: 'tripzy', text: 'Done. The new plan is saved and synced to your trip.' }])
      setProp(null)
    } finally {
      setBusy(false)
    }
  }
  const reject = async () => {
    if (!prop) return
    await engine.reject(capsuleId, prop.id)
    setProp(null)
    setMsgs((m) => [...m, { role: 'tripzy', text: 'Kept your original plan.' }])
  }

  const warn = alerts.filter((a) => a.level === 'warn').length

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="tz-coral-btn fixed bottom-24 right-4 z-[2500] flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-modal md:bottom-6 md:right-6"
          aria-label="Open Tripzy Companion"
        >
          <Sparkles className="h-4 w-4" /> Ask Tripzy
          {warn > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-[#ff6b4a]">{warn}</span>}
        </button>
      )}
      {open && (
        <div className="tz-rise fixed inset-x-2 bottom-2 z-[2600] flex max-h-[80vh] flex-col overflow-hidden rounded-3xl border border-edge bg-surface-card shadow-modal sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px]" role="dialog" aria-label="Tripzy Companion">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="tz-coral-pill grid h-8 w-8 place-items-center rounded-full"><Sparkles className="h-4 w-4" /></span>
              <div>
                <div className="text-sm font-bold text-content">Tripzy Companion</div>
                <div className="text-[11px] text-content-faint">Knows this trip · changes need your OK</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-content-muted hover:bg-surface-hover" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {alerts.length > 0 && msgs.length === 0 && (
              <div className="space-y-1.5">
                {alerts.slice(0, 4).map((a, i) => (
                  <div key={i} className={`flex gap-2 rounded-xl px-3 py-2 text-xs ${a.level === 'warn' ? 'bg-warning-soft text-warning' : 'bg-surface-secondary text-content-secondary'}`}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a.text}
                  </div>
                ))}
              </div>
            )}
            {msgs.length === 0 && (
              <p className="text-sm text-content-muted">Ask about your plan, or tell me what's happening and I'll re-plan with you.</p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-accent text-accent-text' : 'bg-surface-secondary text-content'}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.cards?.map((c, j) => <CardView key={j} c={c} />)}
                  {m.action && (
                    <div className="mt-2.5 rounded-xl border border-edge bg-surface-card p-2.5">
                      <p className="text-xs text-content-muted">{m.action.confirm}</p>
                      <Button className="mt-2 w-full" variant="coral" disabled={busy} onClick={() => run(m.action!)}>{m.action.label}</Button>
                    </div>
                  )}
                  {m.source === 'gemini' && <div className="mt-1.5 text-[10px] text-content-faint">AI answer (Gemini) · based on your trip; check important details</div>}
                </div>
              </div>
            ))}
            {busy && <Loader2 className="h-4 w-4 animate-spin text-accent-on" />}
            <div ref={end} />
          </div>

          <div className="border-t border-edge p-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => say(s)} className="shrink-0 rounded-full border border-edge px-2.5 py-1 text-xs text-content-secondary hover:bg-surface-hover">{s}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); say(text) }} className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ask anything about this trip…" className="tz-input flex-1" aria-label="Message" />
              <Button type="submit" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
            </form>
          </div>
        </div>
      )}
      {prop && <DiffSheet p={prop} onAccept={accept} onReject={reject} busy={busy} />}
    </>
  )
}

function CardView({ c }: { c: CompanionCard }): React.ReactElement {
  if (c.type === 'emergency') {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {c.items.map((e) => (
          <a key={e.label} href={`tel:${e.number}`} className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1.5 text-xs text-danger">
            <Phone className="h-3 w-3" /> <span className="truncate">{e.label}</span> <b className="ml-auto">{e.number}</b>
          </a>
        ))}
      </div>
    )
  }
  if (c.type === 'packing') {
    return <div className="mt-2 flex flex-wrap gap-1">{c.items.map((x) => <Pill key={x}>{x}</Pill>)}</div>
  }
  if (c.type === 'places') {
    return (
      <div className="mt-2 space-y-1.5">
        {c.items.map((p) => (
          <a key={p.name + p.lat} href={mapsLink(p.lat, p.lon, p.name)} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-lg bg-surface-card px-2.5 py-2 text-xs hover:bg-surface-hover">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-on" />
            <span className="min-w-0 flex-1"><b className="block truncate text-content">{p.name}</b><span className="block truncate text-content-muted">{p.address}</span></span>
            {p.distance_m != null && <span className="shrink-0 text-content-faint">{p.distance_m < 1000 ? `${p.distance_m} m` : `${(p.distance_m / 1000).toFixed(1)} km`}</span>}
            <Navigation className="h-3.5 w-3.5 shrink-0 text-content-faint" />
          </a>
        ))}
        {c.source && <div className="text-[10px] text-content-faint">{c.source}</div>}
      </div>
    )
  }
  return (
    <div className="mt-2 space-y-1.5">
      {c.items.map((h) => (
        <div key={h.id} className="flex gap-2 rounded-lg bg-surface-card p-2 text-xs">
          {h.photo && <img src={h.photo} alt="" className="h-12 w-14 shrink-0 rounded-md object-cover" loading="lazy" />}
          <div className="min-w-0 flex-1">
            <b className="block truncate text-content">{h.name}</b>
            <span className="text-content-muted">{h.stars ? `${h.stars}★ · ` : ''}{h.rating ? <><Star className="inline h-3 w-3" /> {h.rating}/10 · </> : ''}{h.refundable ? 'Free cancellation' : 'Non-refundable'}</span>
          </div>
          <b className="shrink-0 text-content">₹{h.total.toLocaleString('en-IN')}</b>
        </div>
      ))}
      <div className="text-[10px] text-content-faint">{c.source}{c.sandbox ? ' · test prices, not bookable' : ''} · total for the stay</div>
    </div>
  )
}
