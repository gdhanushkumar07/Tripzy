import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, MapPin, Navigation, Phone, Send, Star, X } from 'lucide-react'
import { engine, mapsLink } from './engine'
import type { CompanionAction, CompanionCard, TripAlert } from './engine'
import { resyncDays } from './bridge'
import DiffSheet from './DiffSheet'
import type { CapsuleX, Proposal } from './types'
import { Button, Pill } from './ui'
import { Emblem } from './PublicLayout'
import { gsap, prefersReducedMotion, useGSAP } from './motion'

type Msg = { role: 'user' | 'tripzy'; text: string; cards?: CompanionCard[]; action?: CompanionAction | null; source?: string }

const SUGGESTIONS = ["What's next?", "We're running 30 min late", 'Find a pharmacy nearby', 'Will it rain?', 'How much have we spent?', 'Show hotels']

/**
 * Tripzy Companion: floating, context-aware help for one trip. It answers from
 * the real plan, and any change it suggests goes through confirmation and the
 * Ripple Diff Card before it is saved and synced to the platform trip.
 */
export default function Companion({ capsuleId, tripId, day, now, onCapsule, city }: {
  capsuleId: string; tripId: number; day: number; now?: string; onCapsule?: (c: CapsuleX) => void; city?: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState<TripAlert[]>([])
  const [prop, setProp] = useState<Proposal | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    if (!open || !panel.current || prefersReducedMotion()) return
    gsap.fromTo(panel.current, { opacity: 0, y: 24, scale: 0.97, transformOrigin: '100% 100%' }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out' })
  }, { dependencies: [open] })

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
          className="fixed bottom-[calc(var(--bottom-nav-h,0px)+16px)] end-4 z-[2500] flex items-center gap-2.5 rounded-full bg-[#18211F] py-2 pe-5 ps-2 text-[14px] font-semibold text-[#F7F5EF] shadow-[0_18px_40px_-12px_rgba(24,33,31,.55)] transition hover:-translate-y-0.5 md:bottom-6 md:end-6"
          aria-label="Open Tripzy Companion"
        >
          <Emblem className="h-8 w-8" light /> Ask Tripzy
          {warn > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#D98955] px-1 text-[11px] font-bold text-[#18211F]">{warn}</span>}
        </button>
      )}
      {open && (
        <div ref={panel} className="fixed inset-x-0 bottom-0 z-[2600] flex max-h-[88svh] flex-col overflow-hidden rounded-t-[28px] border border-edge bg-[var(--bg-primary)] pb-[env(safe-area-inset-bottom)] shadow-[0_30px_90px_-20px_rgba(24,33,31,.45)] sm:inset-x-auto sm:bottom-6 sm:end-6 sm:max-h-[78vh] sm:w-[420px] sm:rounded-[28px] sm:pb-0" role="dialog" aria-label="Tripzy Companion">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--border-primary)] sm:hidden" aria-hidden />
          <div className="flex items-center justify-between px-5 pb-3 pt-3 sm:pt-4">
            <div className="flex items-center gap-3">
              <Emblem className="h-10 w-10" />
              <div>
                <div className="font-serif text-[22px] leading-none text-content">Tripzy</div>
                <div className="mt-1 text-[12px] text-content-muted">Travelling with you{city ? ` · ${city}` : ''} · Day {day + 1}</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-content-muted hover:bg-surface-hover" aria-label="Close"><X className="h-4 w-4" /></button>
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
              <div className="max-w-[88%] rounded-[20px] rounded-bl-md bg-surface-card px-4 py-3 text-[15px] leading-relaxed text-content">
                Hi! I know this trip inside out. Ask me what's next, or tell me what's happening and I'll suggest a new plan. Nothing changes until you say yes.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`tz-rise max-w-[90%] px-4 py-2.5 text-[15px] leading-relaxed ${m.role === 'user' ? 'rounded-[20px] rounded-br-md bg-accent text-accent-text' : 'rounded-[20px] rounded-bl-md bg-surface-card text-content'}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.cards?.map((c, j) => <CardView key={j} c={c} />)}
                  {m.action && (
                    <div className="mt-3 rounded-2xl border border-edge bg-[var(--bg-primary)] p-3">
                      <p className="text-xs text-content-muted">{m.action.confirm}</p>
                      <Button className="mt-2 w-full" variant="coral" disabled={busy} onClick={() => run(m.action!)}>{m.action.label}</Button>
                    </div>
                  )}
                  {m.source === 'gemini' && <div className="mt-1.5 text-[10px] text-content-faint">AI answer (Gemini) · based on your trip; check important details</div>}
                </div>
              </div>
            ))}
            {busy && <div className="tz-typing w-fit rounded-[20px] rounded-bl-md bg-surface-card px-4 py-3 text-content-faint" role="status" aria-label="Tripzy is thinking"><span /><span /><span /></div>}
            <div ref={end} />
          </div>

          <div className="border-t border-edge bg-surface-card p-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => say(s)} className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-[12px] text-content-secondary hover:border-[var(--accent)] hover:text-accent-on">{s}</button>
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
