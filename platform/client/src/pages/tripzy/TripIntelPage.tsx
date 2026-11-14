import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AlertTriangle, CalendarRange, ClipboardCheck, CheckCircle2, Info, Loader2, MessageSquare, Radio, RefreshCw, Send, Sparkles, Ticket, Wand2 } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { filesApi } from '../../api/client'
import { engine, rememberCapsule, rupees } from '../../tripzy/engine'
import { readPlannerDay, resyncDays } from '../../tripzy/bridge'
import IntelTimeline from '../../tripzy/IntelTimeline'
import RouteMap from '../../tripzy/RouteMap'
import Companion from '../../tripzy/Companion'
import type { Block, Capsule, CapsuleX } from '../../tripzy/types'
import { Button, Card, EnergyBar, Eyebrow, Pill, ScoreRing, Skeleton, Stat, Toast, usePlacePhoto } from '../../tripzy/ui'

export default function TripIntelPage(): React.ReactElement {
  const { id = '' } = useParams()
  const tripId = Number(id)
  const nav = useNavigate()
  const [c, setC] = useState<CapsuleX | null>(null)
  const [missing, setMissing] = useState(false)
  const [day, setDay] = useState(0)
  const [sel, setSel] = useState<string>()
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [edit, setEdit] = useState('')
  const [showBooking, setShowBooking] = useState(false)
  const hero = usePlacePhoto(c ? `city:${c.city_key}` : null)

  useEffect(() => {
    engine.getLink(tripId)
      .then((l) => engine.capsule(l.capsule_id))
      .then((x) => (setC(x), rememberCapsule(x.id, tripId)))
      .catch(() => setMissing(true))
  }, [tripId])

  /** Apply an engine change, then write the affected days back into the trip. */
  const apply = useCallback(async (label: string, fn: () => Promise<Capsule>, days: number[] | 'all', msg?: string) => {
    setBusy(label)
    try {
      const next = await fn()
      setC(next)
      setBusy('Syncing to your trip')
      await resyncDays(tripId, next, days === 'all' ? next.days.map((d) => d.index) : days)
      if (msg) setToast(msg)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy('')
    }
  }, [tripId])

  if (missing) {
    return (
      <PageShell background="var(--bg-primary)">
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-subtle text-accent-on"><Sparkles className="h-7 w-7" /></span>
          <h1 className="mt-4 text-title font-bold text-content">No Tripzy intelligence for this trip yet</h1>
          <p className="mt-2 text-body text-content-muted">Trips planned with Tripzy get feasibility checks, energy pacing, Plan B and live re-planning.</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => nav(`/trips/${tripId}`)}>Back to planner</Button>
            <Button onClick={() => nav('/plan')}><Wand2 className="h-4 w-4" />Plan with Tripzy</Button>
          </div>
        </div>
      </PageShell>
    )
  }
  if (!c) {
    return (
      <PageShell background="var(--bg-primary)">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
          <Skeleton className="h-44" /><Skeleton className="h-20" />
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
        </div>
      </PageShell>
    )
  }

  const d = c.days[day]
  const v = d.verify
  const onChoose = (b: Block, pid: string) =>
    apply('Swapping', () => engine.choose(c.id, day, b.id, pid), [day], 'Swapped, re-timed and re-verified')
  const onRemove = (b: Block) =>
    apply('Removing', async () => (await engine.edit(c.id, `remove ${b.name}`)).capsule, 'all', `Removed ${b.name}; days re-balanced`)
  const sendEdit = () =>
    apply('Re-planning', async () => {
      const r = await engine.edit(c.id, edit)
      const changes = (r.changes || []).map((x) => `Day ${x.day}: ${[...x.added.map((a) => '+' + a), ...x.removed.map((a) => '−' + a)].join(', ')}`)
      setToast([...r.messages, ...changes].join(' · '))
      setEdit('')
      return r.capsule
    }, 'all')
  const recheck = async () => {
    setBusy('Reading your planner')
    try {
      const order = await readPlannerDay(tripId, c, day)
      const r = await engine.resequence(c.id, day, order)
      setC(r.capsule)
      setBusy('Syncing to your trip')
      await resyncDays(tripId, r.capsule, [day])
      setToast(`Re-verified your Day ${day + 1} edits: feasibility ${r.feasibility.before} → ${r.feasibility.after}`)
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-5">
        {/* hero */}
        <div className="relative overflow-hidden rounded-3xl border border-edge bg-surface-tertiary">
          {hero && <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0f1a3d]/90 via-[#0f1a3d]/60 to-transparent" />
          <div className="relative flex flex-wrap items-end justify-between gap-4 p-6 text-white sm:p-8">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70">Trip Capsule · Tripzy intelligence{c.demo ? ' · demo' : ''}</div>
              <h1 className="mt-1 text-[32px] font-bold leading-tight">{c.city.name}, {c.brief.days} days</h1>
              <p className="mt-1 text-white/80">{c.days[0].date} → {c.days[c.days.length - 1].date} · {c.travellers.map((t) => t.label).join(', ')} · stay {c.stay.name}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.dna_summary.map((x) => <span key={x} className="rounded-full bg-white/15 px-2.5 py-0.5 text-caption backdrop-blur">{x}</span>)}
                {c.constraints.diet !== 'any' && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-caption">{c.constraints.diet}</span>}
                {c.constraints.no_stairs && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-caption">no steep climbs</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/trips/${tripId}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-body font-semibold backdrop-blur hover:bg-white/25"><CalendarRange className="h-4 w-4" />Open planner</Link>
              <Link to={`/trips/${tripId}/ready`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-body font-semibold backdrop-blur hover:bg-white/25"><ClipboardCheck className="h-4 w-4" />Readiness &amp; money</Link>
              <Link to={`/trips/${tripId}/live`} className="tz-coral-btn inline-flex h-10 items-center gap-2 rounded-xl px-4 text-body font-semibold"><Radio className="h-4 w-4" />Live Companion</Link>
            </div>
          </div>
        </div>

        {c.notes.length > 0 && <div className="mt-4 rounded-2xl bg-warning-soft p-3 text-body text-warning">{c.notes.map((n) => <div key={n}>{n}</div>)}</div>}

        {/* stay decision card */}
        <section className="mt-6">
          <Eyebrow className="mb-2">Decision card · where to stay</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {c.stay_options.map((o) => {
              const active = o.id === c.stay.id
              return (
                <button key={o.id} type="button" disabled={!!busy || active}
                  onClick={() => apply('Re-planning around ' + o.name, () => engine.stay(c.id, o.id), 'all', `All days re-planned around ${o.name}`)}
                  className={`rounded-2xl border p-4 text-left transition ${active ? 'border-[var(--accent)] bg-accent-subtle' : 'border-edge bg-surface-card hover:border-[var(--accent)]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-content">{o.name}</span>
                    {o.pick && <Pill tone="coral">Tripzy pick</Pill>}
                  </div>
                  <div className="mt-0.5 text-caption text-content-muted">{o.price} · {o.vibe}</div>
                  <div className="mt-2 text-body font-medium text-content">~{o.avg_minutes} min to your top places</div>
                  <div className="text-caption text-content-muted">{o.tradeoff}</div>
                </button>
              )
            })}
          </div>
        </section>

        {/* day tabs */}
        <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Days">
          {c.days.map((x) => (
            <button key={x.index} type="button" onClick={() => setDay(x.index)}
              className={`shrink-0 rounded-2xl border px-4 py-2.5 text-left transition ${x.index === day ? 'border-[var(--accent)] bg-accent text-accent-text' : 'border-edge bg-surface-card text-content hover:border-[var(--accent)]'}`}>
              <div className="text-body font-semibold">Day {x.index + 1}</div>
              <div className={`text-caption ${x.index === day ? 'opacity-80' : 'text-content-muted'}`}>{x.weekday} {x.date.slice(5)} · {x.verify.score}/100</div>
            </button>
          ))}
        </nav>

        <Card className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
          <ScoreRing score={v.score} label="feasibility" />
          <EnergyBar pct={v.energy.pct} sub={`budget ${v.energy.budget} units · set by ${d.limiter}`} />
          <Stat label="Day cost" value={rupees(d.cost)} />
          <Stat label="In transit" value={`${v.travel_share}%`} sub={`${v.travel_min} min`} />
          {d.weather && <Stat label="Weather" value={`${Math.round(d.weather.tmax)}°C · ${d.weather.rain_prob}% rain`} sub={d.weather.source} />}
          {busy && <span className="ml-auto inline-flex items-center gap-2 text-body text-content-muted"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</span>}
        </Card>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section aria-label={`Day ${day + 1} timeline`}>
            <IntelTimeline day={d} onChoose={busy ? undefined : onChoose} onRemove={busy ? undefined : onRemove} onSelect={(b) => setSel(b.id)} selected={sel} />
          </section>
          <aside className="space-y-4 lg:sticky lg:top-[calc(var(--nav-h)+16px)] lg:h-fit">
            <RouteMap capsule={c} day={d} highlight={sel} className="h-[340px]" />
            <Card className="p-5">
              <Eyebrow className="mb-3">Time-Truth checks</Eyebrow>
              <ul className="space-y-2 text-body">
                {v.checks.map((ch, i) => (
                  <li key={i} className="flex gap-2 text-content-secondary">
                    {ch.level === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      : ch.level === 'warn' ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
                    <span>{ch.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <Eyebrow className="mb-1">Edited the day in the planner?</Eyebrow>
              <p className="text-body text-content-muted">Drag, add or remove stops in the planner, then let Tripzy re-time and re-verify the day.</p>
              <Button variant="secondary" className="mt-3 w-full" disabled={!!busy} onClick={recheck}><RefreshCw className="h-4 w-4" />Re-check Day {day + 1} edits</Button>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Eyebrow>Bookings · fixed anchors</Eyebrow>
                <button type="button" className="inline-flex items-center gap-1 text-body font-semibold text-accent-on" onClick={() => setShowBooking(true)}><Ticket className="h-4 w-4" />Add</button>
              </div>
              {c.bookings.length === 0 && <p className="mt-1 text-body text-content-muted">Add your train or flight so the plan protects the connection.</p>}
              {c.bookings.map((b) => (
                <div key={b.id} className="mt-2 flex items-center justify-between text-body">
                  <span className="text-content"><b className="capitalize">{b.kind}</b> · {b.mode} {b.number}</span>
                  <span className="tabular-nums text-content-muted">{b.date.slice(5)} {b.time} · {b.station_id}</span>
                </div>
              ))}
            </Card>
          </aside>
        </div>
      </div>

      <form className="fixed inset-x-0 bottom-0 z-[60] border-t border-edge bg-surface-elevated p-3 backdrop-blur" onSubmit={(e) => (e.preventDefault(), edit.trim() && sendEdit())}>
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <MessageSquare className="h-5 w-5 shrink-0 text-accent-on" />
          <input className="tz-input" value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Tell Tripzy what to change"
            placeholder="Tell Tripzy: “make day 2 lighter”, “my father can't climb”, “add Golconda”, “start later”" />
          <Button type="submit" disabled={!!busy || !edit.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
        </div>
      </form>
      {showBooking && (
        <BookingSheet c={c} tripId={tripId} onClose={() => setShowBooking(false)}
          onSave={(body) => (setShowBooking(false), apply('Anchoring booking', () => engine.booking(c.id, body), 'all', 'Booking anchored; the plan now protects this connection'))} />
      )}
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
      <Companion capsuleId={c.id} tripId={tripId} day={day} onCapsule={setC} />
    </PageShell>
  )
}

function BookingSheet({ c, tripId, onClose, onSave }: { c: Capsule; tripId: number; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [fileMsg, setFileMsg] = useState('')
  const onFile = async (file?: File) => {
    if (!file) return
    setFileMsg('Saving document and reading ticket…')
    try {
      // 1. keep the document privately with the trip (platform files, access-controlled)
      const fd = new FormData()
      fd.append('file', file)
      await filesApi.upload(tripId, fd).catch(() => undefined)
      // 2. extract the booking fields
      const r = await engine.parseTicketFile(file, c.city_key)
      setF((x) => ({ ...x, ...r.fields }))
      setFileMsg(`Read ${Object.keys(r.fields).length} fields from ${file.name}${r.method === 'ocr' ? ' (photo, read on our server with Tesseract OCR)' : ''}. Saved to this trip's documents. Check them below.`)
    } catch (e) {
      setFileMsg((e as Error).message)
    }
  }
  const [f, setF] = useState<Record<string, string>>({ kind: 'arrival', mode: 'train', number: '', date: c.days[0].date, time: '07:30', station_id: c.city.stations[0].id, pnr: '' })
  const [paste, setPaste] = useState('')
  const set = (k: string, val: string) => setF({ ...f, [k]: val })
  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true">
      <div className="tz-rise w-full max-w-md rounded-3xl border border-edge bg-surface-card p-6 shadow-modal">
        <h3 className="text-subtitle font-bold text-content">Add a booking</h3>
        <p className="text-body text-content-muted">Fixed anchors the plan must respect. Paste a ticket confirmation to fill this in.</p>
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-edge p-4 text-body font-semibold text-content-secondary hover:border-[var(--accent)]">
          <Ticket className="h-4 w-4" />Upload ticket (PDF, photo or text)
          <input type="file" accept=".pdf,.txt,.eml,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {fileMsg && <p className="mt-2 text-caption text-content-muted">{fileMsg}</p>}
        <div className="mt-3 text-center text-caption text-content-faint">or paste the confirmation text</div>
        <textarea className="tz-input mt-2 !h-20 py-2" placeholder="PNR: 4521378890 Train No: 12723 … Arr 07:30 HYB" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <Button variant="secondary" className="mt-2 w-full" disabled={!paste.trim()} onClick={async () => setF({ ...f, ...(await engine.parseTicket(paste, c.city_key)) })}>Read ticket text</Button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select className="tz-input" value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="arrival">Arrival</option><option value="departure">Departure</option></select>
          <select className="tz-input" value={f.mode} onChange={(e) => set('mode', e.target.value)}><option value="train">Train</option><option value="flight">Flight</option><option value="bus">Bus</option></select>
          <input className="tz-input" placeholder="Train / flight no." value={f.number} onChange={(e) => set('number', e.target.value)} />
          <select className="tz-input" value={f.station_id} onChange={(e) => set('station_id', e.target.value)}>{c.city.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="tz-input" value={f.date} onChange={(e) => set('date', e.target.value)}>{c.days.map((d) => <option key={d.date} value={d.date}>{d.date}</option>)}</select>
          <input className="tz-input" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
          <input className="tz-input col-span-2" placeholder="PNR / booking reference (optional)" value={f.pnr} onChange={(e) => set('pnr', e.target.value)} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={() => onSave(f)}>Anchor it</Button>
        </div>
      </div>
    </div>
  )
}
