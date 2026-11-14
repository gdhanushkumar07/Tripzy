/**
 * Rule-based "Basic plan" generator — pure, no UI, works with no network.
 * Ported from the old Python planner: greedy day composer that respects
 * opening hours, weekly closures, fixed show slots, meal times, diet, effort
 * and budget, and scores places by the traveller's interests.
 */
import data from '../data/places.json'
import type { Merged, Tag } from './questions'

export type Place = {
  id: string; city: string; name: string; lat: number; lon: number; cat: string; tags: string[]
  hours: string[][]; closed: number[]; dwell: number; intensity: number; cost: number; best: string[]; desc: string
  diet?: string; meal?: string[]; slot?: string[]; indoor: boolean; stairs: boolean
}
export const PLACES = (data as unknown as { places: Place[] }).places
export const CITIES = (data as unknown as { cities: Record<string, { name: string }> }).cities
const BY_ID = new Map(PLACES.map((p) => [p.id, p]))
export const placeById = (id: string) => BY_ID.get(id)

export type Stop = {
  placeId: string; name: string; kind: 'visit' | 'meal'; start: number; end: number; cost: number
  travel: { km: number; min: number; fare: number } | null
  why: string; who: string[]; warn?: string
}
export type Day = { date: string; stops: Stop[] }
export type Trip = {
  title: string; city: string; start: string; dayStart: number; dayEnd: number; party: number
  budgetPerDay: number | null; days: Day[]; source: 'basic' | 'ai'; answers: Merged; groupCode?: string
  createdAt: number; updatedAt: number
}

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Auto-rickshaw estimate between two places; fare per person (an auto seats 3). */
export function travel(a: Place, b: Place, party: number) {
  const km = Math.round(haversine(a, b) * 1.35 * 10) / 10
  if (km < 0.4) return { km, min: 5, fare: 0 } // walk
  return { km, min: Math.round((km / 18) * 60 + 6), fare: Math.round((30 + 16 * km) / Math.min(Math.max(party, 1), 3)) }
}

const weekday = (iso: string, i: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + i); return (d.getDay() + 6) % 7 } // 0 = Mon
const dateOf = (iso: string, i: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10) }

/** Earliest start ≥ t at which the place is open for its full visit (waits up to 45 min). */
export function openAt(p: Place, t: number, wd: number): number | null {
  if (p.closed.includes(wd)) return null
  if (p.slot) { const s = toMin(p.slot[0]); return t <= s && s - t <= 90 ? s : null }
  for (const [o, c] of p.hours) {
    const open = toMin(o), close = c === '23:59' ? 24 * 60 : toMin(c)
    const start = Math.max(t, open)
    if (start - t <= 45 && start + p.dwell <= close) return start
  }
  return null
}

const dietOk = (p: Place, diet: number) => !p.diet || diet === 0 || (diet === 1 ? p.diet !== 'nonveg' : p.diet === 'veg')
const isFood = (p: Place) => p.cat === 'food' || p.cat === 'cafe' || (!!p.meal && p.meal.includes('dinner') && p.cat !== 'show')

export function weights(a: Merged): Record<string, number> {
  const w: Record<string, number> = {}
  const ranked = a.interests ?? []
  ranked.forEach((t, i) => (w[t] = 1 - i * (0.5 / Math.max(ranked.length, 1))))
  if (a.evening === 'spiritual') w.spiritual = Math.max(w.spiritual ?? 0, 0.7)
  if (a.evening === 'nightlife') w.nightlife = Math.max(w.nightlife ?? 0, 0.7)
  if (a.effort === 'high') w.adventure = Math.max(w.adventure ?? 0, 0.5)
  if (a.party === 'kids') w.kids = Math.max(w.kids ?? 0, 0.8)
  return w
}

function interestScore(p: Place, w: Record<string, number>) {
  const v = p.tags.map((t) => w[t] ?? 0.15).sort((x, y) => y - x)
  return (v[0] ?? 0) + 0.3 * (v[1] ?? 0)
}

function whyText(p: Place, w: Record<string, number>, start: number) {
  const liked = p.tags.filter((t) => (w[t] ?? 0) >= 0.5)
  const best = p.best && start >= toMin(p.best[0]) && start < toMin(p.best[1]) ? `Best time: ${p.best[2]}` : ''
  return [liked.length ? `Matches ${liked.slice(0, 2).join(' & ')}` : '', best].filter(Boolean).join(' · ') || p.desc
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

export function generateBasic(a: Merged, groupSize = 1): Trip {
  const city = a.city ?? 'hyderabad'
  const days = Math.min(Math.max(a.days ?? 2, 1), 4)
  const start = a.start ?? new Date().toISOString().slice(0, 10)
  const pace = PACE[(a.pace ?? 2) as 1 | 2 | 3] ?? PACE[2]
  const dayStart = a.morning === 'late' ? 10 * 60 : 8 * 60
  const dayEnd = a.evening === 'early' ? Math.min(pace.end, 21 * 60) : pace.end
  const party = partySize(a, groupSize)
  const budget = a.budget ? a.budget : null
  const w = weights(a)
  const cityPlaces = PLACES.filter((p) => p.city === city)
  const used = new Set<string>()
  const out: Day[] = []

  for (let d = 0; d < days; d++) {
    const wd = weekday(start, d)
    const stops: Stop[] = []
    let t = dayStart
    let here: Place | null = null
    let spent = 0
    let visits = 0
    let lunch = false, dinner = false
    const add = (p: Place, at: number, kind: Stop['kind'], tr: Stop['travel']) => {
      const cost = p.cost
      stops.push({ placeId: p.id, name: p.name, kind, start: at, end: at + p.dwell, cost, travel: tr, why: kind === 'meal' ? p.desc : whyText(p, w, at), who: whoWanted(p, a.votes) })
      spent += cost + (tr?.fare ?? 0)
      used.add(p.id)
      here = p
      t = at + p.dwell
    }
    const meal = (which: 'breakfast' | 'lunch' | 'dinner') => {
      const options = cityPlaces
        .filter((p) => p.meal?.includes(which) && dietOk(p, a.diet ?? 0) && !used.has(p.id))
        .map((p) => {
          const tr = here ? travel(here, p, party) : null
          const at = openAt(p, t + (tr?.min ?? 0), wd)
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
        if (!dinner && dayEnd >= 20 * 60) { t = Math.max(t, 19 * 60); continue }
        break
      }
      const options = cityPlaces
        .filter((p) => !used.has(p.id) && suitable(p, a))
        .map((p) => {
          const tr = here ? travel(here, p, party) : null
          const at = openAt(p, t + (tr?.min ?? 0), wd)
          if (at === null || at + p.dwell > dayEnd) return null
          if (budget && spent + p.cost + (tr?.fare ?? 0) > budget) return null
          const inBest = p.best && at >= toMin(p.best[0]) && at < toMin(p.best[1]) ? 0.35 : 0
          const eveningOnly = p.best && toMin(p.best[0]) >= 17 * 60 && at < 16 * 60 ? 0.5 : 0
          const score = interestScore(p, w) + inBest - eveningOnly - (tr?.min ?? 0) / 40 - (at - t - (tr?.min ?? 0)) / 90
          return { p, tr, at, score }
        })
        .filter((o): o is NonNullable<typeof o> => !!o)
        .sort((x, y) => y.score - x.score)
      const best = options[0]
      if (!best) {
        if (!lunch && t < 12 * 60 + 30) { t = 12 * 60 + 30; continue }
        if (!dinner && t < 19 * 60 && dayEnd >= 20 * 60) { t = 19 * 60; continue }
        break
      }
      add(best.p, best.at, 'visit', best.tr)
      visits++
    }
    out.push({ date: dateOf(start, d), stops })
  }

  return {
    title: `${CITIES[city]?.name ?? city}, ${days} day${days > 1 ? 's' : ''}`,
    city, start, dayStart, dayEnd, party, budgetPerDay: budget, days: out, source: 'basic', answers: a,
    createdAt: Date.now(), updatedAt: Date.now(),
  }
}

/** Recompute times and travel for one day after an edit; flag stops that end up closed. */
export function retime(trip: Trip, dayIndex: number): Trip {
  const day = trip.days[dayIndex]
  const wd = weekday(trip.start, dayIndex)
  let t = trip.dayStart
  let prev: Place | null = null
  const stops = day.stops.map((s) => {
    const p = placeById(s.placeId)
    if (!p) return s
    const tr = prev ? travel(prev, p, trip.party) : null
    const arrive = t + (tr?.min ?? 0)
    const at = openAt(p, arrive, wd)
    const start = at ?? arrive
    t = start + p.dwell
    prev = p
    return { ...s, start, end: t, travel: tr, warn: at === null ? 'May be closed at this time — move it or swap it' : undefined }
  })
  const days = trip.days.map((d, i) => (i === dayIndex ? { ...d, stops } : d))
  return { ...trip, days, updatedAt: Date.now() }
}

export const stopTotal = (s: Stop) => s.cost + (s.travel?.fare ?? 0)
export const dayTotal = (d: Day) => d.stops.reduce((a, s) => a + stopTotal(s), 0)
export const tripTotal = (t: Trip) => t.days.reduce((a, d) => a + dayTotal(d), 0)

/** Suggested swaps: unused places of the same kind that fit that slot. */
export function alternatives(trip: Trip, dayIndex: number, stopIndex: number): Place[] {
  const s = trip.days[dayIndex].stops[stopIndex]
  const cur = placeById(s.placeId)
  if (!cur) return []
  const used = new Set(trip.days.flatMap((d) => d.stops.map((x) => x.placeId)))
  const wd = weekday(trip.start, dayIndex)
  const w = weights(trip.answers)
  return PLACES.filter((p) => p.city === trip.city && !used.has(p.id))
    .filter((p) => (s.kind === 'meal' ? isFood(p) && dietOk(p, trip.answers.diet ?? 0) : suitable(p, trip.answers)))
    .filter((p) => openAt(p, s.start, wd) !== null)
    .sort((a, b) => interestScore(b, w) - interestScore(a, w) + (haversine(cur, a) - haversine(cur, b)) / 20)
    .slice(0, 3)
}

export function swapStop(trip: Trip, dayIndex: number, stopIndex: number, p: Place): Trip {
  const w = weights(trip.answers)
  const days = trip.days.map((d, i) =>
    i !== dayIndex ? d : {
      ...d,
      stops: d.stops.map((s, j) => (j !== stopIndex ? s : { ...s, placeId: p.id, name: p.name, cost: p.cost, why: s.kind === 'meal' ? p.desc : whyText(p, w, s.start), who: whoWanted(p, trip.answers.votes) })),
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

/** Light shape check for a plan that came back from the optional AI endpoint. */
export function isTrip(x: unknown): x is Trip {
  const t = x as Trip
  return !!t && typeof t.title === 'string' && Array.isArray(t.days) && t.days.every((d) => Array.isArray(d.stops))
}
