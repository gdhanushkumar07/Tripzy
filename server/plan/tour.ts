/** Live tourist planner: real places + real weather + opening hours + optional AI web check → itinerary. */
import OpeningHours from 'opening_hours'
import { dateOf, generateBasic, type DayWx, type LiveCheck, type Place, type Trip } from '../../src/tour/generate'
import type { Merged } from '../../src/tour/questions'
import { haversineKm } from '../lib'
import { aiEnabled, liveCheck } from '../providers/ai'
import { placesAround, popularity, wikiSummary, type LivePlace } from '../providers/places'
import { weather } from '../providers/weather'

export type TourQuery = {
  answers: Merged; groupSize?: number
  place: { name: string; lat: number; lon: number; state?: string }
  boost?: Record<string, number>; boostWhy?: Record<string, string>
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const CAT_DESC: Record<string, string> = {
  heritage: 'Heritage site', museum: 'Museum', religious: 'Place of worship', viewpoint: 'Viewpoint', nature: 'Park and nature',
  entertainment: 'Family attraction', market: 'Market', show: 'Arts venue', attraction: 'Attraction', food: 'Restaurant', cafe: 'Café',
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
}

const minuteOf = (iso: string) => { const t = iso.split('T')[1] ?? '06:00'; const [h, m] = t.split(':').map(Number); return h * 60 + m }

export async function planTour(q: TourQuery): Promise<Trip> {
  const a = q.answers
  const days = Math.min(Math.max(a.days ?? 2, 1), 5)
  const start = a.start ?? new Date().toISOString().slice(0, 10)
  const dates = Array.from({ length: days }, (_, i) => dateOf(start, i))
  const center = { name: q.place.name, lat: q.place.lat, lon: q.place.lon }
  const radius = Math.min(25, 8 + days * 3)
  const sources: string[] = ['Places: Wikipedia + OpenStreetMap']

  const [live, pop, wx] = await Promise.all([
    placesAround(center.lat, center.lon, radius),
    popularity(center.lat, center.lon, radius).catch(() => new Map<string, number>()),
    weather(center.lat, center.lon).catch(() => null),
  ])
  if (pop.size) sources.push('Popularity: OpenTripMap')
  if (live.some((l) => l.source.startsWith('Geoapify'))) sources.push('Restaurants: Geoapify (OpenStreetMap)')
  for (const l of live) if (l.wikidata && pop.has(l.wikidata)) l.rating = 2 + pop.get(l.wikidata)!
  const city = slug(center.name)
  const places = live.filter((l) => haversineKm(center, l) <= radius).map((l) => toPlace(l, city, dates))
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

  const trip = generateBasic(a, q.groupSize ?? 1, { places, weather: weatherByDate, center, sources, checks, boost: q.boost, boostWhy: q.boostWhy })

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
