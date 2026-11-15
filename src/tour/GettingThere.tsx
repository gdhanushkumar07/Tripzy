/**
 * Tour → Daily Traveller bridge: plan getting to the trip from the user's live location
 * (flights, trains, buses, own car or cab — real data, door to door), and where to stay.
 */
import { LocateFixed, MapPin } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { commuteUrl, isJourney } from '../commute/CommutePage'
import { Hotels, JourneyResults, type JourneyAsk, type JourneyResult } from '../commute/JourneyView'
import { api, type GeoPoint } from '../lib/api'
import { useAuth } from '../lib/auth'
import { currentPosition } from '../lib/location'
import { ErrorBox, Skeleton, useAction } from '../lib/status'

export function GettingThere({ dest, start, days, party }: { dest: GeoPoint; start: string; days: number; party: number }) {
  const { profile } = useAuth()
  const [from, setFrom] = useState<GeoPoint | null>(null)
  const [res, setRes] = useState<JourneyResult | null>(null)
  const fam = profile.prefs.family
  const ask: JourneyAsk = {
    party: fam && fam.adults + fam.children + fam.seniors === party ? fam : { adults: party, children: 0, seniors: 0 },
    luggage: 'heavy', priority: profile.prefs.priority ?? 'balanced', own: profile.prefs.vehicles?.car ? 'car' : 'none',
  }
  const today = new Date().toISOString().slice(0, 10)
  const date = start < today ? today : start
  const plan = useAction(async () => {
    const here = await currentPosition()
    setFrom(here)
    if (!isJourney(here, dest)) return setRes(null)
    setRes(await api.post<JourneyResult>('/api/journey/plan', { from: here, to: dest, date, time: '07:00', ...ask, vehicles: profile.prefs.vehicles }, `trip-journey:${here.lat.toFixed(2)},${here.lon.toFixed(2)}:${dest.name}:${date}`))
  })
  const near = from && !isJourney(from, dest)
  return (
    <section className="mt-14 space-y-4" aria-label="Getting there and staying">
      <div className="card space-y-3">
        <div className="tz-kicker"><MapPin className="me-1 inline h-4 w-4" />Getting there</div>
        <h2 className="font-serif text-[30px] leading-tight text-content">From where you are to {dest.name}</h2>
        <p className="text-body text-content-muted">Uses your live location and compares flights, trains, buses, your own car and outstation cabs door to door for {party} {party === 1 ? 'person' : 'people'} on {date} — car is one option, not the default, for far-away places.</p>
        <button type="button" className="btn" onClick={() => void plan.run()} disabled={plan.busy}><LocateFixed className="h-4 w-4" />{plan.busy ? 'Locating you and comparing…' : res ? 'Refresh from my location' : 'Plan from my live location'}</button>
        {plan.busy && <Skeleton lines={2} />}
        {plan.error && <ErrorBox message={plan.error} onRetry={() => void plan.retry()} />}
        {near && from && (
          <p className="text-body">You are close by. <Link className="btn-link" to={commuteUrl({ from, to: dest, time: new Date().toTimeString().slice(0, 5), date: today, modes: profile.prefs.modes })}>See live city routes from {from.name} →</Link></p>
        )}
      </div>
      {res && from && <JourneyResults r={res} ask={ask} to={dest} date={date} showHotels={false}
        onReplanFrom={(p) => { setFrom(p); void plan.run() }} />}
      <Hotels at={dest} checkin={date} nights={days} guests={ask.party} title={`Stay in ${dest.name}`} />
    </section>
  )
}
