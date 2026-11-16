/**
 * Long-distance and international journeys: the 2–3 questions, the four tagged options
 * (Fastest, Cheapest, Most comfortable, Best balanced), door-to-door legs with prefilled
 * booking links, a booking helper for trains, places to stay, and "missed it? replan".
 */
import { BedDouble, Check, Copy, ExternalLink, LocateFixed, Minus, Navigation, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, type GeoPoint } from '../lib/api'
import { currentPosition } from '../lib/location'
import { ErrorBox, Skeleton, useAction } from '../lib/status'
import type { Family, Priority } from '../lib/types'
import { popupHtml, type MapLayer } from '../ui/LiveMap'
import { fmtDur } from './engine'
import { MapView } from './RouteView'

export type Link = { label: string; url: string }
export type JLeg = {
  mode: string; name: string; from: string; to: string; fromLL: [number, number]; toLL: [number, number]
  start: number; minutes: number; wait?: number; km: number; cost: number; source: string; estimate: boolean; realtime?: boolean
  links: Link[]; geometry?: [number, number][]; note?: string
}
export type Tag = 'Fastest' | 'Cheapest' | 'Most comfortable' | 'Best balanced'
export type JOption = {
  id: string; title: string; kind: string; legs: JLeg[]; minutes: number; cost: number; perPerson: number; transfers: number
  walkKm: number; waitMin: number; comfort: number; reliability: number; notes: string[]; tags: Tag[]; why: string; estimate: boolean; gmaps: string
  badges?: string[]
}
export type JourneyResult = { options: JOption[]; sources: string[]; km: number; start: string; timeZone?: string; message?: string }
export type JourneyAsk = { party: Family; luggage: 'light' | 'heavy'; priority: Priority; own: 'none' | 'car' | 'scooter'; flights?: boolean }

const ICON: Record<string, string> = {
  flight: '✈️', train: '🚆', rail: '🚈', metro: '🚇', citybus: '🚌', ibus: '🚍', coach: '🚍', ferry: '⛴️', cab: '🚕', suv: '🚙', owncar: '🚗', ownscooter: '🛵',
  auto: '🛺', erick: '🛵', bike: '🏍️', cycle: '🚲', walk: '🚶', transit: '🚉',
}
const COLOR: Record<string, string> = {
  flight: '#0ea5e9', train: '#18211f', rail: '#0e7490', metro: '#2563eb', citybus: '#dc2626', ibus: '#315c4c', coach: '#315c4c', ferry: '#0891b2',
  cab: '#7c3aed', suv: '#6d28d9', owncar: '#1d4ed8', ownscooter: '#c2410c', auto: '#ca8a04', bike: '#ea580c', walk: '#6c706a',
}
const TAG_STYLE: Record<Tag, string> = {
  Fastest: 'bg-[#dbeafe] text-[#1e3a8a]', Cheapest: 'bg-[#dcfce7] text-[#14532d]', 'Most comfortable': 'bg-[#f3e8ff] text-[#581c87]', 'Best balanced': 'bg-accent text-accent-text',
}
const PUBLIC = new Set(['metro', 'citybus', 'rail', 'train', 'ibus', 'coach', 'ferry', 'transit'])
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
/** Clock time at the origin's time zone (a journey abroad shows local times, not the phone's). */
const clockAt = (startIso: string, zone: string | undefined, plusMin: number) => {
  const d = new Date(new Date(startIso).getTime() + plusMin * 60000)
  try { return d.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, day: 'numeric', month: 'short', timeZone: zone }) } catch { return d.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, day: 'numeric', month: 'short' }) }
}

/** The 2–3 questions a long journey needs (prefilled from the saved profile). */
export function JourneyQuestions({ value, onChange, hasCar, hasScooter }: { value: JourneyAsk; onChange: (v: JourneyAsk) => void; hasCar: boolean; hasScooter: boolean }) {
  const p = value.party
  const step = (k: keyof Family, d: number, min: number) => onChange({ ...value, party: { ...p, [k]: Math.max(min, Math.min(9, p[k] + d)) } })
  const stepper = (k: keyof Family, label: string, min: number) => (
    <div className="flex items-center gap-1.5">
      <button type="button" className="btn-secondary btn-sm !h-9 !w-9 !p-0" aria-label={`Fewer ${label}`} onClick={() => step(k, -1, min)}><Minus className="h-3.5 w-3.5" /></button>
      <span className="min-w-[6.5rem] text-center text-body" aria-live="polite"><strong>{p[k]}</strong> {label}</span>
      <button type="button" className="btn-secondary btn-sm !h-9 !w-9 !p-0" aria-label={`More ${label}`} onClick={() => step(k, 1, 0)}><Plus className="h-3.5 w-3.5" /></button>
    </div>
  )
  const choice = <T extends string>(v: T, set: (x: T) => void, opts: [T, string][]) => (
    <div className="flex flex-wrap gap-2">{opts.map(([k, l]) => <button type="button" key={k} aria-pressed={v === k} className={`chip ${v === k ? 'chip-on' : 'chip-off'}`} onClick={() => set(k)}>{l}</button>)}</div>
  )
  return (
    <div className="grid gap-5 rounded-2xl bg-surface-secondary p-4 md:grid-cols-3">
      <div>
        <span className="label">1 · Who is travelling?</span>
        <div className="space-y-1.5">{stepper('adults', 'adults', 0)}{stepper('children', 'children', 0)}{stepper('seniors', 'seniors', 0)}</div>
      </div>
      <div>
        <span className="label">2 · What matters most?</span>
        {choice(value.priority, (priority) => onChange({ ...value, priority }), [['balanced', 'Best balance'], ['fastest', 'Time'], ['cheapest', 'Money'], ['comfort', 'Comfort']])}
        <span className="label mt-3">Luggage</span>
        {choice(value.luggage, (luggage) => onChange({ ...value, luggage }), [['light', 'Light bags'], ['heavy', 'Heavy / many bags']])}
      </div>
      <div>
        <span className="label">3 · Take your own vehicle?</span>
        {choice(value.own, (own) => onChange({ ...value, own }), [['none', 'No'], ['car', hasCar ? 'My car' : 'A car'], ['scooter', hasScooter ? 'My scooter' : 'A scooter']])}
        <p className="mt-2 text-caption text-content-faint">{hasCar || hasScooter ? 'Fuel cost uses the mileage saved in your profile.' : 'Save your vehicle’s mileage in your dashboard for exact fuel costs.'}</p>
        <span className="label mt-3">Flights</span>
        {choice(value.flights === false ? 'no' : 'yes', (v) => onChange({ ...value, flights: v === 'yes' }), [['yes', '✈️ Flights are fine'], ['no', 'No flights']])}
      </div>
    </div>
  )
}

function layersFor(o: JOption): MapLayer[] {
  const lines: MapLayer[] = o.legs.map((l) => ({ line: l.geometry?.length ? l.geometry : [l.fromLL, l.toLL], color: COLOR[l.mode] ?? '#315c4c', dashed: l.mode === 'walk' || l.mode === 'flight' }))
  const first = o.legs[0], last = o.legs[o.legs.length - 1]
  const points = [
    { lat: first.fromLL[0], lon: first.fromLL[1], n: 'A', color: '#18211f', popup: popupHtml(first.from, ['Start']) },
    ...o.legs.slice(1).map((l, i) => ({ lat: l.fromLL[0], lon: l.fromLL[1], n: String(i + 1), color: COLOR[l.mode] ?? '#315c4c', popup: popupHtml(l.from, [`Change to ${l.name}`], { href: `https://www.google.com/maps/search/?api=1&query=${l.fromLL.join(',')}`, text: 'Google Maps' }) })),
    { lat: last.toLL[0], lon: last.toLL[1], n: 'B', color: '#18211f', popup: popupHtml(last.to, ['Destination']) },
  ]
  return [...lines, { points }]
}

function TrainHelper({ party }: { party: Family }) {
  const [copied, setCopied] = useState(false)
  const text = `Passengers: ${party.adults} adult${party.adults === 1 ? '' : 's'}${party.seniors ? `, ${party.seniors} senior citizen${party.seniors === 1 ? '' : 's'} (concession / lower berth)` : ''}${party.children ? `, ${party.children} child${party.children === 1 ? '' : 'ren'} (age 5–11 half ticket; under 5 free without berth)` : ''}. Class: 3A for overnight comfort, SL for the lowest fare.`
  return (
    <div className="mt-2 rounded-xl bg-accent-subtle p-3 text-caption text-content-secondary">
      <p><strong>Booking helper:</strong> ixigo and ConfirmTkt (authorised IRCTC partners) open with stations and date filled in — pick the train, sign in with your IRCTC ID and you are on the final passenger/payment page. IRCTC itself does not accept prefilled links from other sites.</p>
      <p className="mt-1">{text}</p>
      <button type="button" className="btn-link mt-1 inline-flex items-center gap-1" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)) }}>{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? 'Copied' : 'Copy passenger details'}</button>
    </div>
  )
}

export function OptionCard({ o, start, zone, open, onToggle, party, extraTags, advice }: { o: JOption; start: string; zone?: string; open: boolean; onToggle: () => void; party: Family; extraTags?: string[]; advice?: string }) {
  return (
    <article className={`card ${o.tags.includes('Best balanced') ? 'ring-2 ring-[var(--accent)]' : ''}`}>
      <button type="button" className="w-full text-left" onClick={onToggle} aria-expanded={open}>
        <div className="mb-2 flex flex-wrap gap-1">
          {o.tags.map((t) => <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-bold ${TAG_STYLE[t]}`}>{t}</span>)}
          {o.badges?.map((b) => <span key={b} className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-xs font-bold text-[#1e3a8a]">{b}</span>)}
          {extraTags?.map((b) => <span key={b} className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-text">{b}</span>)}
          {o.estimate && <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-content-muted">includes estimates</span>}
        </div>
        <p className="font-serif text-[26px] leading-tight text-content">{o.title}</p>
        {advice && <p className="mt-1 text-body text-content-secondary">{advice}</p>}
        <p className="mt-1 text-lg" aria-label={o.legs.map((l) => l.mode).join(', then ')}>{o.legs.map((l, i) => <span key={i} title={l.name}>{ICON[l.mode] ?? '•'}{i < o.legs.length - 1 && <span className="mx-0.5 text-xs text-content-faint">›</span>}</span>)}</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-body">
          <span><strong className="text-content">{fmtDur(o.minutes)}</strong> <span className="text-content-muted">door to door</span></span>
          <span><strong className="text-content">{rupees(o.cost)}</strong> <span className="text-content-muted">total · {rupees(o.perPerson)}/person</span></span>
          <span className="text-content-muted">arrive {clockAt(start, zone, o.minutes)}</span>
        </div>
        <p className="mt-2 flex gap-1.5 text-[15px] text-content-secondary"><Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--tz-sun)]" />{o.why} · reliability {Math.round(o.reliability * 100)}%</p>
        <p className="mt-2 text-xs font-semibold text-content-muted">{open ? 'Hide details ▲' : 'Show legs, map and booking ▼'}</p>
      </button>
      {open && (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <ol className="space-y-3">
              {o.legs.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg" style={{ background: `color-mix(in srgb, ${COLOR[l.mode] ?? '#315c4c'} 16%, transparent)` }} aria-hidden>{ICON[l.mode] ?? '•'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-content">{clockAt(start, zone, l.start)} · {l.name}</p>
                    <p className="text-body text-content-muted">{l.from} → {l.to} · {fmtDur(l.minutes)}{l.km ? ` · ${l.km} km` : ''}{l.cost ? ` · ${rupees(l.cost)}${l.estimate ? ' est.' : ''}` : ''}{l.wait && l.wait >= 2 && PUBLIC.has(l.mode) ? ` · next one in ${l.wait} min` : ''}{l.realtime ? ' · live' : ''}</p>
                    {l.note && <p className="mt-1 rounded-lg bg-warning-soft px-2 py-1 text-caption text-warning">{l.note}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption">
                      {l.links.map((x) => (
                        <a key={x.label} href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-content-secondary hover:border-[var(--accent)]">{x.label}<ExternalLink className="h-3 w-3" /></a>
                      ))}
                      <span className="text-content-faint">· {l.source}</span>
                    </div>
                    {l.mode === 'train' && <TrainHelper party={party} />}
                  </div>
                </li>
              ))}
            </ol>
            {o.notes.map((n) => <p key={n} className="mt-2 text-caption text-content-muted">• {n}</p>)}
            <a className="btn-secondary mt-3" href={o.gmaps} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4" />Open in Google Maps</a>
          </div>
          <MapView layers={layersFor(o)} height={320} />
        </div>
      )}
    </article>
  )
}

export function JourneyResults({ r, ask, onReplanFrom, to, date, showHotels = true }: { r: JourneyResult; ask: JourneyAsk; onReplanFrom: (p: GeoPoint) => void; to: GeoPoint; date: string; showHotels?: boolean }) {
  const [open, setOpen] = useState<string | null>(r.options[0]?.id ?? null)
  const [locErr, setLocErr] = useState('')
  const [locating, setLocating] = useState(false)
  if (!r.options.length) return <section className="card" role="alert"><h2 className="font-serif text-[28px] text-content">No journey found</h2><p className="text-body text-content-secondary">{r.message}</p></section>
  const replan = () => {
    setLocating(true); setLocErr('')
    currentPosition().then(onReplanFrom, (e: Error) => setLocErr(e.message)).finally(() => setLocating(false))
  }
  return (
    <section className="space-y-4" aria-label="Journey options">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-content-muted">{r.km.toLocaleString('en-IN')} km as the crow flies{r.timeZone && r.timeZone !== 'Asia/Kolkata' ? ` · times in ${r.timeZone.replace('_', ' ')}` : ''} · {r.options.length} door-to-door options, ranked for <strong>{ask.priority === 'balanced' ? 'the best balance' : ask.priority === 'comfort' ? 'comfort' : ask.priority === 'fastest' ? 'time' : 'money'}</strong></p>
        <button type="button" className="btn-secondary" onClick={replan} disabled={locating}><LocateFixed className="h-4 w-4" />{locating ? 'Finding you…' : 'Missed a connection? Replan from where I am now'}</button>
      </div>
      {locErr && <p className="field-error">{locErr}</p>}
      <div className="space-y-3">
        {r.options.map((o) => <OptionCard key={o.id} o={o} start={r.start} zone={r.timeZone} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} party={ask.party} />)}
      </div>
      <p className="text-caption text-content-faint">Data: {r.sources.join(' · ')}. “est.” marks estimates — the linked booking sites show the exact fare.</p>
      {showHotels && <Hotels at={to} checkin={date} guests={ask.party} title={`Stay in ${to.city ?? to.name}`} />}
    </section>
  )
}

// ---------------------------------------------------------------- places to stay

export type Hotel = { id: string; name: string; lat: number; lon: number; km: number; stars?: number; rating?: number; reviews?: number; photo?: string; address?: string; pricePerNight?: number; board?: string; refundable?: boolean; source: string; estimate: boolean; links: Link[] }
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

export function Hotels({ at, checkin, nights = 1, guests, title, autoload = false, onPick, picked }: {
  at: GeoPoint; checkin: string; nights?: number; guests: Family; title: string; autoload?: boolean
  /** "Stay here": the trip re-plans its days from this hotel */
  onPick?: (h: Hotel) => void; picked?: string
}) {
  const [list, setList] = useState<{ hotels: Hotel[]; sources: string[] } | null>(null)
  const adults = Math.max(1, guests.adults + guests.seniors)
  const checkout = addDays(checkin, Math.max(1, nights))
  const load = useAction(async () => {
    const qs = new URLSearchParams({ lat: String(at.lat), lon: String(at.lon), city: at.city ?? at.name, checkin, checkout, adults: String(adults), children: String(guests.children) })
    setList(await api.get<{ hotels: Hotel[]; sources: string[] }>(`/api/hotels?${qs}`, `hotels:${qs}`))
  })
  const [started, setStarted] = useState(false)
  if (autoload && !started) { setStarted(true); void load.run() }
  return (
    <section className="card space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="tz-kicker"><BedDouble className="me-1 inline h-4 w-4" />Where to stay</div>
          <h2 className="font-serif text-[28px] leading-tight text-content">{title}</h2>
          <p className="text-caption text-content-muted">{checkin} → {checkout} · {adults} adult{adults === 1 ? '' : 's'}{guests.children ? `, ${guests.children} children` : ''}</p>
        </div>
        {!list && !load.busy && <button type="button" className="btn" onClick={() => { setStarted(true); void load.run() }}>Show hotels and prices</button>}
      </div>
      {load.busy && <Skeleton lines={2} />}
      {load.error && <ErrorBox message={load.error} onRetry={() => void load.retry()} />}
      {list && !list.hotels.length && <p className="text-body text-content-muted">No hotels found near here. Try the booking sites directly.</p>}
      {list && !!list.hotels.length && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.hotels.map((h) => (
              <div key={h.id} className="overflow-hidden rounded-2xl border border-edge">
                {h.photo && <img src={h.photo} alt="" loading="lazy" className="h-32 w-full object-cover" />}
                <div className="p-3">
                  <p className="font-semibold text-content">{h.name}</p>
                  <p className="text-caption text-content-muted">{h.stars ? `${'★'.repeat(Math.min(5, h.stars))} · ` : ''}{h.rating ? `${h.rating}/10${h.reviews ? ` (${h.reviews})` : ''} · ` : ''}{h.km} km away</p>
                  {h.pricePerNight != null && <p className="mt-1 text-body"><strong>{rupees(h.pricePerNight)}</strong> <span className="text-content-muted">/ night{h.estimate ? ' (test price)' : ''}{h.board ? ` · ${h.board}` : ''}{h.refundable ? ' · free cancellation' : ''}</span></p>}
                  {onPick && (
                    <button type="button" className={`mt-2 ${picked === h.name ? 'btn' : 'btn-secondary'} btn-sm`} onClick={() => onPick(h)} aria-pressed={picked === h.name}>
                      {picked === h.name ? 'Staying here' : 'Stay here — plan days from it'}
                    </button>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-caption">
                    {h.links.map((x) => <a key={x.label} href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-content-secondary hover:border-[var(--accent)]">{x.label}<ExternalLink className="h-3 w-3" /></a>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-caption text-content-faint">Data: {list.sources.join(' · ')}. Booking links open with your dates and guests filled in.</p>
        </>
      )}
    </section>
  )
}
