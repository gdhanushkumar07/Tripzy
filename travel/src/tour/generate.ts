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
import type { Merged, Tag } from './questions'

export type Place = {
  id: string; city: string; name: string; lat: number; lon: number; cat: string; tags: string[]
  hours: string[][]; closed: number[]; dwell: number; intensity: number; cost: number; best: string[]; desc: string
  diet?: string; meal?: string[]; slot?: string[]; indoor: boolean; stairs: boolean
  /** live only: opening intervals per ISO date as flat minute pairs [open, close, open, close…] (Firestore has no nested arrays) */
  open?: Record<string, number[]>
  rating?: number; wikidata?: string; website?: string; source?: string; image?: string
  /** false when `open` holds typical category hours, not published ones */
  hoursKnown?: boolean
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
export type Day = { date: string; stops: Stop[]; wx?: { max: number; rain: number; code: number } }
export type Trip = {
  title: string; city: string; start: string; dayStart: number; dayEnd: number; party: number
  budgetPerDay: number | null; days: Day[]; source: 'basic' | 'ai' | 'live'; answers: Merged; groupCode?: string
  createdAt: number; updatedAt: number
  /** live trips carry their own place pool + weather so edits re-check offline */
  places?: Place[]; weather?: Record<string, DayWx>; center?: { name: string; lat: number; lon: number }
  sources?: string[]; boost?: Record<string, number>; boostWhy?: Record<string, string>
}
export type PlanContext = {
  places: Place[]; weather?: Record<string, DayWx>; center?: Trip['center']; sources?: string[]
  checks?: Record<string, LiveCheck>; boost?: Record<string, number>; boostWhy?: Record<string, string>
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

export function weights(a: Merged, boost?: Record<string, number>): Record<string, number> {
  const w: Record<string, number> = {}
  const ranked = a.interests ?? []
  ranked.forEach((t, i) => (w[t] = 1 - i * (0.5 / Math.max(ranked.length, 1))))
  if (a.evening === 'spiritual') w.spiritual = Math.max(w.spiritual ?? 0, 0.7)
  if (a.evening === 'nightlife') w.nightlife = Math.max(w.nightlife ?? 0, 0.7)
  if (a.effort === 'high') w.adventure = Math.max(w.adventure ?? 0, 0.5)
  if (a.party === 'kids') w.kids = Math.max(w.kids ?? 0, 0.8)
  for (const [t, b] of Object.entries(boost ?? {})) w[t] = Math.max(0, Math.min(1.3, (w[t] ?? 0.15) + b))
  return w
}

function interestScore(p: Place, w: Record<string, number>) {
  const v = p.tags.map((t) => w[t] ?? 0.15).sort((x, y) => y - x)
  return (v[0] ?? 0) + 0.3 * (v[1] ?? 0) + (p.rating ? Math.min(p.rating, 7) * 0.04 : 0)
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

function whyText(p: Place, w: Record<string, number>, start: number, extra: string[] = []) {
  const liked = p.tags.filter((t) => (w[t] ?? 0) >= 0.5)
  const best = p.best?.length && start >= toMin(p.best[0]) && start < toMin(p.best[1]) ? `Best time: ${p.best[2]}` : ''
  return [liked.length ? `Matches ${liked.slice(0, 2).join(' & ')}` : '', best, ...extra.slice(0, 1)].filter(Boolean).join(' · ') || p.desc
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
  if (p.dwell > 300) return (a.days ?? 1) >= 3 // full-day outings only on longer trips
  return true
}

const poolOf = (trip: Pick<Trip, 'places' | 'city'>) => trip.places ?? PLACES.filter((p) => p.city === trip.city)
export const placeOf = (trip: Pick<Trip, 'places'>, id: string) => trip.places?.find((p) => p.id === id) ?? BY_ID.get(id)
/** @deprecated use placeOf(trip, id) — kept for sample-data callers */
export const placeById = (id: string) => BY_ID.get(id)

export function generateBasic(a: Merged, groupSize = 1, ctx?: PlanContext): Trip {
  const city = a.city ?? 'hyderabad'
  const days = Math.min(Math.max(a.days ?? 2, 1), 5)
  const start = a.start ?? new Date().toISOString().slice(0, 10)
  const pace = PACE[(a.pace ?? 2) as 1 | 2 | 3] ?? PACE[2]
  const dayStart = a.morning === 'late' ? 10 * 60 : 8 * 60
  const dayEnd = a.evening === 'early' ? Math.min(pace.end, 21 * 60) : pace.end
  const party = partySize(a, groupSize)
  const budget = a.budget ? a.budget : null
  const w = weights(a, ctx?.boost)
  const cityPlaces = ctx?.places ?? PLACES.filter((p) => p.city === city)
  const used = new Set<string>()
  const out: Day[] = []

  for (let d = 0; d < days; d++) {
    const wd = weekday(start, d)
    const date = dateOf(start, d)
    const wx = ctx?.weather?.[date]
    const stops: Stop[] = []
    let t = dayStart
    let here: Place | null = null
    let spent = 0
    let visits = 0
    let lunch = false, dinner = false
    // one dusk slot kept for travellers who asked for aarti / city lights in the evening
    let duskSlot = a.evening === 'spiritual' || a.evening === 'nightlife'
    const dusk = Math.max(16 * 60 + 30, (wx?.sunset ?? 18 * 60) - 75)
    const add = (p: Place, at: number, kind: Stop['kind'], tr: Stop['travel']) => {
      const cond = conditions(p, wx, at, p.dwell)
      const check = ctx?.checks?.[p.id]
      const boostedTag = p.tags.find((tg) => (ctx?.boost?.[tg] ?? 0) > 0.05)
      const notes = [...cond.notes, ...(ctx && kind === 'visit' && (p.hoursKnown === false || (p.open === undefined && !p.hours.length)) ? ['Typical hours used — check the official timings before going'] : [])]
      stops.push({
        placeId: p.id, name: p.name, kind, start: at, end: at + p.dwell, cost: p.cost, travel: tr,
        why: kind === 'meal' ? p.desc : whyText(p, w, at, cond.notes.filter((n) => /Golden|Early|Indoor/.test(n))),
        who: whoWanted(p, a.votes), wx: cond.wx, notes, check,
        boosted: boostedTag ? ctx?.boostWhy?.[boostedTag] : undefined,
      })
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
          const style = a.food === 'street' ? -p.cost / 100 : p.cost >= 250 ? 0.5 : 0
          return { p, tr, at, score: style - (tr?.min ?? 0) / 15 }
        })
        .filter((o) => o.at !== null && (!budget || spent + o.p.cost + (o.tr?.fare ?? 0) <= budget))
        .sort((x, y) => y.score - x.score)
      const best = options[0]
      if (best) add(best.p, best.at!, 'meal', best.tr)
      return !!best
    }

    while (t < dayEnd) {
      if (!lunch && t >= 12 * 60 + 30) { lunch = true; if (meal('lunch')) continue }
      if (!dinner && t >= 19 * 60 && t + 45 <= dayEnd + 60) { dinner = true; if (meal('dinner')) continue }
      if (visits >= pace.visits) {
        if (duskSlot && dayEnd > dusk + 60) { duskSlot = false; t = Math.max(t, dusk); visits = pace.visits - 1; continue }
        if (!dinner && dayEnd >= 20 * 60) { t = Math.max(t, 19 * 60); continue }
        break
      }
      const options = cityPlaces
        .filter((p) => !used.has(p.id) && suitable(p, a) && ctx?.checks?.[p.id]?.verdict !== 'avoid')
        .map((p) => {
          const tr = here ? travel(here, p, party, a.getaround) : null
          const at = openAt(p, t + (tr?.min ?? 0), wd, date)
          if (at === null || at + p.dwell > dayEnd) return null
          if (budget && spent + p.cost + (tr?.fare ?? 0) > budget) return null
          const cond = conditions(p, wx, at, p.dwell)
          if (cond.skip) return null
          const inBest = p.best?.length && at >= toMin(p.best[0]) && at < toMin(p.best[1]) ? 0.35 : 0
          const eveningOnly = p.best?.length && toMin(p.best[0]) >= 17 * 60 && at < 16 * 60 ? 0.5 : 0
          const caution = ctx?.checks?.[p.id]?.verdict === 'caution' ? 0.3 : 0
          const score = interestScore(p, w) + inBest + cond.score - eveningOnly - caution - (tr?.min ?? 0) / 40 - (at - t - (tr?.min ?? 0)) / 90
          return { p, tr, at, score }
        })
        .filter((o): o is NonNullable<typeof o> => !!o)
        .sort((x, y) => y.score - x.score)
      const best = options[0]
      if (!best) {
        // nothing open right now: jump to the next real opening among the remaining places
        const opens = cityPlaces.filter((p) => !used.has(p.id) && suitable(p, a)).map((p) => nextOpen(p, t, wd, date)).filter((x): x is number => x !== null && x > t && x < dayEnd)
        const soonest = opens.length ? Math.min(...opens) : null
        if (soonest !== null && (lunch || soonest < 12 * 60 + 30)) { t = soonest; continue }
        if (!lunch && t < 12 * 60 + 30) { t = 12 * 60 + 30; continue }
        if (!dinner && t < 19 * 60 && dayEnd >= 20 * 60) { t = 19 * 60; continue }
        break
      }
      add(best.p, best.at, 'visit', best.tr)
      visits++
    }
    out.push({ date, stops, wx: wx ? { max: Math.round(wx.max), rain: wx.rainMax, code: wx.code[13] ?? 0 } : undefined })
  }

  const cityName = ctx?.center?.name ?? CITIES[city]?.name ?? city
  // keep only the places a user can reach from this trip (used + candidates) so the saved trip stays small
  const pool = ctx ? cityPlaces.filter((p) => used.has(p.id)).concat(cityPlaces.filter((p) => !used.has(p.id)).slice(0, 60)) : undefined
  return {
    title: `${cityName}, ${days} day${days > 1 ? 's' : ''}`,
    city, start, dayStart, dayEnd, party, budgetPerDay: budget, days: out, source: ctx ? 'live' : 'basic', answers: a,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...(ctx ? { places: pool, weather: ctx.weather, center: ctx.center, sources: ctx.sources, boost: ctx.boost, boostWhy: ctx.boostWhy } : {}),
  }
}

export const describeWx = (code: number) => WX_WORD[code] ?? 'cloudy'

/** Recompute times, travel and live conditions for one day after an edit; flag stops that end up closed. */
export function retime(trip: Trip, dayIndex: number): Trip {
  const day = trip.days[dayIndex]
  const wd = weekday(trip.start, dayIndex)
  const wx = trip.weather?.[day.date]
  let t = trip.dayStart
  let prev: Place | null = null
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
  const days = trip.days.map((d, i) => (i === dayIndex ? { ...d, stops } : d))
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

export function swapStop(trip: Trip, dayIndex: number, stopIndex: number, p: Place): Trip {
  const w = weights(trip.answers, trip.boost)
  const days = trip.days.map((d, i) =>
    i !== dayIndex ? d : {
      ...d,
      stops: d.stops.map((s, j) => (j !== stopIndex ? s : { ...s, placeId: p.id, name: p.name, cost: p.cost, why: s.kind === 'meal' ? p.desc : whyText(p, w, s.start), who: whoWanted(p, trip.answers.votes), check: undefined })),
    },
  )
  return retime({ ...trip, days }, dayIndex)
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
