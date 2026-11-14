import React, { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, Check, ExternalLink, Loader2, Luggage, MapPin, Phone, Repeat, Sparkles, Star } from 'lucide-react'
import PageShell from '../../components/Layout/PageShell'
import { filesApi, packingApi } from '../../api/client'
import { engine, mapsLink, rupees } from '../../tripzy/engine'
import type { Finance, Fx, Hotel, HotelResult, Readiness, Recap } from '../../tripzy/engine'
import Companion from '../../tripzy/Companion'
import type { CapsuleX } from '../../tripzy/types'
import { Button, PlaceImage, Skeleton, Toast } from '../../tripzy/ui'
import { CITY_PHOTO, photoSrc } from '../../tripzy/photos'
import { gsap, prefersReducedMotion, useDocumentScroll, useGSAP } from '../../tripzy/motion'

type Tab = 'ready' | 'money' | 'stays' | 'recap'
const TABS: [Tab, string][] = [['ready', 'Readiness'], ['money', 'Money'], ['stays', 'Hotels'], ['recap', 'Memories']]

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
  useDocumentScroll()

  useEffect(() => {
    let off = false
    engine.getLink(tripId).then((l) => engine.capsule(l.capsule_id)).then((x) => !off && setC(x)).catch(() => !off && setErr('This trip has no Tripzy plan yet.'))
    filesApi.list(tripId).then((r: { files?: unknown[] }) => !off && setDocs(r.files?.length ?? 0)).catch(() => undefined)
    return () => { off = true }
  }, [tripId])

  if (err) return <PageShell background="var(--bg-primary)"><div className="mx-auto max-w-md px-4 py-20 text-center text-content-muted">{err} <Link className="text-accent-on underline" to="/plan">Plan one</Link></div></PageShell>
  if (!c) return <PageShell background="var(--bg-primary)"><div className="grid h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-accent-on" /></div></PageShell>
  const cover = CITY_PHOTO[c.city_key] ? photoSrc(CITY_PHOTO[c.city_key]) : null

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-[1280px] px-5 pb-32 pt-8 md:px-10">
        <Link to={`/trips/${tripId}/intel`} className="inline-flex items-center gap-1.5 text-[14px] text-content-muted hover:text-content"><ArrowLeft className="h-4 w-4" />Back to the journey</Link>
        <header className="mt-6 grid items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="tz-chapter">Before you go, and after you're back</div>
            <h1 className="tz-h1 mt-2 text-content">{c.city.name}</h1>
            <p className="mt-2 text-[15px] text-content-muted">{c.days[0].date} → {c.days[c.days.length - 1].date} · {c.travellers.length} traveller{c.travellers.length > 1 ? 's' : ''} · staying in {c.stay.name}</p>
          </div>
          {cover && <img src={cover} alt="" className="hidden h-24 w-40 rounded-2xl object-cover md:block" />}
        </header>
        <nav className="mt-8 flex gap-8 overflow-x-auto border-b border-edge" aria-label="Sections">
          {TABS.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setSp({ tab: v }, { replace: true })} aria-current={tab === v ? 'page' : undefined}
              className={`-mb-px shrink-0 border-b-2 pb-3 font-serif text-[24px] transition ${tab === v ? 'border-[var(--accent)] text-content' : 'border-transparent text-content-muted hover:text-content'}`}>{label}</button>
          ))}
        </nav>
        <div className="mt-10" key={tab}>
          {tab === 'ready' && <ReadyTab c={c} tripId={tripId} docs={docs} onToast={setToast} />}
          {tab === 'money' && <MoneyTab c={c} tripId={tripId} />}
          {tab === 'stays' && <StaysTab c={c} />}
          {tab === 'recap' && <RecapTab c={c} tripId={tripId} />}
        </div>
      </div>
      {toast && <Toast text={toast} onClose={() => setToast('')} />}
      <Companion capsuleId={c.id} tripId={tripId} day={0} onCapsule={setC} city={c.city.name} />
    </PageShell>
  )
}

/** Fade a tab's sections in once it mounts. */
function TabError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="rounded-[28px] border border-dashed border-edge p-10 text-center" role="alert">
      <p className="font-serif text-[24px] text-content">{what} didn't load</p>
      <p className="mx-auto mt-2 max-w-sm text-[14px] text-content-muted">Tripzy couldn't reach its planning service. Your trip is safe; try again in a moment.</p>
      <Button className="mt-5" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function useTabIntro(ref: React.RefObject<HTMLDivElement | null>, ready: boolean) {
  useGSAP(() => {
    if (!ready || !ref.current || prefersReducedMotion()) return
    gsap.fromTo(ref.current.querySelectorAll('[data-in]'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out' })
  }, { scope: ref, dependencies: [ready] })
}

// ---------------------------------------------------------------- readiness: a preparation workspace

function ReadyTab({ c, tripId, docs, onToast }: { c: CapsuleX; tripId: number; docs: number; onToast: (s: string) => void }) {
  const [r, setR] = useState<Readiness | null>(null)
  const [failed, setFailed] = useState(false)
  const [tries, setTries] = useState(0)
  const [adding, setAdding] = useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useTabIntro(ref, !!r)
  useEffect(() => {
    let off = false
    setFailed(false)
    engine.readiness(c.id, docs).then((x) => !off && setR(x)).catch(() => !off && setFailed(true))
    return () => { off = true }
  }, [c.id, docs, tries])
  if (!r) return failed ? <TabError what="Your readiness checklist" onRetry={() => setTries((n) => n + 1)} /> : <Skeleton className="h-96 rounded-[28px]" />
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
  const byCat = r.packing.reduce<Record<string, typeof r.packing>>((a, p) => ((a[p.category] ??= []).push(p), a), {})
  const days = r.countdown_days
  return (
    <div ref={ref} className="grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
      <div>
        <div data-in className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="tz-kicker">Departure</div>
            <div className="mt-1 font-serif text-[88px] leading-[0.85] text-content">{days == null ? '–' : days > 0 ? days : days === 0 ? 'Today' : 'Now'}{days != null && days > 0 && <span className="ms-2 text-[28px] text-content-muted">day{days === 1 ? '' : 's'}</span>}</div>
          </div>
          <div className="min-w-[200px] flex-1 pb-3">
            <div className="flex justify-between text-[13px] text-content-muted"><span>{r.complete} of {r.total} done</span><span>{r.score}% ready</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary"><div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${r.score}%` }} /></div>
          </div>
        </div>
        <ul data-in className="mt-10 border-t border-edge">
          {r.checklist.map((i) => (
            <li key={i.id} className="flex gap-4 border-b border-edge py-5">
              <button disabled={i.auto} onClick={() => tick(i.id, !i.done)} aria-pressed={i.done} aria-label={i.done ? `Mark ${i.title} not done` : `Mark ${i.title} done`}
                className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border transition ${i.done ? 'border-[var(--accent)] bg-accent text-accent-text' : 'border-edge hover:border-[var(--accent)]'} disabled:cursor-default`}>
                {i.done && <Check className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-[17px] ${i.done ? 'text-content-muted line-through decoration-[var(--tz-stone)]' : 'text-content'}`}>{i.title}</div>
                <div className="mt-1 text-[14px] text-content-muted">{i.detail}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  {i.auto && <span className="text-accent-on">Checked automatically</span>}
                  {i.when && <span className="text-content-faint">{i.when}</span>}
                  {i.link && <a href={i.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-content-muted underline underline-offset-2 hover:text-content">Official source<ExternalLink className="h-3 w-3" /></a>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-12">
        <section data-in className="rounded-[28px] bg-[#18211F] p-7 text-[#F7F5EF]">
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6A39B]">The suitcase</div><div className="mt-1 font-serif text-[30px] leading-none">{r.packing.length} things to pack</div></div>
            <Luggage className="h-6 w-6 text-[#D98955]" />
          </div>
          <div className="mt-6 space-y-5">
            {Object.entries(byCat).map(([cat, items]) => (
              <div key={cat}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6A39B]">{cat}</div>
                <ul className="mt-2 space-y-1.5">{items.map((p) => <li key={p.item} className="text-[15px]">{p.item} <span className="text-[13px] text-white/50">· {p.why}</span></li>)}</ul>
              </div>
            ))}
          </div>
          <button type="button" disabled={adding} onClick={addPacking} className="mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F7F5EF] text-[14px] font-semibold text-[#18211F] disabled:opacity-60">{adding ? 'Adding…' : 'Add all to my packing list'}</button>
          <p className="mt-3 text-center text-[12px] text-white/50">Built from your forecast, stops, travellers and bookings.</p>
        </section>

        <section data-in>
          <div className="tz-kicker">City guide</div>
          <h3 className="tz-h3 mt-2 text-content">{r.guide.city}, at a glance</h3>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {r.guide.emergency.map((e) => (
              <a key={e.label} href={`tel:${e.number}`} className="flex items-center gap-2 rounded-2xl border border-edge px-3 py-2.5 text-[13px] text-content-secondary hover:border-[var(--danger)]"><Phone className="h-3.5 w-3.5 text-danger" /><span className="truncate">{e.label}</span><b className="ms-auto text-content">{e.number}</b></a>
            ))}
          </div>
          {r.guide.sections.map((s) => (
            <div key={s.title} className="mt-6 border-t border-edge pt-5">
              <div className="font-serif text-[21px] text-content">{s.title}</div>
              <ul className="mt-2 space-y-1.5 text-[14px] text-content-secondary">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{s.links.map(([n, u]) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent-on underline underline-offset-2">{n}<ExternalLink className="h-3 w-3" /></a>)}</div>
            </div>
          ))}
          <p className="mt-6 text-[12px] text-content-faint">{r.guide.disclaimer} Last reviewed {r.guide.reviewed}.</p>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- money: a calm ledger

const CODES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY']
const CAT_COLOR: Record<string, string> = { stay: '#315C4C', food: '#D98955', tickets: '#7FA392', transport: '#A6A39B' }

function MoneyTab({ c, tripId }: { c: CapsuleX; tripId: number }) {
  const [f, setF] = useState<Finance | null>(null)
  const [failed, setFailed] = useState(false)
  const [tries, setTries] = useState(0)
  const [fx, setFx] = useState<Fx | null>(null)
  const [amt, setAmt] = useState('1000')
  const [code, setCode] = useState('USD')
  const [toInr, setToInr] = useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useTabIntro(ref, !!f)
  useEffect(() => {
    let off = false
    setFailed(false)
    engine.finance(c.id).then((x) => !off && setF(x)).catch(() => !off && setFailed(true))
    engine.fx('INR').then((x) => !off && setFx(x)).catch(() => undefined)
    return () => { off = true }
  }, [c.id, tries])
  if (!f) return failed ? <TabError what="Trip money" onRetry={() => setTries((n) => n + 1)} /> : <Skeleton className="h-96 rounded-[28px]" />
  const rate = fx?.rates?.[code]
  const n = Number(amt) || 0
  const converted = rate ? (toInr ? n / rate : n * rate) : null
  const cats = Object.entries(f.categories) as [string, number][]
  const maxDay = Math.max(1, ...f.by_day.map((d) => Math.max(d.planned, d.spent)))
  return (
    <div ref={ref}>
      <section data-in className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <div className="tz-kicker">The whole trip, before you go</div>
          <div className="mt-3 break-words font-serif text-[56px] leading-none text-content sm:text-[64px] md:text-[88px]">{rupees(f.total)}</div>
          <div className="mt-3 text-[15px] text-content-muted">{rupees(f.per_person)} each for {f.people} traveller{f.people > 1 ? 's' : ''}{Object.keys(f.converted).length ? ` · ≈ ${Object.entries(f.converted).map(([k, v]) => `${k} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' · ')}` : ''}</div>
          <div className="mt-8 flex h-3 overflow-hidden rounded-full" role="img" aria-label="Cost by category">
            {cats.map(([k, v]) => <span key={k} style={{ width: `${(v / Math.max(1, f.total)) * 100}%`, background: CAT_COLOR[k] }} />)}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            {cats.map(([k, v]) => (
              <div key={k}>
                <dt className="flex items-center gap-2 text-[13px] capitalize text-content-muted"><span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[k] }} />{k}</dt>
                <dd className="mt-0.5 text-[17px] font-semibold text-content">{rupees(v)}</dd>
                {k === 'stay' && <dd className="text-[12px] text-content-faint">{f.nights} night{f.nights > 1 ? 's' : ''} × {rupees(f.stay_rate)}</dd>}
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-[28px] border border-edge bg-surface-card p-7">
          <div className="tz-kicker">Convert</div>
          <div className="mt-4 flex gap-2">
            <input className="tz-input !w-auto min-w-0 flex-1 !text-[18px]" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Amount" />
            <select className="tz-input !w-24 shrink-0" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Currency">{CODES.map((x) => <option key={x}>{x}</option>)}</select>
            <Button variant="secondary" onClick={() => setToInr(!toInr)} aria-label="Swap direction"><Repeat className="h-4 w-4" /></Button>
          </div>
          <div className="mt-5 break-words font-serif text-[28px] leading-tight text-content sm:text-[34px]">
            {converted == null ? '—' : toInr ? <>{code} {n.toLocaleString()} <span className="text-content-muted">=</span> {rupees(converted)}</> : <>{rupees(n)} <span className="text-content-muted">=</span> {code} {converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</>}
          </div>
          <p className="mt-2 text-[12px] text-content-faint">{fx?.source ? `${fx.source} · ${fx.date}` : fx?.error ?? 'Loading live rates…'}</p>
        </div>
      </section>

      <section data-in className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2"><div><div className="tz-kicker">Planned and spent</div><h3 className="tz-h3 mt-2 text-content">Day by day</h3></div><div className="text-[13px] text-content-muted">spent <b className="text-content">{rupees(f.spent)}</b> · {f.budget_total ? 'budget' : 'estimate'} left <b className="text-content">{rupees(f.remaining)}</b></div></div>
          <div className="mt-6 space-y-5">
            {f.by_day.map((d) => (
              <div key={d.day} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4">
                <div><div className="font-serif text-[20px] leading-none text-content">Day {d.day + 1}</div><div className="mt-1 text-[11px] text-content-faint">{d.date}</div></div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="h-2 rounded-full bg-[var(--tz-sage)]" style={{ width: `${(d.planned / maxDay) * 100}%` }} /></div><span className="w-[112px] shrink-0 text-[12px] text-content-muted">planned {rupees(d.planned)}</span></div>
                  <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(0.5, (d.spent / maxDay) * 100)}%` }} /></div><span className="w-[112px] shrink-0 text-[12px] text-content-muted">spent {rupees(d.spent)}</span></div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[12px] text-content-faint">{f.note}</p>
        </div>
        <div>
          <div className="tz-kicker">Travelling together</div>
          <h3 className="tz-h3 mt-2 text-content">Split it fairly</h3>
          <p className="mt-3 text-[15px] text-content-muted">Log expenses as you go in Live, then split them between travellers and settle up in the trip budget. It shows who owes whom.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to={`/trips/${tripId}/live`}><Button variant="secondary">Log an expense</Button></Link>
            <Link to={`/trips/${tripId}?tab=finanzplan`}><Button>Split &amp; settle</Button></Link>
          </div>
          {f.expenses.length > 0 && (
            <ul className="mt-6 border-t border-edge">{f.expenses.slice(-5).reverse().map((e, i) => <li key={i} className="flex justify-between border-b border-edge py-3 text-[14px]"><span className="text-content-secondary">{e.label}</span><b className="text-content">{rupees(e.amount)}</b></li>)}</ul>
          )}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- hotels: a comparison with photographs and location

const km = (a: [number, number], b: [number, number]) => {
  const R = 6371, r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function StaysTab({ c }: { c: CapsuleX }) {
  const [h, setH] = useState<HotelResult | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)
  useTabIntro(ref, !!h)
  useEffect(() => {
    let off = false
    engine.hotels(c.id).then((x) => !off && setH(x)).catch((e) => !off && setH({ configured: true, items: [], error: (e as Error).message }))
    return () => { off = true }
  }, [c.id])
  const base: [number, number] = [c.stay.lat, c.stay.lon]
  const fit = (x: Hotel) => (x.lat && x.lon ? km(base, [x.lat, x.lon]) : null)
  const cheapest = h?.items.length ? Math.min(...h.items.map((x) => x.total)) : 0
  return (
    <div ref={ref}>
      <section data-in className="grid grid-cols-1 items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="tz-kicker">Tripzy's stay pick</div>
          <h3 className="tz-h2 mt-2 text-content">{c.stay.name}</h3>
          <p className="mt-2 max-w-xl text-[15px] text-content-muted">{c.stay.tradeoff}. About {c.stay.avg_minutes} minutes to your stops, typically {c.stay.price}.</p>
        </div>
        {h?.sandbox && <span className="w-fit rounded-full bg-warning-soft px-3 py-1.5 text-[12px] font-medium text-warning">Sandbox · test prices, not bookable</span>}
      </section>
      {!h && <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-[22px]" />)}</div>}
      {h && !h.items.length && <p className="mt-10 rounded-[22px] border border-dashed border-edge p-8 text-[15px] text-content-muted">{h.detail ?? h.error ?? 'No rooms returned for these dates.'}</p>}
      {h && h.items.length > 0 && (
        <div className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {h.items.map((x) => {
            const d = fit(x)
            return (
              <article data-in key={x.id} className="group">
                <div className="relative overflow-hidden rounded-[22px] bg-surface-tertiary">
                  {x.photo ? <img src={x.photo} alt={x.name} loading="lazy" className="aspect-[4/3] w-full object-cover transition duration-700 group-hover:scale-[1.03]" /> : <div className="aspect-[4/3]" />}
                  {x.total === cheapest && <span className="absolute start-3 top-3 rounded-full bg-[#F7F5EF] px-2.5 py-1 text-[11px] font-semibold text-[#18211F]">Lowest price</span>}
                </div>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <h4 className="font-serif text-[22px] leading-tight text-content">{x.name}</h4>
                  <div className="shrink-0 text-end"><div className="text-[18px] font-semibold text-content">{rupees(x.total)}</div><div className="text-[11px] text-content-faint">total stay</div></div>
                </div>
                <div className="mt-1 text-[13px] text-content-muted">{x.stars ? `${x.stars}★` : ''}{x.rating ? <> · <Star className="inline h-3 w-3" /> {x.rating}/10{x.reviews ? ` (${x.reviews})` : ''}</> : ''}{x.room ? ` · ${x.room}` : ''}</div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                  {d !== null && <a href={mapsLink(x.lat, x.lon, x.name)} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 ${d <= 2 ? 'text-success' : d <= 5 ? 'text-content-secondary' : 'text-warning'}`}><MapPin className="h-3.5 w-3.5" />{d.toFixed(1)} km from {c.stay.name}</a>}
                  <span className={x.refundable ? 'text-success' : 'text-content-muted'}>{x.refundable ? 'Free cancellation' : 'Non-refundable'}</span>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {h?.source && <p className="mt-10 text-[12px] text-content-faint">{h.source} · {h.checkin} → {h.checkout} · prices are totals for the stay. Tripzy never shows invented prices.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- memories: an editorial travel journal

function RecapTab({ c, tripId }: { c: CapsuleX; tripId: number }) {
  const [r, setR] = useState<Recap | null>(null)
  const [failed, setFailed] = useState(false)
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useTabIntro(ref, !!r)
  useEffect(() => {
    let off = false
    setFailed(false)
    engine.recap(c.id).then((x) => !off && setR(x)).catch(() => !off && setFailed(true))
    return () => { off = true }
  }, [c.id, tries])
  if (!r) return failed ? <TabError what="Your trip journal" onRetry={() => setTries((n) => n + 1)} /> : <Skeleton className="h-96 rounded-[28px]" />
  const story = async () => {
    setBusy(true)
    try { setR(await engine.recap(c.id, true)) } finally { setBusy(false) }
  }
  const [lead, ...rest] = r.highlights
  return (
    <div ref={ref}>
      <section data-in className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
        {lead && <div className="overflow-hidden rounded-[28px]"><PlaceImage id={lead.place_id} cat={lead.cat} alt={lead.name} className="aspect-[16/10] w-full" /></div>}
        <div>
          <div className="tz-chapter">A journal of {r.city}</div>
          <p className="mt-3 font-serif text-[34px] leading-[1.15] text-content">{r.days} days, {r.stops} places, {r.km} km of road and {r.meals} meals.</p>
          <p className="mt-3 text-[14px] text-content-muted">{Math.round((r.travel_min / 60) * 10) / 10} hours on the move · {rupees(r.spent)} spent{r.loved.length ? ` · you loved ${r.loved.join(', ')}` : ''}</p>
        </div>
      </section>

      <section data-in className="mt-14 border-y border-edge py-10">
        {r.story ? (
          <figure className="mx-auto max-w-3xl">
            <blockquote className="font-serif text-[26px] italic leading-[1.45] text-content md:text-[32px]">“{r.story}”</blockquote>
            <figcaption className="mt-4 text-[12px] text-content-faint">Written by Gemini from your trip's facts only</figcaption>
          </figure>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="font-serif text-[26px] italic text-content-muted">Every journey has a story. Want Tripzy to write yours?</p>
            <Button variant="coral" className="mt-5" disabled={busy} onClick={story}><Sparkles className="h-4 w-4" />{busy ? 'Writing… (about 30 seconds)' : 'Write my trip story'}</Button>
            {r.story === null && r.story_source === null && <p className="mt-3 text-[12px] text-content-faint">Story writing needs the optional free Gemini key.</p>}
          </div>
        )}
      </section>

      {rest.length > 0 && (
        <section data-in className="mt-14 columns-2 gap-4 md:columns-3 [&>figure]:mb-4">
          {rest.map((h, i) => (
            <figure key={h.name + h.day} className="break-inside-avoid">
              <div className="overflow-hidden rounded-[20px]"><PlaceImage id={h.place_id} cat={h.cat} alt={h.name} className={`${i % 3 === 0 ? 'aspect-[3/4]' : i % 3 === 1 ? 'aspect-square' : 'aspect-[4/3]'} w-full`} /></div>
              <figcaption className="mt-2 flex items-baseline justify-between gap-2"><span className="font-serif text-[18px] text-content">{h.name}</span><span className="shrink-0 text-[11px] text-content-faint">Day {h.day + 1} · {h.start}{r.loved.includes(h.name) ? ' · ♥' : ''}</span></figcaption>
            </figure>
          ))}
        </section>
      )}

      {(r.adaptations.length > 0 || r.learned.length > 0) && (
        <section data-in className="mt-14 grid grid-cols-1 gap-12 md:grid-cols-2">
          {r.adaptations.length > 0 && (
            <div>
              <div className="tz-kicker">When plans changed</div>
              <ol className="mt-4 border-s border-edge ps-6">{r.adaptations.map((a, i) => <li key={i} className="relative pb-5 text-[15px] text-content-secondary"><span className="absolute -start-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--tz-sun)]" />Day {a.day + 1}: {a.headline}</li>)}</ol>
            </div>
          )}
          {r.learned.length > 0 && (
            <div>
              <div className="tz-kicker">What Tripzy learned about you</div>
              <ul className="mt-4 space-y-2">{r.learned.map((x) => <li key={x} className="font-serif text-[20px] text-content">{x}</li>)}</ul>
            </div>
          )}
        </section>
      )}
      <Link to="/journey" className="tz-link mt-14 inline-block text-[14px] font-semibold text-accent-on">Add your own photos and notes in the journal (trip {tripId})</Link>
    </div>
  )
}
