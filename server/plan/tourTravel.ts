/**
 * Getting to a tour destination, thought through as a traveller (not a commuter):
 *  - you want to arrive rested in the morning of day 1, not at midnight and not at 6 pm
 *  - so long trains and buses are timed backwards: leave early enough to arrive around 08:00 on
 *    day 1 — an overnight ride then replaces a hotel night (that money is counted)
 *  - flights keep their real schedule from an early start on day 1 (or the evening before)
 *  - a late-night arrival is penalised, and any travel during daylight on trip days costs
 *    sightseeing time (valued per minute)
 * The journey planner does the routing (flights, trains, buses, own car, cabs, metro first/last mile);
 * this layer chooses the departure, re-ranks for the trip and explains it in plain words.
 */
import type { Family, Mode, Priority, Vehicles } from '../../src/lib/types'
import type { Point } from './commute'
import { planJourney, type JOption } from './journey'

export type TourTravelQuery = {
  from: Point & { country?: string }; to: Point & { country?: string }; start: string; party: Family; vehicles?: Vehicles; modes?: Mode[]; own?: 'none' | 'car' | 'scooter'; priority?: Priority
  /** 'return': from the destination back home after the last day (`start` is then the last trip day) */
  direction?: 'go' | 'return'
}
export type TourOption = JOption & { departLabel: string; depart: string; arrive: string; hotelSaved: number; daylightLost: number; tripCost: number; tourTags: string[]; advice: string }

const HOTEL_NIGHT = 1400 // ₹ per room per night, typical 3-star in Indian cities (estimate, labelled)
const DAYLIGHT_VALUE = 4 // ₹ per person-minute of sightseeing time lost on a trip day
const ARRIVE_BY = 8 * 60 // aim to arrive around 08:00 on day 1

const fmtClock = (d: Date, tz: string) => d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
const localMinutes = (d: Date, tz: string) => { const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d); return (+p.find((x) => x.type === 'hour')!.value % 24) * 60 + +p.find((x) => x.type === 'minute')!.value }
const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
/** wall-clock time in a zone → instant (zones without DST: offset taken at that moment) */
const at = (date: string, minutes: number, offsetMin: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - offsetMin) * 60000)

export async function planTourTravel(q: TourTravelQuery): Promise<{ options: TourOption[]; sources: string[]; km: number; timeZone: string }> {
  if (q.direction === 'return') return planReturn(q)
  const people = q.party.adults + q.party.children + q.party.seniors
  const rooms = Math.max(1, Math.ceil(people / 2))
  const base = { from: q.from, to: q.to, party: q.party, luggage: 'heavy' as const, priority: q.priority ?? 'balanced', own: q.own ?? 'none', vehicles: q.vehicles, modes: q.modes, sea: true }
  const j = await planJourney({ ...base, date: q.start, time: '05:30' })
  const tz = j.timeZone
  const offset = Math.round((Date.parse(j.start) - Date.parse(`${q.start}T05:30:00Z`)) / -60000) // origin UTC offset in minutes
  const out: TourOption[] = []
  for (const o of j.options) {
    const fixed = o.kind === 'flight' && !o.estimate // live flight: keep its real schedule
    let depart: Date, label: string
    if (fixed) {
      depart = new Date(j.start); label = 'Early on day 1'
    } else if (o.minutes < 7 * 60) {
      // short enough for the morning of day 1: leave so you arrive around 08:00, but not before 05:30
      depart = at(q.start, Math.max(5.5 * 60, ARRIVE_BY - o.minutes), offset); label = 'Early on day 1'
    } else {
      // leave so that you arrive around 08:00 on day 1; never ask anyone to start between 01:00 and 05:00
      depart = at(q.start, ARRIVE_BY - o.minutes, offset)
      const m = localMinutes(depart, tz)
      if (m >= 60 && m < 5 * 60) depart = new Date(depart.getTime() - (m + 120) * 60000) // pull back to 22:00 the evening before (arrive a little earlier)
      const nights = Math.round((Date.parse(`${q.start}T00:00:00Z`) - Date.parse(`${localDate(depart, tz)}T00:00:00Z`)) / 864e5)
      const dm = localMinutes(depart, tz)
      label = nights <= 0 ? 'Early on day 1' : nights === 1 ? (dm >= 16 * 60 ? 'Evening before' : 'Day before') : `${nights} days before`
    }
    const arrive = new Date(depart.getTime() + o.minutes * 60000)
    const arriveMin = localMinutes(arrive, tz)
    // a night spent travelling (00:00–05:00 on the move, the night before day 1) replaces a hotel night there
    let onBoardNight = false
    for (let t = depart.getTime(); t < arrive.getTime(); t += 15 * 60000) {
      const d = new Date(t)
      if (localMinutes(d, tz) < 5 * 60 && localDate(d, tz) <= q.start) { onBoardNight = true; break }
    }
    // a real night on board: 7 h or more, through the small hours, arriving in the morning
    const hotelSaved = onBoardNight && o.kind !== 'car' && o.minutes >= 7 * 60 && arriveMin >= 5 * 60 && arriveMin <= 11 * 60 ? HOTEL_NIGHT * rooms : 0
    let daylightLost = 0
    for (let t = depart.getTime(); t < arrive.getTime(); t += 10 * 60000) {
      const d = new Date(t), m = localMinutes(d, tz)
      if (localDate(d, tz) >= q.start && m >= 8 * 60 && m < 20 * 60) daylightLost += 10
    }
    const lateNight = arriveMin >= 22 * 60 || arriveMin < 5 * 60
    const tripCost = o.cost - hotelSaved + DAYLIGHT_VALUE * people * daylightLost + (lateNight ? 300 * people : 0)
    const advice = [
      `Leave ${fmtClock(depart, tz)}`, `arrive ${fmtClock(arrive, tz)}`,
      hotelSaved ? `you sleep on board — no hotel that night (≈ ₹${hotelSaved.toLocaleString('en-IN')} saved, estimate)` : '',
      daylightLost >= 120 ? `uses ${Math.round(daylightLost / 60)} h of your first day` : daylightLost ? `costs ${daylightLost} min of sightseeing` : 'day 1 stays free for sightseeing',
      lateNight ? 'arrives late at night — book the first night in advance' : '',
      !fixed ? 'times chosen to arrive in the morning — check the actual train/bus times on the booking links' : '',
    ].filter(Boolean).join(' · ')
    out.push({ ...o, id: `tour-${o.id}`, departLabel: label, depart: depart.toISOString(), arrive: arrive.toISOString(), hotelSaved, daylightLost, tripCost: Math.round(tripCost), tourTags: [], advice })
  }
  const opts = out.sort((a, b) => a.tripCost - b.tripCost)
  const pick = (f: (o: TourOption) => number) => opts.reduce((a, b) => (f(b) < f(a) ? b : a))
  if (opts.length) {
    pick((o) => o.tripCost).tourTags.push('Best for this trip')
    pick((o) => o.cost - o.hotelSaved).tourTags.push('Cheapest overall (incl. hotel)')
    pick((o) => o.minutes).tourTags.push('Fastest')
    pick((o) => -o.comfort + o.minutes / 6000).tourTags.push('Most comfortable')
  }
  return { options: opts.slice(0, 7), sources: j.sources, km: j.km, timeZone: tz }
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)

/**
 * The way home, thought through the same way: the last day is for sightseeing until the evening, so
 * short rides leave around 18:30, long trains and buses run overnight (the last hotel night is saved),
 * and rides of 5–7 hours leave the next morning rather than arriving home at 1 am (that hotel night is counted).
 */
async function planReturn(q: TourTravelQuery): Promise<{ options: TourOption[]; sources: string[]; km: number; timeZone: string }> {
  const people = q.party.adults + q.party.children + q.party.seniors
  const rooms = Math.max(1, Math.ceil(people / 2))
  const last = q.start
  const base = { from: q.from, to: q.to, party: q.party, luggage: 'heavy' as const, priority: q.priority ?? 'balanced', own: q.own ?? 'none', vehicles: q.vehicles, modes: q.modes, sea: true }
  const j = await planJourney({ ...base, date: last, time: '17:00' })
  const tz = j.timeZone
  const offset = Math.round((Date.parse(j.start) - Date.parse(`${last}T17:00:00Z`)) / -60000)
  const out: TourOption[] = []
  for (const o of j.options) {
    const fixed = o.kind === 'flight' && !o.estimate
    let depart: Date, label: string, extraNight = 0
    if (fixed) { depart = new Date(j.start); label = 'Evening of the last day' }
    else if (o.minutes < 5 * 60) { depart = at(last, 18 * 60 + 30, offset); label = 'Evening of the last day' }
    else if (o.minutes < 7 * 60) { depart = at(nextDay(last), 7 * 60, offset); label = 'Morning after the last day'; extraNight = HOTEL_NIGHT * rooms }
    else { depart = at(last, Math.max(20 * 60, 32 * 60 - o.minutes), offset); label = 'Overnight after the last day' }
    const arrive = new Date(depart.getTime() + o.minutes * 60000)
    const arriveMin = localMinutes(arrive, tz)
    const overnight = o.kind !== 'car' && o.minutes >= 7 * 60 && localMinutes(depart, tz) >= 18 * 60 && arriveMin >= 5 * 60 && arriveMin <= 12 * 60
    const hotelSaved = overnight ? HOTEL_NIGHT * rooms : 0
    let daylightLost = 0
    for (let t = depart.getTime(); t < arrive.getTime(); t += 10 * 60000) {
      const d = new Date(t), m = localMinutes(d, tz)
      if (localDate(d, tz) === last && m >= 8 * 60 && m < 18 * 60) daylightLost += 10
    }
    const lateNight = arriveMin >= 23 * 60 || arriveMin < 5 * 60
    const tripCost = o.cost + extraNight - hotelSaved + DAYLIGHT_VALUE * people * daylightLost + (lateNight ? 300 * people : 0)
    const advice = [
      `Leave ${fmtClock(depart, tz)}`, `home ${fmtClock(arrive, tz)}`,
      hotelSaved ? `you sleep on board — no hotel for the last night (≈ ₹${hotelSaved.toLocaleString('en-IN')} saved, estimate)` : '',
      extraNight ? `one more hotel night (≈ ₹${extraNight.toLocaleString('en-IN')}, estimate) instead of reaching home after midnight` : '',
      daylightLost >= 60 ? `cuts ${Math.round(daylightLost / 60)} h from your last day` : 'the whole last day stays free for sightseeing',
      lateNight ? 'reaches home late at night' : '',
      !fixed ? 'times chosen around your last day — check the actual train/bus times on the booking links' : '',
    ].filter(Boolean).join(' · ')
    out.push({ ...o, id: `back-${o.id}`, departLabel: label, depart: depart.toISOString(), arrive: arrive.toISOString(), hotelSaved: hotelSaved - extraNight, daylightLost, tripCost: Math.round(tripCost), tourTags: [], advice })
  }
  const opts = out.sort((a, b) => a.tripCost - b.tripCost)
  const pick = (f: (o: TourOption) => number) => opts.reduce((a, b) => (f(b) < f(a) ? b : a))
  if (opts.length) {
    pick((o) => o.tripCost).tourTags.push('Best way home')
    pick((o) => o.cost - o.hotelSaved).tourTags.push('Cheapest overall (incl. hotel)')
    pick((o) => o.minutes).tourTags.push('Fastest')
    pick((o) => -o.comfort + o.minutes / 6000).tourTags.push('Most comfortable')
  }
  return { options: opts.slice(0, 7), sources: j.sources, km: j.km, timeZone: tz }
}
