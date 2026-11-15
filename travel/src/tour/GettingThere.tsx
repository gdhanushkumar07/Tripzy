/**
 * Tour → getting there from where you are, planned like a traveller: an overnight train or bus
 * that saves a hotel night, arriving in the morning rather than at midnight, and keeping day 1 for
 * sightseeing. Uses your live location, your comfortable modes and your saved vehicle. Then: where to stay.
 */
import { LocateFixed, MapPin } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { commuteUrl, isJourney } from '../commute/CommutePage'
import { Hotels, OptionCard, type JOption } from '../commute/JourneyView'
import { api, type GeoPoint } from '../lib/api'
import { useAuth } from '../lib/auth'
import { currentPosition } from '../lib/location'
import { ErrorBox, Skeleton, useAction } from '../lib/status'

type TourOption = JOption & { departLabel: string; depart: string; arrive: string; hotelSaved: number; daylightLost: number; tripCost: number; tourTags: string[]; advice: string }
type TourTravel = { options: TourOption[]; sources: string[]; km: number; timeZone: string }

export function GettingThere({ dest, start, days, party }: { dest: GeoPoint; start: string; days: number; party: number }) {
  const { profile } = useAuth()
  const [from, setFrom] = useState<GeoPoint | null>(null)
  const [res, setRes] = useState<TourTravel | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const fam = profile.prefs.family
  const family = fam && fam.adults + fam.children + fam.seniors === party ? fam : { adults: party, children: 0, seniors: 0 }
  const today = new Date().toISOString().slice(0, 10)
  const date = start < today ? today : start
  const plan = useAction(async () => {
    const here = await currentPosition()
    setFrom(here)
    if (!isJourney(here, dest)) return setRes(null)
    const r = await api.post<TourTravel>('/api/tour/travel', { from: here, to: dest, start: date, party: family, vehicles: profile.prefs.vehicles, modes: profile.prefs.modes, own: profile.prefs.vehicles?.car ? 'car' : 'none' }, `tour-travel:${here.lat.toFixed(2)},${here.lon.toFixed(2)}:${dest.name}:${date}`)
    setRes(r)
    setOpen(r.options.find((o) => o.tourTags.includes('Best for this trip'))?.id ?? null)
  })
  const near = from && !isJourney(from, dest)
  return (
    <section className="mt-14 space-y-4" aria-label="Getting there and staying">
      <div className="card space-y-3">
        <div className="tz-kicker"><MapPin className="me-1 inline h-4 w-4" />Getting there</div>
        <h2 className="font-serif text-[30px] leading-tight text-content">From where you are to {dest.name}</h2>
        <p className="text-body text-content-muted">
          Planned like a traveller, from your live location, for {party} {party === 1 ? 'person' : 'people'} with bags:
          the evening before (an overnight train or bus can replace a hotel night) or early on {date}, compared on the real trip cost — tickets, the hotel night you save, a late-night arrival, and the sightseeing time you lose on day 1.
        </p>
        <button type="button" className="btn" onClick={() => void plan.run()} disabled={plan.busy}><LocateFixed className="h-4 w-4" />{plan.busy ? 'Locating you and comparing…' : res ? 'Refresh from my location' : 'Plan from my live location'}</button>
        {plan.busy && <Skeleton lines={2} />}
        {plan.error && <ErrorBox message={plan.error} onRetry={() => void plan.retry()} />}
        {near && from && (
          <p className="text-body">You are close by. <Link className="btn-link" to={commuteUrl({ from, to: dest, time: new Date().toTimeString().slice(0, 5), date: today, modes: profile.prefs.modes })}>See live city routes from {from.name} →</Link></p>
        )}
      </div>
      {res && (
        <div className="space-y-3">
          <p className="text-body text-content-muted">{res.km.toLocaleString('en-IN')} km away · {res.options.length} ways, best for your trip first</p>
          {res.options.map((o) => (
            <OptionCard key={o.id} o={o} start={o.depart} zone={res.timeZone}
              open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} party={family} extraTags={[o.departLabel, ...o.tourTags]}
              advice={`${o.advice}${o.hotelSaved ? ` · tickets ₹${o.cost.toLocaleString('en-IN')} minus the hotel night = ${o.cost - o.hotelSaved > 0 ? `₹${(o.cost - o.hotelSaved).toLocaleString('en-IN')}` : 'cheaper than staying a night'}` : ''}`} />
          ))}
          <p className="text-caption text-content-faint">Data: {res.sources.join(' · ')}. Hotel saving uses a typical ₹1,400 per room per night (estimate).</p>
        </div>
      )}
      <Hotels at={dest} checkin={date} nights={days} guests={family} title={`Stay in ${dest.name}`} />
    </section>
  )
}
