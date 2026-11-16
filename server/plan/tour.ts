/** Live tourist planner: real places + real weather + opening hours + optional AI web check → itinerary. */
import OpeningHours from 'opening_hours'
import { destinationFor, type Destination, type Spot } from '../../src/tour/destinations'
import { dateOf, generateBasic, type Base, type DayWx, type LiveCheck, type Place, type Trip } from '../../src/tour/generate'
import { MAX_TRIP_DAYS, type Merged } from '../../src/tour/questions'
import { haversineKm } from '../lib'
import { aiEnabled, liveCheck } from '../providers/ai'
import { geocode } from '../providers/geo'
import { fame, placesAround, popularity, wikiSummary, type LivePlace } from '../providers/places'
import { weather } from '../providers/weather'

export type TourQuery = {
  answers: Merged; groupSize?: number
  place: { name: string; lat: number; lon: number; state?: string }
  boost?: Record<string, number>; boostWhy?: Record<string, string>
  /** the hotel the travellers picked: every day starts and ends there */
  base?: Base
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const CAT_DESC: Record<string, string> = {
  heritage: 'Heritage site', museum: 'Museum', religious: 'Place of worship', viewpoint: 'Viewpoint', nature: 'Park and nature',
  entertainment: 'Family attraction', market: 'Market', show: 'Show or performance', attraction: 'Attraction', food: 'Restaurant', cafe: 'Café',
  beach: 'Beach', activity: 'Activity', nightlife: 'Nightlife',
}

/** OSM opening_hours → minute intervals for one local date (null when unparseable). */
function intervalsFor(hours: string, date: string, p: { lat: number; lon: number }): [number, number][] | null {
  try {
    const oh = new OpeningHours(hours, { lat: p.lat, lon: p.lon, address: { country_code: 'in', state: '' } }, { mode: 0 } as never)
    const from = new Date(`${date}T00:00:00`), to = new Date(`${date}T23:59:59`)
    return oh.getOpenIntervals(from, to).map(([a, b]) => [a.getHours() * 60 + a.getMinutes(), b.getDate() !== a.getDate() ? 24 * 60 : b.getHours() * 60 + b.getMinutes()])
  } catch { return null }
}

function toPlace(l: LivePlace, city: string, dates: string[]): Place {
  const open: Record<string, number[]> = {}
  if (l.hours) for (const d of dates) { const iv = intervalsFor(l.hours, d, l); if (iv) open[d] = iv.flat() }
  const typical = !Object.keys(open).length && TYPICAL[l.cat]
  if (typical) for (const d of dates) open[d] = typical
  return {
    id: l.id, city, name: l.name, lat: l.lat, lon: l.lon, cat: l.cat, tags: l.tags,
    hours: [], closed: [], dwell: l.dwell, intensity: l.intensity, cost: l.cost, best: [], desc: l.desc ? l.desc.charAt(0).toUpperCase() + l.desc.slice(1) : CAT_DESC[l.cat] ?? 'Place to visit',
    diet: l.diet, meal: l.meal, indoor: l.indoor, stairs: l.intensity >= 7,
    open: Object.keys(open).length ? open : undefined, hoursKnown: !typical, rating: l.rating, wikidata: l.wikidata, website: l.website, source: l.source, image: l.image,
  }
}

/** Typical opening hours by category (minutes), used only when OpenStreetMap has none — flagged in the plan. */
const TYPICAL: Record<string, number[]> = {
  heritage: [9 * 60, 17 * 60 + 30], museum: [10 * 60, 17 * 60], religious: [6 * 60, 12 * 60 + 30, 16 * 60, 21 * 60], nature: [6 * 60, 18 * 60 + 30],
  entertainment: [10 * 60, 18 * 60], market: [10 * 60 + 30, 21 * 60 + 30], show: [10 * 60, 21 * 60], viewpoint: [5 * 60, 22 * 60], attraction: [9 * 60, 18 * 60],
  food: [8 * 60, 23 * 60], cafe: [8 * 60, 22 * 60 + 30],
  beach: [5 * 60, 24 * 60], activity: [7 * 60, 18 * 60], nightlife: [18 * 60, 24 * 60],
}

/** Loose name match: "Golconda Fort" ~ "Golconda", "Charminar" ~ "The Charminar". */
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/\b(the|of|and|sri|shri)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const sameName = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y))) }

const weekdayOf = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7
/** Opening intervals per trip date, leaving out weekdays the spot does not run (a Saturday-only market). */
const openOn = (s: Spot, dates: string[], hours: number[]) => Object.fromEntries(dates.filter((d) => !s.days || s.days.includes(weekdayOf(d))).map((d) => [d, hours]))
const closedOn = (s: Spot) => (s.days ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !s.days!.includes(d)) : [])

/** Run async jobs a few at a time (public geocoders throttle bursts). */
async function limited<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}
const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

/**
 * Fold in what Tripzy knows about the destination: must-sees already on the map are marked (with their
 * best time of day and real visit length); missing ones and the experiences people come for (Goa's
 * water sports, beach bonfires and clubs) are located and added; the restaurants visitors seek out are
 * marked as signature food. Typical hours are flagged as such in the plan.
 */
async function applyProfile(places: Place[], d: Destination, center: { lat: number; lon: number; name: string }, dates: string[], city: string, maxKm: number) {
  const spotPlace = (s: Spot, at: { lat: number; lon: number }, must: boolean): Place => ({
    id: `dest:${d.id}:${norm(s.name).replace(/ /g, '-')}`, city, name: s.name, lat: at.lat, lon: at.lon, cat: s.cat,
    tags: s.tags, hours: [], dwell: s.dwell, intensity: s.intensity ?? 3, cost: s.cost ?? 0, best: s.best ?? [], desc: CAT_DESC[s.cat] ?? 'Experience',
    indoor: !!s.indoor, stairs: (s.intensity ?? 3) >= 7, open: openOn(s, dates, TYPICAL[s.cat] ?? TYPICAL.attraction), hoursKnown: false,
    closed: closedOn(s), rating: must ? 6.5 : 5.5, must, night: s.night, adult: s.adult || s.cat === 'nightlife', source: 'Tripzy destination guide',
  })
  const upgrade = (p: Place, s: Spot, must: boolean) => {
    p.must = p.must || must
    p.tags = [...new Set([...s.tags, ...p.tags])]
    p.rating = Math.max(p.rating ?? 0, must ? 6.5 : 5.5)
    p.dwell = s.dwell
    if (s.best) p.best = s.best
    if (s.cost != null) p.cost = s.cost
    if (s.night) p.night = true
    if (s.adult || s.cat === 'nightlife') p.adult = true
    if (s.days) { p.closed = closedOn(s); if (p.open) p.open = openOn(s, dates, p.open[dates[0]] ?? TYPICAL[s.cat] ?? TYPICAL.attraction) }
    if (s.intensity != null) { p.intensity = s.intensity; p.stairs = s.intensity >= 7 }
  }
  const spots = [...d.musts.map((s) => [s, true] as const), ...d.experiences.map((s) => [s, false] as const)]
  const missing: (readonly [Spot, boolean])[] = []
  for (const [s, must] of spots) {
    const hit = places.find((p) => p.cat !== 'food' && p.cat !== 'cafe' && (sameName(p.name, s.name) || (!!s.q && sameName(p.name, s.q))) && haversineKm(center, p) <= maxKm)
    if (hit) upgrade(hit, s, must)
    else missing.push([s, must])
  }
  const found = await limited(missing, 4, async ([s]) => within(geocode(s.q ?? `${s.name} ${center.name}`, center).catch(() => []), 7000, []))
  missing.forEach(([s, must], i) => {
    const g = found[i].find((x) => haversineKm(center, x) <= maxKm)
    if (g) places.push(spotPlace(s, g, must))
  })
  // signature food: mark the ones already listed, look up a few of the others
  const foods = places.filter((p) => p.cat === 'food' || p.cat === 'cafe')
  const notListed: string[] = []
  for (const name of d.food) {
    const hit = foods.find((p) => sameName(p.name, name))
    if (hit) { hit.must = true; hit.rating = 6; hit.meal = hit.cat === 'cafe' ? ['breakfast', 'snack', 'lunch'] : ['lunch', 'dinner']; hit.desc = `A favourite with visitors to ${center.name}` }
    else notListed.push(name)
  }
  const look = notListed.slice(0, 6)
  const foodHits = await limited(look, 3, (n) => within(geocode(`${n} ${center.name}`, center).catch(() => []), 6000, []))
  look.forEach((n, i) => {
    const g = foodHits[i].find((x) => haversineKm(center, x) <= Math.min(maxKm, 30) && sameName(x.name, n))
    if (!g) return
    places.push({
      id: `dest:${d.id}:food:${norm(n).replace(/ /g, '-')}`, city, name: n, lat: g.lat, lon: g.lon, cat: 'food', tags: ['food'], hours: [], closed: [], dwell: 60, intensity: 1, cost: 450,
      best: [], desc: `A favourite with visitors to ${center.name}`, diet: 'both', meal: ['lunch', 'dinner'], indoor: true, stairs: false,
      open: Object.fromEntries(dates.map((x) => [x, TYPICAL.food])), hoursKnown: false, rating: 6, must: true, source: 'Tripzy destination guide',
    })
  })
}

const minuteOf = (iso: string) => { const t = iso.split('T')[1] ?? '06:00'; const [h, m] = t.split(':').map(Number); return h * 60 + m }

export async function planTour(q: TourQuery): Promise<Trip> {
  const a = q.answers
  const days = Math.min(Math.max(a.days ?? 2, 1), MAX_TRIP_DAYS)
  const start = a.start ?? new Date().toISOString().slice(0, 10)
  const dates = Array.from({ length: days }, (_, i) => dateOf(start, i))
  const center = { name: q.place.name, lat: q.place.lat, lon: q.place.lon }
  // longer trips reach further: day trips out of town once the city's own sights are done
  const radius = Math.min(45, 8 + days * 3)
  const sources: string[] = ['Places: Wikipedia + OpenStreetMap', 'Fame: Wikipedia language editions (Wikidata)']
  const profile = destinationFor(q.place)

  // staying away from the centre: also the restaurants and sights around the hotel
  const farBase = q.base && haversineKm(center, q.base) > 4 ? q.base : null
  const [live, pop, wx] = await Promise.all([
    Promise.all([placesAround(center.lat, center.lon, radius), farBase ? placesAround(farBase.lat, farBase.lon, 5).catch(() => []) : Promise.resolve([])])
      .then(([a, b]) => { const ids = new Set(a.map((x) => x.id)); return [...a, ...b.filter((x) => !ids.has(x.id))] }),
    popularity(center.lat, center.lon, radius).catch(() => new Map<string, number>()),
    weather(center.lat, center.lon).catch(() => null),
  ])
  if (pop.size) sources.push('Popularity: OpenTripMap')
  if (live.some((l) => l.source.startsWith('Geoapify'))) sources.push('Restaurants: Geoapify (OpenStreetMap)')
  for (const l of live) if (l.wikidata && pop.has(l.wikidata)) l.rating = 2 + pop.get(l.wikidata)!
  const known = await within(fame(live.filter((l) => l.wikidata).map((l) => l.wikidata!)), 9000, new Map<string, number>())
  for (const l of live) if (l.wikidata && known.has(l.wikidata)) l.rating = Math.max(pop.size ? l.rating ?? 0 : 0, known.get(l.wikidata)!)
  const city = slug(center.name)
  const places = live.filter((l) => haversineKm(center, l) <= radius || (farBase && haversineKm(farBase, l) <= 5)).map((l) => toPlace(l, city, dates))
  if (profile) {
    await applyProfile(places, profile, center, dates, city, radius + 25)
    sources.push(`Destination guide: what visitors come to ${center.name} for`)
  }
  // no restaurant data reachable: honest "meal near X" stops that open a restaurant search there
  if (places.filter((p) => p.meal?.includes('lunch')).length < 3) {
    const mealCost = a.budget && a.budget <= 800 ? 150 : a.budget && a.budget <= 2000 ? 300 : 500
    for (const p of places.filter((x) => x.cat !== 'food' && x.cat !== 'cafe').slice(0, 12)) {
      places.push({ ...p, id: `meal:${p.id}`, name: `Meal near ${p.name}`, cat: 'food', tags: ['food'], dwell: 50, intensity: 1, cost: mealCost, indoor: true,
        diet: undefined, meal: ['lunch', 'dinner'], open: Object.fromEntries(dates.map((d) => [d, TYPICAL.food])), hoursKnown: true,
        desc: `Pick a local restaurant around ${p.name} — tap Directions to search nearby`, rating: 0, image: undefined, source: 'Tripzy suggestion' })
    }
    sources.push('Restaurants: live list unavailable — meal breaks placed near your stops')
  }
  if (places.filter((p) => p.cat !== 'food' && p.cat !== 'cafe').length < 3) {
    throw Object.assign(new Error(`Not enough mapped attractions near ${center.name}. Try the nearest city.`), { status: 404 })
  }

  // hourly weather per trip day (forecast covers 16 days)
  let weatherByDate: Record<string, DayWx> | undefined
  if (wx) {
    weatherByDate = {}
    for (const d of dates) {
      const hours = wx.hours.filter((h) => h.time.startsWith(d))
      const day = wx.days.find((x) => x.date === d)
      if (hours.length < 24 || !day) continue
      weatherByDate[d] = {
        temp: hours.map((h) => h.temp), feels: hours.map((h) => h.feels), rain: hours.map((h) => h.rainProb), code: hours.map((h) => h.code),
        aqi: hours.map((h) => h.aqi ?? null), uv: hours.map((h) => h.uv), sunrise: minuteOf(day.sunrise), sunset: minuteOf(day.sunset), max: day.max, rainMax: day.rainProb,
      }
    }
    if (Object.keys(weatherByDate).length) sources.push('Weather and air quality: Open-Meteo (live forecast)')
    else { weatherByDate = undefined; sources.push('Weather: trip is beyond the 16-day forecast — no weather checks yet') }
  }

  // AI + web search check for the most likely picks (bounded to protect free quotas)
  const checks: Record<string, LiveCheck> = {}
  if (aiEnabled()) {
    const likely = places.filter((p) => p.cat !== 'food' && p.cat !== 'cafe' && p.tags.some((t) => a.interests?.includes(t as never))).sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0)).slice(0, 8)
    const res = await Promise.all(likely.map((p) => liveCheck(p.name, center.name, start).catch(() => null)))
    likely.forEach((p, i) => { if (res[i]) checks[p.id] = res[i]! })
    sources.push('Live notices: web search (Tavily) read by Gemini')
  }

  const trip = generateBasic(a, q.groupSize ?? 1, {
    places, weather: weatherByDate, center, sources, checks, boost: q.boost, boostWhy: q.boostWhy, base: q.base,
    profile: profile ? { why: profile.why, days: profile.days } : undefined,
  })

  // short descriptions for the chosen stops (Wikipedia), best effort
  const chosen = new Set(trip.days.flatMap((d) => d.stops.map((s) => s.placeId)))
  await Promise.all(live.filter((l) => chosen.has(l.id) && l.wikipedia).slice(0, 20).map(async (l) => {
    const s = await wikiSummary(l.wikipedia).catch(() => null)
    const p = trip.places?.find((x) => x.id === l.id)
    if (s && p) p.desc = s.length > 220 ? `${s.slice(0, 217)}…` : s
  }))
  trip.title = `${center.name}, ${days} day${days > 1 ? 's' : ''}`
  return trip
}
