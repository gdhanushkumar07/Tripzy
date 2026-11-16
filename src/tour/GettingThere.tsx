/**
 * Tour → getting there and back, planned like a traveller: an overnight train or bus that saves a
 * hotel night, arriving in the morning rather than at midnight, keeping day 1 (and the last day) for
 * sightseeing. Start from your live location or any place you type, filter by the ways you'd travel
 * (flight, train, bus, your car, cab, cruise), pick one each way and it is saved with the trip.
 * Then: where to stay — and picking a hotel re-plans the days around it.
 */
import { ArrowLeftRight, Check, MapPin } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { commuteUrl, isJourney } from '../commute/CommutePage'
import { OptionCard, type JOption } from '../commute/JourneyView'
import { api, type GeoPoint } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ErrorBox, Skeleton, useAction } from '../lib/status'
import { LocationInput } from '../ui/LocationInput'
import type { TravelPick, Trip } from './generate'

type TourOption = JOption & { departLabel: string; depart: string; arrive: string; hotelSaved: number; daylightLost: number; tripCost: number; tourTags: string[]; advice: string }
type TourTravel = { options: TourOption[]; sources: string[]; km: number; timeZone: string }

const WAYS = [
  { id: 'flight', label: 'Flight', emoji: '✈️' }, { id: 'train', label: 'Train', emoji: '🚆' }, { id: 'bus', label: 'Bus', emoji: '🚌' },
  { id: 'car', label: 'My own vehicle', emoji: '🚗' }, { id: 'cab', label: 'Cab with driver', emoji: '🚕' }, { id: 'ship', label: 'Cruise / ship', emoji: '🚢' },
] as const
type Way = (typeof WAYS)[number]['id']

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })

export function GettingThere({ dest, start, days, party, travel, onTravel }: {
  dest: GeoPoint; start: string; days: number; party: number
  travel?: Trip['travel']; onTravel?: (t: Trip['travel']) => void
}) {
  const { profile } = useAuth()
  const [from, setFrom] = useState<GeoPoint | null>(travel?.from ?? null)
  const [ways, setWays] = useState<Way[]>([])
  const [go, setGo] = useState<TourTravel | null>(null)
  const [back, setBack] = useState<TourTravel | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [returning, setReturning] = useState<'plan' | 'later' | 'oneway'>(travel?.back ? 'plan' : travel?.oneway ? 'oneway' : 'later')
  const fam = profile.prefs.family
  const family = fam && fam.adults + fam.children + fam.seniors === party ? fam : { adults: party, children: 0, seniors: 0 }
  const today = new Date().toISOString().slice(0, 10)
  const date = start < today ? today : start
  const last = addDays(date, Math.max(1, days) - 1)
  const own = ways.includes('car') || profile.prefs.vehicles?.car ? 'car' : 'none'
  const ask = (direction: 'go' | 'return', a: GeoPoint, b: GeoPoint) =>
    api.post<TourTravel>('/api/tour/travel', { from: a, to: b, start: direction === 'go' ? date : last, party: family, vehicles: profile.prefs.vehicles, modes: profile.prefs.modes, own, direction },
      `tour-travel:${direction}:${a.lat.toFixed(2)},${a.lon.toFixed(2)}:${b.name}:${direction === 'go' ? date : last}:${own}`)
  const plan = useAction(async (p: GeoPoint, withReturn: boolean) => {
    setFrom(p)
    if (!isJourney(p, dest)) { setGo(null); setBack(null); return }
    const [g, r] = await Promise.all([ask('go', p, dest), withReturn ? ask('return', dest, p) : Promise.resolve(null)])
    setGo(g); setBack(r)
    setOpen(g.options.find((o) => o.tourTags.includes('Best for this trip'))?.id ?? null)
  })
  const near = from && !isJourney(from, dest)
  const shown = (r: TourTravel | null) => (r ? r.options.filter((o) => !ways.length || ways.includes(o.kind as Way) || (o.kind === 'flight' && ways.includes('flight'))) : [])
  const pick = (o: TourOption): TravelPick => ({ title: o.title, kind: o.kind, depart: o.depart, arrive: o.arrive, cost: o.cost, label: o.departLabel })
  const save = (patch: Partial<NonNullable<Trip['travel']>>) => onTravel?.({ ...(travel ?? {}), ...(from ? { from: { name: from.name, lat: from.lat, lon: from.lon } } : {}), ...patch })

  const list = (r: TourTravel, dir: 'go' | 'back') => {
    const opts = shown(r)
    const chosen = dir === 'go' ? travel?.go : travel?.back
    return (
      <div className="space-y-3">
        <p className="text-body text-content-muted">{r.km.toLocaleString('en-IN')} km · {opts.length} of {r.options.length} ways{ways.length ? ' match your filter' : ''}, best for your trip first</p>
        {!opts.length && <p className="text-body text-content-muted">None of the ways you picked run here. Clear the filter to see every option.</p>}
        {opts.map((o) => (
          <div key={o.id}>
            <OptionCard o={o} start={o.depart} zone={r.timeZone}
              open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} party={family} extraTags={[o.departLabel, ...o.tourTags]}
              advice={`${o.advice}${o.hotelSaved > 0 ? ` · tickets ₹${o.cost.toLocaleString('en-IN')} minus the hotel night = ${o.cost - o.hotelSaved > 0 ? `₹${(o.cost - o.hotelSaved).toLocaleString('en-IN')}` : 'cheaper than staying a night'}` : ''}`} />
            {onTravel && (
              <button type="button" className={`mt-2 ${chosen?.title === o.title && chosen.depart === o.depart ? 'btn' : 'btn-secondary'} btn-sm`} onClick={() => save(dir === 'go' ? { go: pick(o) } : { back: pick(o), oneway: false })}>
                {chosen?.title === o.title && chosen.depart === o.depart ? <><Check className="h-4 w-4" />Chosen</> : dir === 'go' ? 'Go this way' : 'Come back this way'}
              </button>
            )}
          </div>
        ))}
        <p className="text-caption text-content-faint">Data: {r.sources.join(' · ')}. Hotel saving uses a typical ₹1,400 per room per night (estimate).</p>
      </div>
    )
  }

  return (
    <section className="mt-14 space-y-4" aria-label="Getting there and back">
      <div className="card space-y-4">
        <div className="tz-kicker"><MapPin className="me-1 inline h-4 w-4" />Getting there and back</div>
        <h2 className="font-serif text-[30px] leading-tight text-content">From home to {dest.name}, and back</h2>
        {(travel?.go || travel?.back || travel?.oneway) && (
          <ul className="space-y-1 rounded-2xl bg-accent-subtle p-3 text-body text-accent-on">
            {travel.go && <li><strong>Going:</strong> {travel.go.title} · leave {when(travel.go.depart)}, arrive {when(travel.go.arrive)} · ₹{travel.go.cost.toLocaleString('en-IN')}</li>}
            {travel.back && <li><strong>Coming back:</strong> {travel.back.title} · leave {when(travel.back.depart)}, home {when(travel.back.arrive)} · ₹{travel.back.cost.toLocaleString('en-IN')}</li>}
            {travel.oneway && <li>One way — no return planned.</li>}
          </ul>
        )}
        <p className="text-body text-content-muted">
          Planned like a traveller for {party} {party === 1 ? 'person' : 'people'} with bags: an overnight train or bus can replace a hotel night, arriving in the morning keeps day 1 for sightseeing, and the way back leaves after your last day.
        </p>
        <LocationInput label="Starting from" value={from} onChange={(p) => { setFrom(p); setGo(null); setBack(null) }} placeholder="Your home city, station or address" />
        <div>
          <p className="label">Ways you'd travel <span className="font-normal text-content-muted">(none picked = all)</span></p>
          <div className="flex flex-wrap gap-2">
            {WAYS.map((w) => (
              <button key={w.id} type="button" className={`chip ${ways.includes(w.id) ? 'chip-on' : 'chip-off'}`}
                onClick={() => setWays(ways.includes(w.id) ? ways.filter((x) => x !== w.id) : [...ways, w.id])}>{w.emoji} {w.label}</button>
            ))}
          </div>
          {ways.includes('car') && !profile.prefs.vehicles?.car && <p className="mt-1 text-caption text-content-muted">Fuel and tolls use a typical car; add yours in preferences for exact costs.</p>}
        </div>
        <div>
          <p className="label">Coming back?</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Return trip">
            {([['plan', 'Plan my return too'], ['later', "I'll decide later"], ['oneway', 'One way only']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={returning === v} className={`chip ${returning === v ? 'chip-on' : 'chip-off'}`}
                onClick={() => { setReturning(v); if (v === 'oneway') save({ oneway: true, back: undefined }); else if (travel?.oneway) save({ oneway: false }) }}>{l}</button>
            ))}
          </div>
          {returning === 'plan' && <p className="mt-1 text-caption text-content-muted">The way back is planned from {dest.name} after your last day ({last}) to where you start from.</p>}
        </div>
        <button type="button" className="btn" disabled={!from || plan.busy} onClick={() => from && void plan.run(from, returning === 'plan')}>
          <ArrowLeftRight className="h-4 w-4" />{plan.busy ? 'Comparing every way…' : go ? 'Compare again' : returning === 'plan' ? 'Compare ways there and back' : 'Compare ways to get there'}
        </button>
        {plan.busy && <Skeleton lines={2} />}
        {plan.error && <ErrorBox message={plan.error} onRetry={() => void plan.retry()} />}
        {near && from && (
          <p className="text-body">You are close by. <Link className="btn-link" to={commuteUrl({ from, to: dest, time: new Date().toTimeString().slice(0, 5), date: today, modes: profile.prefs.modes })}>See live city routes from {from.name} →</Link></p>
        )}
      </div>
      {go && <div className="space-y-2"><h3 className="tz-h3 text-content">Going · {date}</h3>{list(go, 'go')}</div>}
      {back && returning === 'plan' && <div className="space-y-2"><h3 className="tz-h3 text-content">Coming back · after {last}</h3>{list(back, 'back')}</div>}
    </section>
  )
}
