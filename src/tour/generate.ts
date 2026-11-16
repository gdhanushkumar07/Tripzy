/**
 * Tourist itinerary algorithm — pure, no UI, no network. One algorithm, two data sources:
 *  - live: the API server passes real places (OpenStreetMap), per-date opening intervals,
 *    hourly weather + air quality (Open-Meteo), sunrise/sunset, optional AI web checks
 *    and the user's history weights;
 *  - offline: the bundled sample places (Hyderabad, Jaipur) — the "Basic plan".
 * Greedy day composer: respects opening hours, closures, show slots, meals, diet, effort,
 * budget, weather and best time of day; scores interests × conditions × travel.
 */
import data from '../data/places.json'
import { MAX_TRIP_DAYS, type Merged, type Tag } from './questions'

export type Place = {
  id: string; city: string; name: string; lat: number; lon: number; cat: string; tags: string[]
  hours: string[][]; closed: number[]; dwell: number; intensity: number; cost: number; best: string[]; desc: string
  diet?: string; meal?: string[]; slot?: string[]; indoor: boolean; stairs: boolean
  /** live only: opening intervals per ISO date as flat minute pairs [open, close, open, close…] (Firestore has no nested arrays) */
  open?: Record<string, number[]>
  rating?: number; wikidata?: string; website?: string; source?: string; image?: string
  /** false when `open` holds typical category hours, not published ones */
  hoursKnown?: boolean
  /** a sight first-time visitors come for (from Tripzy's destination profiles), or a signature food place */
  must?: boolean
  /** only worth it after dark (clubs, night markets, light shows, beach bonfires) */
  night?: boolean
  /** adults only (bars, clubs): never planned for families with kids or seniors */
  adult?: boolean
}
export const PLACES = (data as unknown as { places: Place[] }).places
export const CITIES = (data as unknown as { cities: Record<string, { name: string }> }).cities
const BY_ID = new Map(PLACES.map((p) => [p.id, p]))

/** Hourly conditions for one day (index = hour 0–23). */
export type DayWx = { temp: number[]; feels: number[]; rain: number[]; code: number[]; aqi: (number | null)[]; uv: number[]; sunrise: number; sunset: number; max: number; rainMax: number }
export type LiveCheck = { verdict: 'good' | 'caution' | 'avoid'; note: string; sources: { title: string; url: string }[]; by: 'ai' }
export type StopWx = { temp: number; rain: number; aqi?: number; code: number }

export type Stop = {
  placeId: string; name: string; kind: 'visit' | 'meal'; start: number; end: number; cost: number
  travel: { km: number; min: number; fare: number; mode?: HopMode } | null
  why: string; who: string[]; warn?: string
  wx?: StopWx; notes?: string[]; check?: LiveCheck; boosted?: string
}
export type Day = {
  date: string; stops: Stop[]; wx?: { max: number; rain: number; code: number }
  /** the ride back to the hotel at the end of the day (when the traveller picked one) */
  back?: Stop['travel']
  /** a day with nothing new left within reach */
  note?: string
}
/** A way to get to the destination (or home) the traveller chose. */
export type TravelPick = { title: string; kind: string; depart: string; arrive: string; cost: number; label: string }
/** Where the travellers stay: every day starts and ends here. */
export type Base = { name: string; lat: number; lon: number; address?: string; source?: string }
export type Trip = {
  title: string; city: string; start: string; dayStart: number; dayEnd: number; party: number
  budgetPerDay: number | null; days: Day[]; source: 'basic' | 'ai' | 'live'; answers: Merged; groupCode?: string
  createdAt: number; updatedAt: number
  /** live trips carry their own place pool + weather so edits re-check offline */
  places?: Place[]; weather?: Record<string, DayWx>; center?: { name: string; lat: number; lon: number }
  sources?: string[]; boost?: Record<string, number>; boostWhy?: Record<string, string>
  base?: Base
  /** the destination's most visited places (ids, most famous first), shown above the plan whether or not the plan uses them */
  top?: string[]
  /** how the travellers get there and back (chosen on the trip page) */
  travel?: { from?: { name: string; lat: number; lon: number }; go?: TravelPick; back?: TravelPick; oneway?: boolean }
  /** why people visit this destination and how long they usually stay */
  profile?: { why: string; days: [number, number] }
}
export type PlanContext = {
  places: Place[]; weather?: Record<string, DayWx>; center?: Trip['center']; sources?: string[]
  checks?: Record<string, LiveCheck>; boost?: Record<string, number>; boostWhy?: Record<string, string>
  base?: Base; profile?: Trip['profile']
}

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type HopMode = 'walk' | 'auto' | 'bike' | 'cab' | 'transit' | 'owncar' | 'ownscooter'
export const HOP_LABEL: Record<HopMode, string> = { walk: 'Walk', auto: 'Auto', bike: 'Bike taxi', cab: 'Cab', transit: 'Metro / bus', owncar: 'Your car', ownscooter: 'Your scooter' }

/**
 * Travel between two stops; fare per person. Without preferences it is an auto (seats 3), as before.
 * With the modes the traveller is comfortable with, every allowed mode is priced (vehicles split
 * across the party) and the best for a tourist wins: money plus ₹3 per minute of travel.
 */
export function travel(a: { lat: number; lon: number }, b: { lat: number; lon: number }, party: number, modes?: HopMode[]): { km: number; min: number; fare: number; mode?: HopMode } {
  const km = Math.round(haversine(a, b) * 1.35 * 10) / 10
  if (km < 0.4) return { km, min: 5, fare: 0, mode: 'walk' } // walk
  const n = Math.max(party, 1)
  if (!modes?.length) return { km, min: Math.round((km / 18) * 60 + 6), fare: Math.round((30 + 16 * km) / Math.min(n, 3)) }
  const per = (vehicleFare: number, seats: number) => Math.round((vehicleFare * Math.ceil(n / seats)) / n)
  const opts: { mode: HopMode; min: number; fare: number }[] = []
  for (const m of modes) {
    if (m === 'walk' && km <= 1.5) opts.push({ mode: m, min: Math.round((km / 4.5) * 60), fare: 0 })
    if (m === 'auto') opts.push({ mode: m, min: Math.round((km / 18) * 60 + 6), fare: per(30 + 16 * km, 3) })
    if (m === 'bike' && n <= 2) opts.push({ mode: m, min: Math.round((km / 22) * 60 + 5), fare: per(20 + 8 * km, 1) })
    if (m === 'cab') opts.push({ mode: m, min: Math.round((km / 20) * 60 + 7), fare: per(60 + 14 * km + 1.5 * (km / 20) * 60, 4) })
    if (m === 'transit' && km >= 1.5) opts.push({ mode: m, min: Math.round((km / 15) * 60 + 14), fare: Math.min(40, Math.round(10 + 2 * km)) })
    if (m === 'owncar') opts.push({ mode: m, min: Math.round((km / 20) * 60 + 8), fare: per(7 * km + 30, 5) })
    if (m === 'ownscooter' && n <= 2) opts.push({ mode: m, min: Math.round((km / 22) * 60 + 4), fare: per(2.3 * km + 10, 2) })
  }
  if (!opts.length) return { km, min: Math.round((km / 18) * 60 + 6), fare: Math.round((30 + 16 * km) / Math.min(n, 3)), mode: 'auto' }
  const best = opts.reduce((x, y) => (y.fare + 3 * y.min < x.fare + 3 * x.min ? y : x))
  return { km, ...best }
}

const weekday = (iso: string, i: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + i); return (d.getDay() + 6) % 7 } // 0 = Mon
export const dateOf = (iso: string, i: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10) }

/** Earliest start ≥ t at which the place is open for its full visit (waits up to 45 min). */
export function openAt(p: Place, t: number, wd: number, date?: string): number | null {
  if (date && p.open && p.open[date]) {
    const iv = p.open[date]
    for (let i = 0; i + 1 < iv.length; i += 2) {
      const start = Math.max(t, iv[i])
      if (start - t <= 45 && start + p.dwell <= iv[i + 1]) return start
    }
    return null
  }
  if (p.closed.includes(wd)) return null
  if (p.slot) { const s = toMin(p.slot[0]); return t <= s && s - t <= 90 ? s : null }
  if (!p.hours.length) return t // unknown hours (live data): assume open, flagged in notes
  for (const [o, c] of p.hours) {
    const open = toMin(o), close = c === '23:59' ? 24 * 60 : toMin(c)
    const start = Math.max(t, open)
    if (start - t <= 45 && start + p.dwell <= close) return start
  }
  return null
}

/** Earliest time ≥ t (same day) at which the place opens long enough for a visit; null if it doesn't today. */
function nextOpen(p: Place, t: number, wd: number, date?: string): number | null {
  if (date && p.open && p.open[date]) {
    const iv = p.open[date]
    for (let i = 0; i + 1 < iv.length; i += 2) { const start = Math.max(t, iv[i]); if (start + p.dwell <= iv[i + 1]) return start }
    return null
  }
  if (p.closed.includes(wd)) return null
  for (const [o, c] of p.hours) { const start = Math.max(t, toMin(o)); if (start + p.dwell <= (c === '23:59' ? 1440 : toMin(c))) return start }
  return p.hours.length ? null : t
}

const dietOk = (p: Place, diet: number) => !p.diet || diet === 0 || (diet === 1 ? p.diet !== 'nonveg' : p.diet === 'veg')
const isFood = (p: Place) => p.cat === 'food' || p.cat === 'cafe' || (!!p.meal && p.meal.includes('dinner') && p.cat !== 'show')

/** Weight of a tag nobody picked: small, so a plan follows the answers instead of whatever is nearby. */
const UNPICKED = 0.05

/**
 * How much each interest counts. The traveller's own picks lead (first pick 1.0, last 0.5); the
 * evening, effort and party answers add what that kind of trip usually wants without outranking a pick:
 * friends lean to nightlife, adventure and food; couples to views and evenings out; families to
 * kid-friendly places and never to bars; seniors to easy, calm places.
 */
export function weights(a: Merged, boost?: Record<string, number>): Record<string, number> {
  const w: Record<string, number> = {}
  const ranked = a.interests ?? []
  ranked.forEach((t, i) => (w[t] = 1 - i * (0.5 / Math.max(ranked.length, 1))))
  const atLeast = (t: string, v: number) => (w[t] = Math.max(w[t] ?? 0, v))
  const atMost = (t: string, v: number) => (w[t] = Math.min(w[t] ?? UNPICKED, v))
  if (a.evening === 'spiritual') atLeast('spiritual', 0.7)
  if (a.evening === 'nightlife') atLeast('nightlife', 0.7)
  if (a.effort === 'high') atLeast('adventure', 0.45)
  if (a.food === 'street') atLeast('food', 0.45)
  switch (a.party) {
    case 'kids': atLeast('kids', 0.8); atLeast('entertainment', 0.45); atMost('nightlife', 0.1); atMost('adventure', 0.35); break
    case 'seniors': atMost('nightlife', 0.2); atMost('adventure', 0.15); break
    case 'friends': atLeast('nightlife', 0.4); atLeast('adventure', 0.35); atLeast('food', 0.35); break
    case 'couple': atLeast('photography', 0.35); atLeast('nightlife', 0.3); break
  }
  if (a.evening === 'early') atMost('nightlife', 0.15)
  for (const [t, b] of Object.entries(boost ?? {})) w[t] = Math.max(0, Math.min(1.3, (w[t] ?? UNPICKED) + b))
  return w
}

/** How well a place fits the answers (0–1.3) — the main term of every score. */
function match(p: Place, w: Record<string, number>) {
  const v = p.tags.map((t) => w[t] ?? UNPICKED).sort((x, y) => y - x)
  return (v[0] ?? 0) + 0.3 * (v[1] ?? 0)
}

/**
 * Answers first, fame second: a place that matches the picks always beats one that doesn't, and among
 * matches the famous sight (more Wikipedia language editions, or a must-see for the destination) wins
 * over a minor one. A must-see that matches nothing still gets a chance on a free slot.
 */
function interestScore(p: Place, w: Record<string, number>) {
  const m = match(p, w)
  const fame = Math.min(p.rating ?? 2, 7) / 7
  return 1.4 * m + 0.55 * fame + (p.must ? (m >= 0.5 ? 0.45 : 0.2) : 0)
}

const WX_WORD: Record<number, string> = { 0: 'clear', 1: 'clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 80: 'showers', 81: 'showers', 82: 'heavy showers', 95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm' }

/**
 * Live suitability of visiting place p on date at minute t: weather, heat, rain, air quality,
 * golden hour. Returns a score adjustment and plain-language notes.
 */
export function conditions(p: Place, wx: DayWx | undefined, t: number, dwell: number) {
  const notes: string[] = []
  if (!wx) return { score: 0, notes, wx: undefined as StopWx | undefined, skip: false }
  const hs = Array.from({ length: Math.max(1, Math.ceil(dwell / 60)) }, (_, i) => Math.min(23, Math.floor(t / 60) + i))
  const rain = Math.max(...hs.map((h) => wx.rain[h] ?? 0))
  const feels = Math.max(...hs.map((h) => wx.feels[h] ?? wx.temp[h] ?? 25))
  const aqiVals = hs.map((h) => wx.aqi[h]).filter((x): x is number => x != null)
  const aqi = aqiVals.length ? Math.max(...aqiVals) : undefined
  const h0 = Math.floor(t / 60)
  const stopWx: StopWx = { temp: Math.round(wx.temp[h0] ?? 0), rain, aqi, code: wx.code[h0] ?? 0 }
  let score = 0
  let skip = false
  const outdoor = !p.indoor && !isFood(p)
  if (outdoor && rain >= 70) { score -= 1.2; notes.push(`${rain}% chance of rain — indoor option preferred`) } else if (outdoor && rain >= 40) { score -= 0.4; notes.push(`${rain}% chance of rain, carry an umbrella`) }
  if (p.indoor && rain >= 50) { score += 0.35; notes.push('Indoor — a good pick on a rainy spell') }
  if (outdoor && feels >= 40) { score -= 1; notes.push(`Feels like ${Math.round(feels)}°C — very hot for an outdoor visit`) } else if (outdoor && feels >= 35 && p.intensity >= 5) { score -= 0.45; notes.push(`Feels like ${Math.round(feels)}°C, tiring climb`) }
  if (p.indoor && feels >= 36) score += 0.25
  if (outdoor && aqi != null && aqi > 200) { score -= 0.8; notes.push(`Air quality poor (AQI ${aqi}) — limit time outdoors`) } else if (outdoor && aqi != null && aqi > 150) { score -= 0.3; notes.push(`AQI ${aqi}, unhealthy for sensitive groups`) }
  if ([95, 96, 99].includes(stopWx.code) && outdoor) { skip = true; notes.push('Thunderstorm forecast — skipped') }
  // best time of day from real sunrise / sunset
  const golden = t >= wx.sunset - 100 && t <= wx.sunset - 10
  const earlyCool = t >= wx.sunrise && t <= wx.sunrise + 150
  if (outdoor && (p.tags.includes('photography') || p.cat === 'viewpoint') && golden) { score += 0.45; notes.push(`Golden hour — sunset ${fmt(wx.sunset)}`) }
  if (outdoor && p.intensity >= 5 && earlyCool && wx.max >= 32) { score += 0.35; notes.push('Early start beats the midday heat') }
  if (p.cat === 'religious' && (earlyCool || t >= wx.sunset - 60)) score += 0.2
  return { score, notes, wx: stopWx, skip }
}

const TAG_WORD: Record<string, string> = { kids: 'kids', nightlife: 'evenings out', photography: 'photography', art: 'art', beach: 'beaches' }
function whyText(p: Place, w: Record<string, number>, start: number, extra: string[] = []) {
  const liked = p.tags.filter((t) => (w[t] ?? 0) >= 0.5).sort((x, y) => (w[y] ?? 0) - (w[x] ?? 0)).map((t) => TAG_WORD[t] ?? t)
  const best = p.best?.length && start >= toMin(p.best[0]) && start < toMin(p.best[1]) ? `Best time: ${p.best[2]}` : ''
  const fame = p.must ? 'A must-see here' : (p.rating ?? 0) >= 5 ? 'One of the best-known sights' : ''
  return [liked.length ? `You picked ${liked.slice(0, 2).join(' & ')}` : '', fame, best, ...extra.slice(0, 1)].filter(Boolean).join(' · ') || p.desc
}

const whoWanted = (p: Place, votes: Merged['votes']) => [...new Set(p.tags.flatMap((t) => votes?.[t as Tag] ?? []))]

const PACE = { 1: { visits: 3, end: 20 * 60 }, 2: { visits: 5, end: 21 * 60 }, 3: { visits: 7, end: 22 * 60 } } as const

export function partySize(a: Merged, groupSize = 1) {
  if (groupSize > 1) return groupSize
  return { solo: 1, couple: 2, friends: 3, kids: 3, seniors: 3 }[a.party ?? 'solo']
}

/** Can this visit be scheduled for these travellers? */
function suitable(p: Place, a: Merged) {
  if (isFood(p)) return false
  const limited = a.effort === 'low' || a.party === 'seniors'
  if (limited && (p.intensity >= 7 || (p.stairs && p.intensity >= 5))) return false
  if (p.adult && (a.party === 'kids' || a.party === 'seniors')) return false
  if (p.night && a.evening === 'early') return false
  if (p.dwell > 300) return (a.days ?? 1) >= 3 // full-day outings only on longer trips
  return true
}

const firstWord = (n: string) => n.toLowerCase().replace(/^(the|sri|shri)\s+/, '').split(/[\s,'’-]+/)[0]
/** Another planned visit within a kilometre that shares the first word of its name. */
function sameSpot(p: Place, all: Place[], used: Set<string>) {
  const w = firstWord(p.name)
  if (w.length < 5) return false
  return all.some((q) => q.id !== p.id && used.has(q.id) && !isFood(q) && firstWord(q.name) === w && haversine(p, q) < 1)
}

/** Repeating a kind of place in one day gets old fast: the third temple of the day is a hard sell. */
const REPEAT: Record<string, number> = { religious: 0.55, heritage: 0.3, museum: 0.45, market: 0.5, nature: 0.3, beach: 0.5, viewpoint: 0.4, entertainment: 0.5, show: 0.6 }

const poolOf = (trip: Pick<Trip, 'places' | 'city'>) => trip.places ?? PLACES.filter((p) => p.city === trip.city)
export const placeOf = (trip: Pick<Trip, 'places'>, id: string) => trip.places?.find((p) => p.id === id) ?? BY_ID.get(id)
/** @deprecated use placeOf(trip, id) — kept for sample-data callers */
export const placeById = (id: string) => BY_ID.get(id)

export function generateBasic(a: Merged, groupSize = 1, ctx?: PlanContext): Trip {
  const city = a.city ?? 'hyderabad'
  const days = Math.min(Math.max(a.days ?? 2, 1), MAX_TRIP_DAYS)
  const start = a.start ?? new Date().toISOString().slice(0, 10)
  const pace = PACE[(a.pace ?? 2) as 1 | 2 | 3] ?? PACE[2]
  const dayStart = a.morning === 'late' ? 10 * 60 : 8 * 60
  // families with small children and seniors call it a day earlier
  const family = a.party === 'kids' || a.party === 'seniors'
  // night owls (city lights, parties, bonfires) stay out late; families and early sleepers are back by nine
  const dayEnd = a.evening === 'early' || family ? Math.min(pace.end, 21 * 60) : a.evening === 'nightlife' ? Math.max(pace.end, 23 * 60 + 30) : pace.end
  const visitsPerDay = a.party === 'seniors' ? Math.min(pace.visits, 4) : pace.visits
  const party = partySize(a, groupSize)
  const budget = a.budget ? a.budget : null
  const w = weights(a, ctx?.boost)
  const cityPlaces = ctx?.places ?? PLACES.filter((p) => p.city === city)
  const base = ctx?.base
  const used = new Set<string>()
  const out: Day[] = []
  // group fairness: how many stops so far matched each member's own picks
  const members = [...new Set(Object.values(a.votes ?? {}).flat())]
  const served = new Map<string, number>(members.map((m) => [m, 0]))
  const tripCats = new Map<string, number>()
  // breakfast out only for travellers who care about food; everyone else eats at the hotel
  const breakfastOut = (a.interests ?? []).includes('food') || a.food === 'street'

  for (let d = 0; d < days; d++) {
    const wd = weekday(start, d)
    const date = dateOf(start, d)
    const wx = ctx?.weather?.[date]
    const stops: Stop[] = []
    let t = dayStart
    let here: { lat: number; lon: number } | null = base ?? null
    let spent = 0
    let visits = 0
    let breakfast = !breakfastOut, lunch = false, dinner = false
    const dayCats = new Map<string, number>()
    // one dusk slot kept for travellers who asked for aarti / city lights in the evening
    let duskSlot = a.evening === 'spiritual' || a.evening === 'nightlife'
    const dusk = Math.max(16 * 60 + 30, (wx?.sunset ?? 18 * 60) - 75)
    const add = (p: Place, at: number, kind: Stop['kind'], tr: Stop['travel']) => {
      const cond = conditions(p, wx, at, p.dwell)
      const check = ctx?.checks?.[p.id]
      const boostedTag = p.tags.find((tg) => (ctx?.boost?.[tg] ?? 0) > 0.05)
      const notes = [...cond.notes, ...(ctx && kind === 'visit' && (p.hoursKnown === false || (p.open === undefined && !p.hours.length)) ? ['Typical hours used — check the official timings before going'] : [])]
      const who = whoWanted(p, a.votes)
      stops.push({
        placeId: p.id, name: p.name, kind, start: at, end: at + p.dwell, cost: p.cost, travel: tr,
        why: kind === 'meal' ? p.desc : whyText(p, w, at, cond.notes.filter((n) => /Golden|Early|Indoor/.test(n))),
        who, wx: cond.wx, notes, check,
        boosted: boostedTag ? ctx?.boostWhy?.[boostedTag] : undefined,
      })
      if (kind === 'visit' && p.tags.includes('food') && at >= 18 * 60) dinner = true // a beach-shack dinner or a food walk is dinner
      if (kind === 'visit') {
        for (const m of who) served.set(m, (served.get(m) ?? 0) + 1)
        dayCats.set(p.cat, (dayCats.get(p.cat) ?? 0) + 1)
        tripCats.set(p.cat, (tripCats.get(p.cat) ?? 0) + 1)
      }
      spent += p.cost + (tr?.fare ?? 0)
      used.add(p.id)
      here = p
      t = at + p.dwell
    }
    const meal = (which: 'breakfast' | 'lunch' | 'dinner') => {
      const options = cityPlaces
        .filter((p) => p.meal?.includes(which) && dietOk(p, a.diet ?? 0) && !used.has(p.id))
        .map((p) => {
          const tr = here ? travel(here, p, party, a.getaround) : null
          const at = openAt(p, t + (tr?.min ?? 0), wd, date)
          // street-food fans: cheap and local; sit-down: trusted, well-known places
          const style = a.food === 'street' ? -p.cost / 250 : p.cost >= 250 ? 0.3 : 0
          const known = Math.min(p.rating ?? 2, 7) * 0.45 + (p.must ? 0.8 : 0)
          const chain = (p.rating ?? 2) < 1 ? 1.2 : 0 // chains only when nothing local is near
          return { p, tr, at, score: known + style - chain - (tr?.min ?? 0) / 15 }
        })
        .filter((o) => o.at !== null && (!budget || spent + o.p.cost + (o.tr?.fare ?? 0) <= budget))
        .sort((x, y) => y.score - x.score)
      const best = options[0]
      // breakfast is worth a short hop, not a cross-town ride: otherwise eat at the hotel
      if (which === 'breakfast' && best?.tr && best.tr.min > 20) return false
      if (best) add(best.p, best.at!, 'meal', best.tr)
      return !!best
    }
    const fairness = (p: Place) => {
      if (members.length < 2) return 0
      const who = whoWanted(p, a.votes)
      // members who have had the fewest of their own picks so far count the most
      return (0.45 * who.reduce((s, m) => s + 1 / (1 + (served.get(m) ?? 0)), 0)) / members.length
    }

    while (t < dayEnd) {
      if (!breakfast) { breakfast = true; if (meal('breakfast')) continue }
      if (!lunch && t >= 12 * 60 + 30) { lunch = true; if (meal('lunch')) continue }
      if (!dinner && t >= 19 * 60 && t + 45 <= dayEnd + 60) { dinner = true; if (meal('dinner')) continue }
      if (visits >= visitsPerDay) {
        if (duskSlot && dayEnd > dusk + 60) { duskSlot = false; t = Math.max(t, dusk); visits = visitsPerDay - 1; continue }
        if (!dinner && dayEnd >= 20 * 60) { t = Math.max(t, 19 * 60); continue }
        break
      }
      const options = cityPlaces
        .filter((p) => !used.has(p.id) && suitable(p, a) && ctx?.checks?.[p.id]?.verdict !== 'avoid')
        .map((p) => {
          const tr = here ? travel(here, p, party, a.getaround) : null
          const at = openAt(p, t + (tr?.min ?? 0), wd, date)
          if (at === null || at + p.dwell > dayEnd) return null
          if (p.night && at < 17 * 60) return null
          // the same spot under two names (a lake and its bridge, a fort and its gate): one is enough
          if (sameSpot(p, cityPlaces, used)) return null
          if (budget && spent + p.cost + (tr?.fare ?? 0) > budget) return null
          const cond = conditions(p, wx, at, p.dwell)
          if (cond.skip) return null
          const inBest = p.best?.length && at >= toMin(p.best[0]) && at < toMin(p.best[1]) ? 0.35 : 0
          const eveningOnly = p.best?.length && toMin(p.best[0]) >= 17 * 60 && at < 16 * 60 ? 1 : 0
          const caution = ctx?.checks?.[p.id]?.verdict === 'caution' ? 0.3 : 0
          const repeat = (dayCats.get(p.cat) ?? 0) * (REPEAT[p.cat] ?? 0.3) + (tripCats.get(p.cat) ?? 0) * 0.05
          const score = interestScore(p, w) + fairness(p) + inBest + cond.score - repeat - eveningOnly - caution - (tr?.min ?? 0) / 40 - (at - t - (tr?.min ?? 0)) / 90
          return { p, tr, at, score }
        })
        .filter((o): o is NonNullable<typeof o> => !!o)
        .sort((x, y) => y.score - x.score)
      const best = options[0]
      if (!best) {
        // nothing open right now: jump to the next real opening among the remaining places
        const opens = cityPlaces.filter((p) => !used.has(p.id) && suitable(p, a)).map((p) => nextOpen(p, Math.max(t, p.night ? 17 * 60 : 0), wd, date)).filter((x): x is number => x !== null && x > t && x < dayEnd)
        const soonest = opens.length ? Math.min(...opens) : null
        if (soonest !== null && (lunch || soonest < 12 * 60 + 30)) { t = soonest; continue }
        if (!lunch && t < 12 * 60 + 30) { t = 12 * 60 + 30; continue }
        if (!dinner && t < 19 * 60 && dayEnd >= 20 * 60) { t = 19 * 60; continue }
        break
      }
      add(best.p, best.at, 'visit', best.tr)
      visits++
    }
    const back = base && here && here !== base ? travel(here, base, party, a.getaround) : undefined
    const note = visits === 0 ? 'A free day: nothing new is left within reach. Rest, shop, or ask Tripzy AI for a day trip.' : undefined
    out.push({ date, stops, wx: wx ? { max: Math.round(wx.max), rain: wx.rainMax, code: wx.code[13] ?? 0 } : undefined, ...(back ? { back } : {}), ...(note ? { note } : {}) })
  }

  const cityName = ctx?.center?.name ?? CITIES[city]?.name ?? city
  // keep only the places a user can reach from this trip (used + candidates) so the saved trip stays small
  const spare = cityPlaces.filter((p) => !used.has(p.id))
  // the most visited places stay in the trip even when the answers left them out, so they can be added later
  const top = topOf(cityPlaces)
  const spareSights = spare.filter((p) => !isFood(p)).sort((x, y) => interestScore(y, w) - interestScore(x, w)).slice(0, 60)
  for (const id of top) if (!used.has(id) && !spareSights.some((x) => x.id === id)) spareSights.push(cityPlaces.find((x) => x.id === id)!)
  const spareFood = spare.filter(isFood).sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0)).slice(0, 40)
  const pool = ctx ? cityPlaces.filter((p) => used.has(p.id)).concat(spareSights, spareFood) : undefined
  return {
    title: `${cityName}, ${days} day${days > 1 ? 's' : ''}`,
    city, start, dayStart, dayEnd, party, budgetPerDay: budget, days: out, source: ctx ? 'live' : 'basic', answers: a,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...(ctx ? { places: pool, weather: ctx.weather, center: ctx.center, sources: ctx.sources, boost: ctx.boost, boostWhy: ctx.boostWhy } : {}),
    ...(base ? { base } : {}), ...(ctx?.profile ? { profile: ctx.profile } : {}), ...(top.length ? { top } : {}),
  }
}

export const describeWx = (code: number) => WX_WORD[code] ?? 'cloudy'

/** Recompute times, travel and live conditions for one day after an edit; flag stops that end up closed. */
export function retime(trip: Trip, dayIndex: number): Trip {
  const day = trip.days[dayIndex]
  const wd = weekday(trip.start, dayIndex)
  const wx = trip.weather?.[day.date]
  let t = trip.dayStart
  let prev: { lat: number; lon: number } | null = trip.base ?? null
  const stops = day.stops.map((s) => {
    const p = placeOf(trip, s.placeId)
    if (!p) return s
    const tr = prev ? travel(prev, p, trip.party, trip.answers.getaround) : null
    const arrive = t + (tr?.min ?? 0)
    const at = openAt(p, arrive, wd, day.date)
    const start = at ?? arrive
    t = start + p.dwell
    prev = p
    const cond = conditions(p, wx, start, p.dwell)
    return { ...s, start, end: t, travel: tr, wx: cond.wx ?? s.wx, notes: wx ? cond.notes : s.notes, warn: at === null ? 'May be closed at this time — move it or swap it' : undefined }
  })
  const back = trip.base && prev && prev !== trip.base ? travel(prev, trip.base, trip.party, trip.answers.getaround) : undefined
  const days = trip.days.map((d, i) => (i === dayIndex ? { ...d, stops, back } : d))
  return { ...trip, days, updatedAt: Date.now() }
}

export const stopTotal = (s: Stop) => s.cost + (s.travel?.fare ?? 0)
export const dayTotal = (d: Day) => d.stops.reduce((a, s) => a + stopTotal(s), 0)
export const tripTotal = (t: Trip) => t.days.reduce((a, d) => a + dayTotal(d), 0)

/** Suggested swaps: unused places of the same kind that fit that slot (and the weather). */
export function alternatives(trip: Trip, dayIndex: number, stopIndex: number): Place[] {
  const day = trip.days[dayIndex]
  const s = day.stops[stopIndex]
  const cur = placeOf(trip, s.placeId)
  if (!cur) return []
  const used = new Set(trip.days.flatMap((d) => d.stops.map((x) => x.placeId)))
  const wd = weekday(trip.start, dayIndex)
  const w = weights(trip.answers, trip.boost)
  const wx = trip.weather?.[day.date]
  const score = (p: Place) => interestScore(p, w) + conditions(p, wx, s.start, p.dwell).score - haversine(cur, p) / 20
  return poolOf(trip).filter((p) => !used.has(p.id))
    .filter((p) => (s.kind === 'meal' ? isFood(p) && dietOk(p, trip.answers.diet ?? 0) : suitable(p, trip.answers)))
    .filter((p) => openAt(p, s.start, wd, day.date) !== null)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3)
}

/** The most visited places of a destination: its must-sees first, then the best known by fame. */
function topOf(places: Place[], n = 10): string[] {
  return places.filter((p) => !isFood(p) && (p.must || (p.rating ?? 0) >= 4.5))
    .sort((a, b) => Number(!!b.must) - Number(!!a.must) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, n).map((p) => p.id)
}

export type TopSight = { place: Place; day: number | null; why: string }
/**
 * The most visited places with where they sit in the plan, or a plain reason they are not in it
 * (the answers did not pick that kind of place, it needs a longer trip, it is not for this group).
 */
export function topSights(trip: Trip): TopSight[] {
  const ids = trip.top ?? topOf(poolOf(trip))
  const w = weights(trip.answers, trip.boost)
  const dayOf = (id: string) => { const i = trip.days.findIndex((d) => d.stops.some((s) => s.placeId === id)); return i < 0 ? null : i }
  const picked = (trip.answers.interests ?? []).slice(0, 3).join(', ')
  return ids.map((id) => placeOf(trip, id)).filter((p): p is Place => !!p).map((p) => {
    const day = dayOf(p.id)
    let why = ''
    if (day === null) {
      if (!suitable(p, trip.answers)) why = p.adult ? 'Not planned: not suited to children or seniors.' : p.dwell > 300 ? 'Not planned: a full-day outing — add it to a day you keep free.' : 'Not planned: a steep or tiring visit for this group.'
      else if (match(p, w) < 0.5) why = `Not planned: it does not match what you picked${picked ? ` (${picked})` : ''}. Add it if you'd like to see it anyway.`
      else why = 'Not planned: the days were already full of places you picked. Add it or swap it in.'
    }
    return { place: p, day, why }
  })
}

/**
 * Add a place to a day where it costs the least extra travel (meals keep their slots), then re-time
 * the day. Opening hours are re-checked; a stop that no longer fits is flagged, never dropped.
 */
export function addStop(trip: Trip, dayIndex: number, p: Place): Trip {
  const day = trip.days[dayIndex]
  const w = weights(trip.answers, trip.boost)
  const stop: Stop = { placeId: p.id, name: p.name, kind: 'visit', start: 0, end: 0, cost: p.cost, travel: null, why: whyText(p, w, 12 * 60), who: whoWanted(p, trip.answers.votes) }
  const pts = [trip.base ?? null, ...day.stops.map((s) => placeOf(trip, s.placeId) ?? null)]
  let bestAt = day.stops.length, bestCost = Infinity
  for (let i = 0; i <= day.stops.length; i++) {
    const a = pts[i], b = i < day.stops.length ? pts[i + 1] : trip.base ?? null
    const extra = (a ? haversine(a, p) : 0) + (b ? haversine(p, b) : 0) - (a && b ? haversine(a, b) : 0)
    if (extra < bestCost) { bestCost = extra; bestAt = i }
  }
  const stops = [...day.stops.slice(0, bestAt), stop, ...day.stops.slice(bestAt)]
  const pool = trip.places && !trip.places.some((x) => x.id === p.id) ? [...trip.places, p] : trip.places
  const days = trip.days.map((d, i) => (i === dayIndex ? { ...d, stops, note: undefined } : d))
  return retime({ ...trip, places: pool, days }, dayIndex)
}

export function swapStop(trip: Trip, dayIndex: number, stopIndex: number, p: Place): Trip {
  const w = weights(trip.answers, trip.boost)
  const days = trip.days.map((d, i) =>
    i !== dayIndex ? d : {
      ...d,
      stops: d.stops.map((s, j) => (j !== stopIndex ? s : { ...s, placeId: p.id, name: p.name, cost: p.cost, why: s.kind === 'meal' ? p.desc : whyText(p, w, s.start), who: whoWanted(p, trip.answers.votes), check: undefined })),
    },
  )
  const pool = trip.places && !trip.places.some((x) => x.id === p.id) ? [...trip.places, p] : trip.places
  return retime({ ...trip, places: pool, days }, dayIndex)
}

export function moveStop(trip: Trip, dayIndex: number, stopIndex: number, dir: -1 | 1): Trip {
  const stops = [...trip.days[dayIndex].stops]
  const j = stopIndex + dir
  if (j < 0 || j >= stops.length) return trip
  ;[stops[stopIndex], stops[j]] = [stops[j], stops[stopIndex]]
  return retime({ ...trip, days: trip.days.map((d, i) => (i === dayIndex ? { ...d, stops } : d)) }, dayIndex)
}

export function removeStop(trip: Trip, dayIndex: number, stopIndex: number): Trip {
  const days = trip.days.map((d, i) => (i === dayIndex ? { ...d, stops: d.stops.filter((_, j) => j !== stopIndex) } : d))
  return retime({ ...trip, days }, dayIndex)
}

/** Light shape check for a plan that came back from the API server. */
export function isTrip(x: unknown): x is Trip {
  const t = x as Trip
  return !!t && typeof t.title === 'string' && Array.isArray(t.days) && t.days.every((d) => Array.isArray(d.stops))
}
