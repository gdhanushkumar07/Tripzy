import React, { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, BedDouble, Check, CheckCircle2, Circle, ExternalLink, Heart, Loader2, Luggage, Phone, Repeat, ShieldCheck, Sparkles, Star, Wallet } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { filesApi, packingApi } from '../../api/client'
import { engine, rupees } from '../../tripzy/engine'
import type { Finance, Fx, HotelResult, Readiness, Recap } from '../../tripzy/engine'
import Companion from '../../tripzy/Companion'
import type { CapsuleX } from '../../tripzy/types'
import { Button, Card, Eyebrow, Pill, PlaceImage, ScoreRing, Segmented, Skeleton, Stat, Toast } from '../../tripzy/ui'

type Tab = 'ready' | 'money' | 'stays' | 'recap'

/** Travel Readiness Centre, trip money, hotel comparison and memories for one trip. */
export default function TripReadyPage(): React.ReactElement {
  const { id = '' } = useParams()
  const tripId = Number(id)
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'ready'
  const [c, setC] = useState<CapsuleX | null>(null)
  const [err, setErr] = useState('')
  const [docs, setDocs] = useState(0)
  const [toast, setToast] = useState('')

  useEffect(() => {
    let off = false
    engine.getLink(tripId).then((l) => engine.capsule(l.capsule_id)).then((x) => !off && setC(x)).catch(() => !off && setErr('This trip has no Tripzy plan yet.'))
    filesApi.list(tripId).then((r: { files?: unknown[] }) => !off && setDocs(r.files?.length ?? 0)).catch(() => undefined)
    return () => { off = true }
  }, [tripId])

  if (err) return <PageShell background="var(--bg-primary)"><div className="mx-auto max-w-md px-4 py-20 text-center text-content-muted">{err} <Link className="text-accent-on underline" to="/plan">Plan one</Link></div></PageShell>
  if (!c) return <PageShell background="var(--bg-primary)"><div className="grid h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-accent-on" /></div></PageShell>

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-5xl px-4 pb-32 pt-5">
        <Link to={`/trips/${tripId}/intel`} className="inline-flex items-center gap-1.5 text-body text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Trip Intelligence</Link>
        <h1 className="mt-2 text-[28px] font-bold leading-tight text-content">{c.city.name} · get ready</h1>
        <p className="text-body text-content-muted">{c.days[0].date} → {c.days[c.days.length - 1].date} · {c.travellers.length} traveller{c.travellers.length > 1 ? 's' : ''}</p>
        <div className="mt-4 overflow-x-auto">
          <Segmented<Tab> value={tab} onChange={(v) => setSp({ tab: v }, { replace: true })} options={[
            { value: 'ready', label: <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" />Readiness</span> },
            { value: 'money', label: <span className="inline-flex items-center gap-1.5"><Wallet className="h-4 w-4" />Money</span> },
            { value: 'stays', label: <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4" />Hotels</span> },
            { value: 'recap', label: <span className="inline-flex items-center gap-1.5"><Heart className="h-4 w-4" />Memories</span> },
          ]} />
        </div>
        <div className="mt-5">
          {tab === 'ready' && <ReadyTab c={c} tripId={tripId} docs={docs} onToast={setToast} />}
          {tab === 'money' && <MoneyTab c={c} tripId={tripId} />}
          {tab === 'stays' && <StaysTab c={c} />}
          {tab === 'recap' && <RecapTab c={c} tripId={tripId} />}
        </div>
      </div>
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
      <Companion capsuleId={c.id} tripId={tripId} day={0} onCapsule={setC} />
    </PageShell>
  )
}

function ReadyTab({ c, tripId, docs, onToast }: { c: CapsuleX; tripId: number; docs: number; onToast: (s: string) => void }) {
  const [r, setR] = useState<Readiness | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let off = false
    engine.readiness(c.id, docs).then((x) => !off && setR(x)).catch((e) => onToast((e as Error).message))
    return () => { off = true }
  }, [c.id, docs, onToast])
  if (!r) return <Skeleton className="h-64" />
  const tick = async (item: string, done: boolean) => setR(await engine.tick(c.id, item, done, docs))
  const addPacking = async () => {
    setAdding(true)
    try {
      await packingApi.bulkImport(tripId, r.packing.map((p) => ({ name: p.item, category: p.category })))
      onToast(`Added ${r.packing.length} items to this trip's packing list`)
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setAdding(false)
    }
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <ScoreRing score={r.score} label="ready" />
          <div>
            <div className="text-subtitle font-bold text-content">{r.complete} of {r.total} done</div>
            <div className="text-body text-content-muted">{r.countdown_days == null ? '' : r.countdown_days > 0 ? `${r.countdown_days} days to go` : r.countdown_days === 0 ? 'You leave today' : 'Trip has started'}</div>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {r.checklist.map((i) => (
            <li key={i.id} className="flex gap-3 rounded-xl border border-edge p-3">
              <button disabled={i.auto} onClick={() => tick(i.id, !i.done)} aria-label={i.done ? 'Mark not done' : 'Mark done'} className="mt-0.5 shrink-0 disabled:cursor-default">
                {i.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-content-faint" />}
              </button>
              <div className="min-w-0">
                <div className={`text-body font-semibold ${i.done ? 'text-content-muted line-through' : 'text-content'}`}>{i.title}</div>
                <div className="text-caption text-content-muted">{i.detail}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {i.auto && <Pill tone="accent">checked automatically</Pill>}
                  {i.when && <Pill>{i.when}</Pill>}
                  {i.link && <a href={i.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption text-accent-on underline">Official source<ExternalLink className="h-3 w-3" /></a>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Smart packing list</Eyebrow>
            <Button variant="secondary" disabled={adding} onClick={addPacking}><Luggage className="h-4 w-4" />{adding ? 'Adding…' : 'Add to packing list'}</Button>
          </div>
          <ul className="mt-3 space-y-1.5">
            {r.packing.map((p) => (
              <li key={p.item} className="flex items-start gap-2 text-body"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-on" /><span><b className="text-content">{p.item}</b> <span className="text-content-muted">· {p.why}</span></span></li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-content-faint">Built from your forecast, stops, travellers and bookings.</p>
        </Card>

        <Card className="p-5">
          <Eyebrow>{r.guide.city} guide</Eyebrow>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {r.guide.emergency.map((e) => (
              <a key={e.label} href={`tel:${e.number}`} className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-2.5 py-2 text-caption text-danger"><Phone className="h-3.5 w-3.5" /><span className="truncate">{e.label}</span><b className="ml-auto">{e.number}</b></a>
            ))}
          </div>
          {r.guide.sections.map((s) => (
            <div key={s.title} className="mt-4">
              <div className="text-body font-semibold text-content">{s.title}</div>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-body text-content-secondary">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{s.links.map(([n, u]) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption text-accent-on underline">{n}<ExternalLink className="h-3 w-3" /></a>)}</div>
            </div>
          ))}
          <p className="mt-4 rounded-xl bg-surface-secondary p-3 text-caption text-content-muted">{r.guide.disclaimer} Last reviewed {r.guide.reviewed}.</p>
        </Card>
      </div>
    </div>
  )
}

const CODES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY']

function MoneyTab({ c, tripId }: { c: CapsuleX; tripId: number }) {
  const [f, setF] = useState<Finance | null>(null)
  const [fx, setFx] = useState<Fx | null>(null)
  const [amt, setAmt] = useState('1000')
  const [code, setCode] = useState('USD')
  const [toInr, setToInr] = useState(false)
  useEffect(() => {
    let off = false
    engine.finance(c.id).then((x) => !off && setF(x)).catch(() => undefined)
    engine.fx('INR').then((x) => !off && setFx(x)).catch(() => undefined)
    return () => { off = true }
  }, [c.id])
  if (!f) return <Skeleton className="h-64" />
  const rate = fx?.rates?.[code]
  const n = Number(amt) || 0
  const converted = rate ? (toInr ? n / rate : n * rate) : null
  const max = Math.max(1, ...Object.values(f.categories))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="p-5">
        <Eyebrow>Full trip cost (estimate)</Eyebrow>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total" value={rupees(f.total)} />
          <Stat label="Per person" value={rupees(f.per_person)} sub={`${f.people} traveller${f.people > 1 ? 's' : ''}`} />
          <Stat label="Spent" value={rupees(f.spent)} />
          <Stat label={f.budget_total ? 'Budget left' : 'Left of estimate'} value={rupees(f.remaining)} />
        </div>
        <div className="mt-5 space-y-2.5">
          {(Object.entries(f.categories) as [string, number][]).map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between text-body"><span className="capitalize text-content">{k}{k === 'stay' ? ` · ${f.nights} night${f.nights > 1 ? 's' : ''} × ${rupees(f.stay_rate)}` : ''}</span><b className="text-content">{rupees(v)}</b></div>
              <div className="mt-1 h-2 rounded-full bg-surface-secondary"><div className="h-2 rounded-full bg-accent" style={{ width: `${(v / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        {Object.keys(f.converted).length > 0 && (
          <p className="mt-4 text-body text-content-muted">≈ {Object.entries(f.converted).map(([k, v]) => `${k} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' · ')} <span className="text-caption text-content-faint">({f.fx.source}, {f.fx.date})</span></p>
        )}
        <div className="mt-5">
          <Eyebrow>By day</Eyebrow>
          <div className="mt-2 space-y-1.5">
            {f.by_day.map((d) => (
              <div key={d.day} className="flex justify-between rounded-xl bg-surface-secondary px-3 py-2 text-body"><span className="text-content">Day {d.day + 1} · {d.date}</span><span className="text-content-muted">planned <b className="text-content">{rupees(d.planned)}</b> · spent <b className="text-content">{rupees(d.spent)}</b></span></div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-caption text-content-faint">{f.note}</p>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <Eyebrow>Currency converter</Eyebrow>
          <div className="mt-3 flex gap-2">
            <input className="tz-input !w-auto min-w-0 flex-1" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Amount" />
            <select className="tz-input !w-24 shrink-0" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Currency">{CODES.map((x) => <option key={x}>{x}</option>)}</select>
            <Button variant="secondary" onClick={() => setToInr(!toInr)} aria-label="Swap direction"><Repeat className="h-4 w-4" /></Button>
          </div>
          <div className="mt-3 text-[26px] font-bold text-content">
            {converted == null ? '—' : toInr ? `${code} ${n.toLocaleString()} = ${rupees(converted)}` : `${rupees(n)} = ${code} ${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          </div>
          <p className="mt-1 text-caption text-content-faint">{fx?.source ? `${fx.source} · ${fx.date}` : fx?.error ?? 'Loading live rates…'}</p>
        </Card>
        <Card className="p-5">
          <Eyebrow>Group expenses</Eyebrow>
          <p className="mt-1 text-body text-content-muted">Log expenses in Live, then split them between travellers and settle up in the trip budget. It shows who owes whom.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/trips/${tripId}/live`}><Button variant="secondary">Log an expense</Button></Link>
            <Link to={`/trips/${tripId}?tab=finanzplan`}><Button>Split &amp; settle</Button></Link>
          </div>
          {f.expenses.length > 0 && (
            <ul className="mt-3 space-y-1 text-body">{f.expenses.slice(-5).reverse().map((e, i) => <li key={i} className="flex justify-between"><span className="text-content-secondary">{e.label}</span><b className="text-content">{rupees(e.amount)}</b></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function StaysTab({ c }: { c: CapsuleX }) {
  const [h, setH] = useState<HotelResult | null>(null)
  useEffect(() => {
    let off = false
    engine.hotels(c.id).then((x) => !off && setH(x)).catch((e) => !off && setH({ configured: true, items: [], error: (e as Error).message }))
    return () => { off = true }
  }, [c.id])
  return (
    <div>
      <Card className="p-5">
        <Eyebrow>Tripzy's stay pick</Eyebrow>
        <div className="mt-1 text-subtitle font-bold text-content">{c.stay.name}</div>
        <p className="text-body text-content-muted">{c.stay.tradeoff} · about {c.stay.avg_minutes} min to your stops · typical {c.stay.price}</p>
      </Card>
      <div className="mt-4 flex items-center justify-between">
        <Eyebrow>Hotels near {c.stay.name}</Eyebrow>
        {h?.sandbox && <Pill tone="warning">Sandbox · test prices, not bookable</Pill>}
      </div>
      {!h && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
      {h && !h.items.length && <Card className="mt-3 p-5 text-body text-content-muted">{h.detail ?? h.error ?? 'No rooms returned for these dates.'}</Card>}
      {h && h.items.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {h.items.map((x) => (
            <Card key={x.id} className="flex gap-3 overflow-hidden p-3">
              {x.photo ? <img src={x.photo} alt="" loading="lazy" className="h-24 w-28 shrink-0 rounded-xl object-cover" /> : <div className="h-24 w-28 shrink-0 rounded-xl bg-surface-secondary" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-bold text-content">{x.name}</div>
                <div className="text-caption text-content-muted">{x.stars ? `${x.stars}★` : ''}{x.rating ? <> · <Star className="inline h-3 w-3" /> {x.rating}/10{x.reviews ? ` (${x.reviews})` : ''}</> : ''}</div>
                <div className="truncate text-caption text-content-muted">{x.room}{x.board ? ` · ${x.board}` : ''}</div>
                <div className="mt-1 flex items-center justify-between">
                  <b className="text-content">{rupees(x.total)}</b>
                  <Pill tone={x.refundable ? 'success' : 'neutral'}>{x.refundable ? 'Free cancellation' : 'Non-refundable'}</Pill>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {h?.source && <p className="mt-3 text-caption text-content-faint">{h.source} · {h.checkin} → {h.checkout} · total for the stay. Tripzy never shows invented prices.</p>}
    </div>
  )
}

function RecapTab({ c, tripId }: { c: CapsuleX; tripId: number }) {
  const [r, setR] = useState<Recap | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let off = false
    engine.recap(c.id).then((x) => !off && setR(x)).catch(() => undefined)
    return () => { off = true }
  }, [c.id])
  if (!r) return <Skeleton className="h-64" />
  const story = async () => {
    setBusy(true)
    try { setR(await engine.recap(c.id, true)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <Eyebrow className="tz-coral-text">Trip memories</Eyebrow>
        <h2 className="mt-1 text-title font-bold text-content">{r.city}, {r.days} days</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Places" value={r.stops} />
          <Stat label="Meals" value={r.meals} />
          <Stat label="Travelled" value={`${r.km} km`} sub={`${Math.round(r.travel_min / 60 * 10) / 10} h on the road`} />
          <Stat label="Spent" value={rupees(r.spent)} />
        </div>
        {r.story ? (
          <p className="mt-4 rounded-2xl bg-surface-secondary p-4 text-body leading-relaxed text-content">{r.story}<span className="mt-2 block text-caption text-content-faint">Written by Gemini from your trip facts only</span></p>
        ) : (
          <Button variant="coral" className="mt-4" disabled={busy} onClick={story}><Sparkles className="h-4 w-4" />{busy ? 'Writing…' : 'Write my trip story'}</Button>
        )}
        {r.story === null && r.story_source === null && <p className="mt-2 text-caption text-content-faint">Story writing needs the optional free Gemini key.</p>}
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {r.highlights.map((h) => (
          <Card key={h.name + h.day} className="overflow-hidden">
            <PlaceImage id={h.place_id} alt={h.name} className="h-28 w-full" />
            <div className="p-2.5"><div className="truncate text-body font-semibold text-content">{h.name}</div><div className="text-caption text-content-muted">Day {h.day + 1} · {h.start}{r.loved.includes(h.name) ? ' · ❤️ loved' : ''}</div></div>
          </Card>
        ))}
      </div>
      {(r.adaptations.length > 0 || r.learned.length > 0) && (
        <Card className="p-5">
          {r.adaptations.length > 0 && <><Eyebrow>How Tripzy adapted</Eyebrow><ul className="mt-2 space-y-1 text-body text-content-secondary">{r.adaptations.map((a, i) => <li key={i}>Day {a.day + 1}: {a.headline}</li>)}</ul></>}
          {r.learned.length > 0 && <><Eyebrow className="mt-4">What Tripzy learned about you</Eyebrow><div className="mt-2 flex flex-wrap gap-1.5">{r.learned.map((x) => <Pill key={x} tone="accent">{x}</Pill>)}</div></>}
        </Card>
      )}
      <Link to="/journey" className="inline-flex items-center gap-1.5 text-body text-accent-on underline">Add photos and notes in your journal (trip {tripId})</Link>
    </div>
  )
}
