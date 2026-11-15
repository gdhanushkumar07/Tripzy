/**
 * Journey planner for any distance: within a city, between states, or between countries.
 *
 * It builds door-to-door candidates from live sources and scores the whole journey:
 *  - India, up to ~1,500 km: the tested Daily Traveller engine on a live graph (GTFS metro/bus,
 *    railway junctions and bus terminals, OSRM roads, tariffs), run once per family of modes
 *  - anywhere with open timetables: Transitous (rail, coach, metro, bus, ferry), real schedules
 *  - flights: nearest airports at both ends, live fares when a key is set, plus access and egress
 *    legs and the check-in buffer, so a flight is compared door to door, not airport to airport
 *  - your own car (fuel from your mileage, tolls) and outstation cabs, split across the party
 * Every option is scored on cost for the whole party, door-to-door time, transfers, walking,
 * waiting, comfort (luggage, children, seniors), reliability and night-driving safety, and four
 * are tagged: Fastest, Cheapest, Most comfortable and Best balanced.
 */
import type { Family, Priority, Vehicles } from '../../src/lib/types'
import { FUEL_PRICE, ownPerKm, rideLinks, tariffs, type Link } from '../fares'
import { cached, DAY, fetchJson, haversineKm, UpstreamError, type LatLon } from '../lib'
import { nearestAirports, type Airport } from '../providers/airports'
import { flightsBetween, type Flight } from '../providers/flights'
import { cityOf } from '../providers/hubs'
import { road } from '../providers/route'
import { transitPlan, type TransitItinerary } from '../providers/transitous'
import { planCommuteVariants, type Point } from './commute'
import { trainBookingLinks } from './rail-links'

export type JourneyQuery = {
  from: Point & { country?: string }; to: Point & { country?: string }
  date: string; time: string; party: Family; luggage: 'light' | 'heavy'; priority: Priority
  own: 'none' | 'car' | 'scooter'; vehicles?: Vehicles
}

export type JLeg = {
  mode: string; name: string; from: string; to: string; fromLL: [number, number]; toLL: [number, number]
  /** minutes after the journey start */
  start: number; minutes: number; wait?: number; km: number; cost: number
  source: string; estimate: boolean; realtime?: boolean; links: Link[]; geometry?: [number, number][]; note?: string
}
export type Tag = 'Fastest' | 'Cheapest' | 'Most comfortable' | 'Best balanced'
export type JOption = {
  id: string; title: string; kind: 'flight' | 'train' | 'bus' | 'car' | 'cab' | 'transit' | 'city'
  legs: JLeg[]; minutes: number; cost: number; perPerson: number; transfers: number; walkKm: number; waitMin: number
  comfort: number; reliability: number; notes: string[]; tags: Tag[]; why: string; estimate: boolean; gmaps: string
}

const IN_BBOX = (p: LatLon) => p.lat > 6.4 && p.lat < 35.8 && p.lon > 68 && p.lon < 97.5
const inIndia = (p: LatLon & { country?: string }) => (p.country ? /^(in|india)$/i.test(p.country) : IN_BBOX(p))
const size = (f: Family) => f.adults + f.children + f.seniors
const gmapsUrl = (a: LatLon, b: LatLon, mode = 'transit') => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&travelmode=${mode}`
const ll = (p: LatLon): [number, number] => [p.lat, p.lon]

// comfort of an hour on each mode (0–10); luggage and children change it
const COMFORT: Record<string, number> = {
  flight: 8, train: 7, rail: 5, metro: 6, ferry: 7, ibus: 5.5, coach: 6, citybus: 3.5, cab: 8, suv: 8.5, owncar: 7, ownscooter: 3,
  auto: 4, shareauto: 3, erick: 3.5, bike: 3, cycle: 3, walk: 4, transit: 5,
}
const RELIABILITY: Record<string, number> = { flight: 0.86, train: 0.8, rail: 0.85, metro: 0.97, ferry: 0.8, ibus: 0.75, coach: 0.82, citybus: 0.7, cab: 0.9, suv: 0.9, owncar: 0.92, ownscooter: 0.9, auto: 0.88, bike: 0.88, walk: 1, transit: 0.82 }

function comfortOf(o: Pick<JOption, 'legs' | 'transfers' | 'walkKm'>, q: JourneyQuery): number {
  const ride = o.legs.reduce((s, l) => s + l.minutes, 0) || 1
  let c = o.legs.reduce((s, l) => s + (COMFORT[l.mode] ?? 5) * l.minutes, 0) / ride
  const heavy = q.luggage === 'heavy', kids = q.party.children + q.party.seniors > 0
  c -= o.transfers * (heavy || kids ? 0.9 : 0.5)
  c -= Math.max(0, o.walkKm - 0.5) * (heavy ? 1.5 : 0.6)
  if (heavy && o.legs.some((l) => ['bike', 'ownscooter', 'cycle'].includes(l.mode))) c -= 2.5
  if (kids && o.legs.some((l) => l.mode === 'ibus' && l.minutes > 360)) c -= 1
  const drive = o.legs.filter((l) => l.mode === 'owncar').reduce((s, l) => s + l.minutes, 0)
  if (drive > 240) c -= Math.min(2.5, (drive - 240) / 150) // you are the driver
  return +Math.max(0, Math.min(10, c)).toFixed(1)
}

function finish(o: Omit<JOption, 'comfort' | 'reliability' | 'tags' | 'why' | 'perPerson' | 'transfers' | 'walkKm' | 'waitMin' | 'minutes' | 'cost'> & Partial<JOption>, q: JourneyQuery, startMin: number): JOption {
  const legs = o.legs
  const end = legs.length ? Math.max(...legs.map((l) => l.start + l.minutes)) : 0
  const rides = legs.filter((l) => l.mode !== 'walk')
  const base = {
    ...o, minutes: Math.round(end), cost: Math.round(legs.reduce((s, l) => s + l.cost, 0)),
    transfers: Math.max(0, rides.length - 1), walkKm: +legs.filter((l) => l.mode === 'walk').reduce((s, l) => s + l.km, 0).toFixed(1),
    waitMin: Math.round(legs.reduce((s, l) => s + (l.wait ?? 0), 0)),
  }
  const comfort = comfortOf(base, q)
  const reliability = +(rides.reduce((p, l) => p * (RELIABILITY[l.mode] ?? 0.85) * (l.realtime ? 1.03 : 1), 1)).toFixed(2)
  const notes = [...o.notes]
  const carLeg = legs.find((l) => l.mode === 'owncar')
  const driveMin = carLeg?.minutes ?? 0
  const t = startMin + (carLeg?.start ?? 0)
  let night = false
  for (let m = t; m <= t + driveMin; m += 20) if (m % 1440 < 300) night = true
  if (night && driveMin > 120) notes.push('Part of this drive is between midnight and 5 am — highway night driving is the riskiest; consider leaving earlier.')
  if (driveMin > 9 * 60) notes.push('Over 9 hours at the wheel: plan an overnight stop or a second driver.')
  return { ...base, comfort, reliability: Math.min(0.99, reliability), notes, perPerson: Math.round(base.cost / size(q.party)), tags: [], why: '' }
}

// ---------------------------------------------------------------- road: own car, outstation cab

async function roadOptions(q: JourneyQuery, startMin: number): Promise<JOption[]> {
  const r = await road(q.from, q.to, 'driving').catch(() => null)
  if (!r || r.km < 1) return []
  const out: JOption[] = []
  const india = inIndia(q.from) && inIndia(q.to)
  const people = size(q.party)
  const longTrip = r.km > 60
  const drivingMin = r.min * (longTrip ? 1.12 : 1.35)
  const breaks = Math.floor(drivingMin / 150) * 15
  const tolls = india && longTrip ? Math.round(r.km * 1.45) : 0
  const car = q.vehicles?.car
  if (q.own === 'car' && r.km <= 1500) {
    const perKm = car ? ownPerKm(car.kmpl, car.fuel) : FUEL_PRICE.petrol / 15
    const seats = car?.seats ?? 5
    const cars = Math.ceil(people / seats)
    out.push(finish({
      id: 'own-car', title: 'Drive your car', kind: 'car', estimate: true, gmaps: gmapsUrl(q.from, q.to, 'driving'),
      legs: [{
        mode: 'owncar', name: 'Your car', from: q.from.name, to: q.to.name, fromLL: ll(q.from), toLL: ll(q.to), start: 0, minutes: Math.round(drivingMin + breaks), km: +r.km.toFixed(0),
        cost: Math.round((r.km * perKm + tolls) * cars), source: `${r.source} · fuel at ₹${perKm.toFixed(1)}/km from ${car ? 'your saved mileage' : 'an assumed 15 km/l'}${tolls ? ` · tolls ≈ ₹${tolls} (NHAI average)` : ''}`,
        estimate: true, links: rideLinks('owncar', q.from, q.to), geometry: r.geometry, note: breaks ? `Includes ${breaks} min of breaks` : undefined,
      }],
      notes: [cars > 1 ? `${people} people need ${cars} cars` : `Fuel and tolls are shared by all ${people}: ₹${Math.round(((r.km * perKm + tolls) * cars) / people)} each`, 'Luggage: no limit, door to door'],
    }, q, startMin))
  }
  if (q.own === 'scooter' && r.km <= 150) {
    const perKm = ownPerKm(q.vehicles?.scooter?.kmpl ?? 45, 'petrol')
    out.push(finish({
      id: 'own-scooter', title: 'Ride your scooter', kind: 'car', estimate: true, gmaps: gmapsUrl(q.from, q.to, 'two-wheeler'),
      legs: [{ mode: 'ownscooter', name: 'Your scooter', from: q.from.name, to: q.to.name, fromLL: ll(q.from), toLL: ll(q.to), start: 0, minutes: Math.round(r.min * 1.15), km: +r.km.toFixed(0), cost: Math.round(r.km * perKm * Math.ceil(people / 2)), source: `${r.source} · fuel from your saved mileage`, estimate: true, links: rideLinks('ownscooter', q.from, q.to), geometry: r.geometry }],
      notes: [],
    }, q, startMin))
  }
  // outstation cab (India): one-way fares on popular routes, sedan up to 4, SUV up to 6
  if (india && r.km > 60 && r.km <= 1500) {
    const suv = people > 4
    const perKm = suv ? 17 : 12.5
    const days = Math.max(1, Math.ceil((drivingMin + breaks) / 600))
    const vehicles = Math.ceil(people / (suv ? 6 : 4))
    const fare = Math.round((Math.max(r.km, 130) * perKm + 350 * days + tolls) * vehicles)
    out.push(finish({
      id: 'outstation-cab', title: suv ? 'Outstation SUV with driver' : 'Outstation cab with driver', kind: 'cab', estimate: true, gmaps: gmapsUrl(q.from, q.to, 'driving'),
      legs: [{
        mode: suv ? 'suv' : 'cab', name: suv ? 'One-way SUV (Innova class)' : 'One-way sedan', from: q.from.name, to: q.to.name, fromLL: ll(q.from), toLL: ll(q.to), start: 0, wait: 20,
        minutes: Math.round(drivingMin + breaks + 20), km: +r.km.toFixed(0), cost: fare, source: `${r.source} · fare from typical one-way outstation tariffs (₹${perKm}/km + driver allowance + tolls)`,
        estimate: true, geometry: r.geometry,
        links: [{ label: 'Ola Outstation', url: `https://book.olacabs.com/?pickup_lat=${q.from.lat}&pickup_lng=${q.from.lon}&drop_lat=${q.to.lat}&drop_lng=${q.to.lon}&category=outstation` }, { label: 'Savaari', url: 'https://www.savaari.com/' }, { label: 'Uber Intercity', url: rideLinks('cab', q.from, q.to)[0].url }],
      }],
      notes: [`₹${Math.round(fare / people)} per person · door to door, any luggage`],
    }, q, startMin))
  }
  return out
}

// ---------------------------------------------------------------- India: live graph engine

async function indiaGroundOptions(q: JourneyQuery, startMin: number): Promise<{ options: JOption[]; sources: string[] }> {
  const people = size(q.party)
  const base = ['walk', 'auto', 'bike', 'cab', 'suv', 'metro', 'citybus', 'rail'] as const
  // park-and-ride with your own vehicle makes sense for day trips, not for parking it for days at a far station
  const own = haversineKm(q.from, q.to) > 150 ? [] : q.own === 'car' ? (['owncar'] as const) : q.own === 'scooter' ? (['ownscooter'] as const) : []
  const sets = [[...base, ...own, 'train'], [...base, ...own, 'ibus']] as unknown as Parameters<typeof planCommuteVariants>[1]
  const { variants, sources } = await planCommuteVariants({ from: q.from, to: q.to, date: q.date, time: q.time, modes: [], people, vehicles: q.vehicles }, sets)
  const seen = new Set<string>()
  const out: JOption[] = []
  variants.forEach((routes, vi) => {
    for (const r of routes) {
      const sig = r.legs.map((l) => `${l.mode}:${l.name}`).join('|')
      if (seen.has(sig)) continue
      seen.add(sig)
      const main = r.legs.find((l) => l.mode === 'train') ?? r.legs.find((l) => l.mode === 'ibus')
      const kind: JOption['kind'] = main?.mode === 'train' ? 'train' : main?.mode === 'ibus' ? 'bus' : 'city'
      const legs: JLeg[] = r.legs.map((l) => ({
        mode: l.mode, name: l.name, from: l.fromName, to: l.toName, fromLL: l.from_ll, toLL: l.to_ll,
        start: l.depart - r.depart, wait: l.wait, minutes: l.minutes, km: l.km, cost: l.fare * people,
        source: l.source, estimate: l.estimate, links: l.mode === 'train' ? trainBookingLinks(l.fromName, l.toName, q, l.from_ll, l.to_ll) : l.links,
        geometry: l.geometry, note: l.note,
      }))
      // the engine reports the first wait inside the first leg's start; shift so the journey starts at 0
      const t0 = Math.min(...legs.map((l) => l.start - (l.wait ?? 0)))
      legs.forEach((l) => { l.start = Math.round(l.start - t0); l.minutes = Math.round(l.minutes); if (l.wait != null) l.wait = Math.round(l.wait) })
      const title = kind === 'train' ? `Train via ${main!.fromName.replace(/ railway station$/i, '')}` : kind === 'bus' ? `Bus from ${main!.fromName}` : r.legs.map((l) => l.name).slice(0, 3).join(' → ')
      out.push(finish({ id: `in-${vi}-${r.id}`, title, kind, legs, estimate: r.legs.some((l) => l.estimate), gmaps: r.gmaps, notes: r.why ? [r.why] : [] }, q, startMin))
    }
  })
  return { options: out, sources }
}

// ---------------------------------------------------------------- Transitous (worldwide timetables)

const TR_MODE: Record<string, string> = {
  WALK: 'walk', BUS: 'citybus', TRAM: 'metro', SUBWAY: 'metro', METRO: 'metro', FERRY: 'ferry', RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train', REGIONAL_RAIL: 'rail', REGIONAL_FAST_RAIL: 'rail', SUBURBAN: 'rail', COACH: 'coach', AIRPLANE: 'flight', ODM: 'cab', CABLE_CAR: 'metro', FUNICULAR: 'metro',
}
// ₹ per km, when the feed has no fares (labelled estimate)
const TR_FARE: Record<string, number> = { train: 6, rail: 4, coach: 4, citybus: 2, metro: 3, ferry: 8, flight: 7, cab: 25 }

function transitOption(it: TransitItinerary, q: JourneyQuery, i: number, startIso: string, startMin: number): JOption | null {
  const t0 = new Date(startIso).getTime()
  const people = size(q.party)
  const legs: JLeg[] = it.legs.map((l, k) => {
    const mode = TR_MODE[l.mode] ?? 'transit'
    if (l.from === 'START') l.from = q.from.name
    if (l.to === 'END') l.to = q.to.name
    const km = l.km || +(haversineKm({ lat: l.fromLL[0], lon: l.fromLL[1] }, { lat: l.toLL[0], lon: l.toLL[1] }) * 1.2).toFixed(1)
    const start = (new Date(l.depart).getTime() - t0) / 60000
    const prevEnd = k ? (new Date(it.legs[k - 1].arrive).getTime() - t0) / 60000 : 0
    return {
      mode, name: l.name, from: l.from, to: l.to, fromLL: l.fromLL, toLL: l.toLL, start: Math.round(start), wait: Math.max(0, Math.round(start - prevEnd)), minutes: l.minutes, km,
      cost: mode === 'walk' ? 0 : Math.round(Math.max(mode === 'citybus' || mode === 'metro' ? 30 : 80, km * (TR_FARE[mode] ?? 4)) * people),
      source: `${l.agency ?? 'Open timetable'} via Transitous${l.realtime ? ' · realtime' : ' · scheduled'} · fare estimated`, estimate: true, realtime: l.realtime,
      links: [...(l.agencyUrl ? [{ label: l.agency ?? 'Operator', url: l.agencyUrl }] : []), { label: 'Google Maps', url: gmapsUrl({ lat: l.fromLL[0], lon: l.fromLL[1] }, { lat: l.toLL[0], lon: l.toLL[1] }, mode === 'walk' ? 'walking' : 'transit') }],
      geometry: l.geometry,
    }
  })
  if (!legs.some((l) => l.mode !== 'walk')) return null
  const main = legs.filter((l) => l.mode !== 'walk').sort((a, b) => b.minutes - a.minutes)[0]
  const kind: JOption['kind'] = main.mode === 'train' ? 'train' : main.mode === 'coach' ? 'bus' : 'transit'
  return finish({ id: `tr-${i}`, title: `${main.name}${legs.length > 3 ? ' + connections' : ''}`, kind, legs, estimate: true, gmaps: gmapsUrl(q.from, q.to), notes: [] }, q, startMin)
}

// ---------------------------------------------------------------- flights door to door

async function accessLeg(a: LatLon & { name: string }, b: LatLon & { name: string }, start: number, india: boolean, people: number, toAirport: boolean): Promise<JLeg> {
  const r = await road(a, b, 'driving').catch(() => null)
  const km = r?.km ?? haversineKm(a, b) * 1.3
  const min = (r?.min ?? (km / 35) * 60) * (km < 40 ? 1.35 : 1.1)
  const T = tariffs(cityOf(a)?.name)
  const suv = people > 4
  const t = suv ? T.suv : T.cab
  const fare = india ? (t.base + Math.max(0, km - (t.baseKm ?? 0)) * t.perKm + (t.perMin ?? 0) * min) * Math.ceil(people / t.seats) : Math.max(25, km * 1.8) * 90 * Math.ceil(people / 4) // ~€1.8/km metered taxi
  return {
    mode: suv ? 'suv' : 'cab', name: `${suv ? 'SUV cab' : 'Cab'} ${toAirport ? 'to the airport' : 'from the airport'}`, from: a.name, to: b.name, fromLL: ll(a), toLL: ll(b),
    start, wait: india ? 6 : 10, minutes: Math.round(min + (india ? 6 : 10)), km: +km.toFixed(1), cost: Math.round(fare),
    source: `${r?.source ?? 'Distance estimate'} · ${india ? 'fare from published tariff' : 'typical taxi fare (estimate)'} — compare with metro/bus in Daily Traveller`, estimate: true,
    links: india ? rideLinks(suv ? 'suv' : 'cab', a, b) : rideLinks('cab', a, b).filter((l) => ['Uber', 'Google Maps'].includes(l.label)), geometry: r?.geometry,
  }
}

async function flightOptions(q: JourneyQuery, startMin: number): Promise<{ options: JOption[]; sources: string[] }> {
  const km = haversineKm(q.from, q.to)
  if (km < 300) return { options: [], sources: [] }
  const ao = nearestAirports(q.from, 2), ad = nearestAirports(q.to, 2)
  if (!ao.length || !ad.length) return { options: [], sources: [] }
  const pairs: [Airport & { km: number }, Airport & { km: number }][] = []
  for (const a of ao) for (const b of ad) if (a.iata !== b.iata && haversineKm(a, b) > 150) pairs.push([a, b])
  const people = size(q.party)
  const pax = { adults: q.party.adults + q.party.seniors, children: q.party.children }
  const intl = ao[0].country !== ad[0].country
  const buffer = intl ? (haversineKm(ao[0], ad[0]) < 1500 ? 120 : 180) : 100 // reach the airport this long before departure (check-in, security, boarding)
  const out: JOption[] = []
  const sources = new Set<string>()
  for (const [a, b] of pairs.slice(0, 3)) {
    const flights = await flightsBetween(a, b, q.date, pax).catch(() => [] as Flight[])
    if (!flights.length) continue
    const cheapest = flights.reduce((x, y) => (x.pricePerPerson <= y.pricePerPerson ? x : y))
    const quickest = flights.reduce((x, y) => (x.minutes <= y.minutes ? x : y))
    for (const f of [...new Set([cheapest, quickest])]) {
      sources.add(f.source)
      const india = inIndia(q.from)
      const toAir = await accessLeg(q.from, { lat: a.lat, lon: a.lon, name: `${a.name} (${a.iata})` }, 0, india, people, true)
      // a live flight has a clock time: wait at the airport from arrival until boarding
      let flightStart = toAir.minutes + buffer
      let note: string | undefined
      if (f.depart) {
        // airline times are local to the departure airport; the journey starts in the same city, so compare wall clocks
        const wall = (s: string) => new Date(`${s.slice(0, 16)}:00Z`).getTime()
        const at = (wall(f.depart) - wall(`${q.date}T${q.time}`)) / 60000
        if (at < toAir.minutes + buffer) continue // cannot make this flight from here in time
        flightStart = at
        note = `Leave by ${clock(startMin + at - buffer - toAir.minutes)} to be at the airport ${buffer} min before departure`
      }
      const air: JLeg = {
        mode: 'flight', name: `${f.airline}${f.number ? ` · ${f.number}` : ''}${f.stops ? ` · ${f.stops} stop` : ' · nonstop'}`, from: `${a.name} (${a.iata})`, to: `${b.name} (${b.iata})`,
        fromLL: ll(a), toLL: ll(b), start: Math.round(flightStart), wait: Math.round(flightStart - toAir.minutes), minutes: f.minutes, km: Math.round(haversineKm(a, b)),
        cost: f.pricePerPerson * people, source: f.source, estimate: f.estimate, links: f.links, geometry: [ll(a), ll(b)],
        note: note ?? `Be at the airport ${buffer} min before departure${q.luggage === 'heavy' ? ' · check-in baggage allowance (usually 15 kg domestic)' : ''}`,
      }
      const deplane = q.luggage === 'heavy' ? 35 : 20
      const fromAir = await accessLeg({ lat: b.lat, lon: b.lon, name: `${b.name} (${b.iata})` }, q.to, air.start + air.minutes + deplane, inIndia(q.to), people, false)
      fromAir.wait = deplane
      out.push(finish({
        id: `fl-${a.iata}-${b.iata}-${f === cheapest ? 'c' : 'q'}`, title: `Fly ${a.iata} → ${b.iata}${f.depart ? ` at ${f.depart.slice(11, 16)}` : ''}`, kind: 'flight', estimate: f.estimate,
        legs: [toAir, air, fromAir], gmaps: gmapsUrl(q.from, q.to, 'driving'), notes: [`Door to door, including ${buffer} min at the departure airport and ${deplane} min to collect bags`],
      }, q, startMin))
    }
  }
  return { options: out, sources: [...sources] }
}

const clock = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(Math.round(((m % 60) + 60) % 60)).padStart(2, '0')}`

// ---------------------------------------------------------------- scoring

const VOT = 4 // ₹ per person-minute used only for the balanced ranking

export function tagOptions(options: JOption[], q: Pick<JourneyQuery, 'party' | 'priority'>): JOption[] {
  if (!options.length) return options
  const people = size(q.party)
  const general = (o: JOption) => o.cost + VOT * people * o.minutes + people * (10 - o.comfort) * 12 * (o.minutes / 60) + 30 * people * o.transfers + (1 - o.reliability) * 1500 * people
  const pick = (f: (o: JOption) => number) => options.reduce((a, b) => (f(b) < f(a) ? b : a))
  const tags: [Tag, JOption][] = [
    ['Fastest', pick((o) => o.minutes + 3 * o.transfers)],
    ['Cheapest', pick((o) => o.cost + o.minutes / 100)],
    ['Most comfortable', pick((o) => -o.comfort + o.minutes / 6000)],
    ['Best balanced', pick(general)],
  ]
  for (const [t, o] of tags) o.tags.push(t)
  for (const o of options) {
    const parts = [`${fmtDur(o.minutes)} door to door`, `₹${o.cost.toLocaleString('en-IN')} for ${people === 1 ? 'you' : `all ${people}`}`, `${o.transfers} change${o.transfers === 1 ? '' : 's'}`, `comfort ${o.comfort}/10`]
    if (o.waitMin > 20) parts.push(`${o.waitMin} min waiting`)
    o.why = parts.join(' · ')
  }
  const key: Record<Priority, (o: JOption) => number> = {
    fastest: (o) => o.minutes, cheapest: (o) => o.cost, comfort: (o) => -o.comfort, balanced: general,
  }
  return options.sort((a, b) => key[q.priority](a) - key[q.priority](b))
}
const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`)

/** Drop options that are strictly worse than another one on cost, time and comfort (keeps the list short). */
function prune(options: JOption[]): JOption[] {
  return options.filter((o) => !options.some((p) => p !== o && p.cost <= o.cost && p.minutes <= o.minutes && p.comfort >= o.comfort && (p.cost < o.cost || p.minutes < o.minutes - 5)))
}

/** Time zone of a point (IANA name + offset), from Open-Meteo — no key, cached for a day. */
function zoneOf(p: LatLon): Promise<{ timeZone: string; offsetMin: number }> {
  return cached(`tz:${p.lat.toFixed(1)},${p.lon.toFixed(1)}`, DAY, async () => {
    const j = await fetchJson<{ timezone: string; utc_offset_seconds: number }>(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&timezone=auto&forecast_days=1&current=temperature_2m`)
    return { timeZone: j.timezone, offsetMin: Math.round(j.utc_offset_seconds / 60) }
  }, true)
}

export async function planJourney(q: JourneyQuery): Promise<{ options: JOption[]; sources: string[]; km: number; start: string; timeZone: string; message?: string }> {
  const km = haversineKm(q.from, q.to)
  if (km < 0.3) throw new UpstreamError('Start and destination are the same place.', 400)
  const india = inIndia(q.from) && inIndia(q.to)
  const zone = inIndia(q.from) ? { timeZone: 'Asia/Kolkata', offsetMin: 330 } : await zoneOf(q.from).catch(() => ({ timeZone: 'UTC', offsetMin: Math.round(q.from.lon / 15) * 60 }))
  const startIso = new Date(new Date(`${q.date}T${q.time}:00Z`).getTime() - zone.offsetMin * 60000).toISOString()
  const [hh, mm] = q.time.split(':').map(Number)
  const startMin = hh * 60 + mm
  const sources = new Set<string>()
  const tasks: Promise<JOption[]>[] = [
    roadOptions(q, startMin).catch(() => []),
    flightOptions(q, startMin).then((r) => { r.sources.forEach((s) => sources.add(s)); return r.options }).catch(() => []),
  ]
  if (india && km <= 1500) tasks.push(indiaGroundOptions(q, startMin).then((r) => { r.sources.forEach((s) => sources.add(s)); return r.options }).catch(() => []))
  // open timetables worldwide; in India they add little beyond the engine, so only as a fallback abroad or across borders
  if (!india) tasks.push(transitPlan(q.from, q.to, startIso, 6).then((its) => {
    if (its.length) sources.add('Public transport: Transitous (open GTFS timetables, realtime where published)')
    return its.map((it, i) => transitOption(it, q, i, startIso, startMin)).filter((x): x is JOption => !!x)
  }).catch(() => []))
  let options = (await Promise.all(tasks)).flat()
  // sanity: drop public-transport itineraries far slower than driving (bad feeds) when a road option exists
  const roadMin = options.find((o) => o.kind === 'car' || o.kind === 'cab')?.minutes
  if (roadMin) options = options.filter((o) => o.kind === 'car' || o.kind === 'cab' || o.kind === 'flight' || o.minutes < roadMin * 3 + 60)
  const perKind = new Map<string, number>()
  options = prune(options).sort((a, b) => b.comfort - a.comfort).filter((o) => { const n = (perKind.get(o.kind) ?? 0) + 1; perKind.set(o.kind, n); return n <= 2 })
  if (options.some((o) => o.legs.some((l) => l.mode === 'cab' || l.mode === 'owncar'))) sources.add('Roads: OSRM / OpenStreetMap (Ola Maps traffic when its key is active)')
  const tagged = tagOptions(options, q)
  return {
    options: tagged.slice(0, 8), sources: [...sources], km: Math.round(km), start: startIso, timeZone: zone.timeZone,
    message: tagged.length ? undefined : 'No way found between these places at this time. Try another time or a nearby city.',
  }
}
