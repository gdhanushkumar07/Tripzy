/**
 * Client for the Tripzy Intelligence engine (FastAPI, proxied at /engine).
 * The engine owns DNA, Time-Truth, energy, Plan B, the Ripple Engine and learning;
 * the platform (trips, days, places, budget, files, collaboration) owns the trip record.
 */
import type { Brief, Capsule, CapsuleX, CatalogPlace, Link, Proposal, Step } from './types'

// Reached through the platform's authenticated proxy (never the engine directly).
const BASE = '/api/tripzy'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!r.ok) {
    let msg = `Tripzy engine error (${r.status})`
    try {
      const j = await r.json()
      msg = j.detail ?? msg
    } catch {
      /* not json */
    }
    throw new Error(msg)
  }
  return r.json()
}
const post = <T,>(path: string, body: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(body) })

export type Dna = Capsule['dna']
export type Profile = {
  completed: boolean; dna: Dna; dna_onboarding?: Dna; summary?: string[]; companions?: string; kids?: number
  constraints?: { diet: string; no_stairs: boolean; wheelchair: boolean }; budget_style?: string; budget_per_day?: number | null
  home_city?: string | null; history?: { text: string; from: string; city: string }[]; updated_at?: string; answers?: ProfileInput
}
export type ProfileInput = {
  swipes: Record<string, string>; interests: string[]; pace?: number; morning?: number
  companions: 'solo' | 'couple' | 'friends' | 'family' | 'parents'; kids: number; diet: 'any' | 'veg' | 'jain' | 'halal'
  no_stairs: boolean; wheelchair: boolean; budget_style: 'low' | 'mid' | 'high'; budget_per_day?: number | null; home_city?: string | null; skipped: string[]
}
export type CapsuleSummary = {
  id: string; city: string; city_key: string; demo: boolean; platform_trip_id?: number; created_at: string; start: string | null; days: number
  scores: number[]; ripple_log: Capsule['ripple_log']; learned: Capsule['learned']; spent_total: number; planned_total: number
}
export type DiscoverItem = { place_id: string; name: string; city: string; city_key: string; cat: string; match: number; why: string; best?: [string, string, string]; desc: string }
export type ProviderRow = { name: string; purpose: string; status: 'ok' | 'degraded' | 'down' | 'not_configured' | 'simulated'; latency_ms: number | null; detail: string; attribution: string }

export type Fx = { base: string; date: string | null; rates: Record<string, number>; source: string | null; error?: string }
export type CheckItem = { id: string; title: string; detail: string; auto: boolean; done: boolean; link?: string | null; when?: string | null }
export type Readiness = {
  countdown_days: number | null; start_date: string; score: number; complete: number; total: number
  checklist: CheckItem[]; packing: { item: string; why: string; category: string }[]
  guide: { city: string; reviewed: string; disclaimer: string; emergency: { label: string; number: string }[]
    sections: { title: string; points: string[]; links: [string, string][] }[] }
  sources: { name: string; url: string }[]
}
export type NearbyPlace = { name: string; address?: string; lat: number; lon: number; distance_m?: number; opening_hours?: string | null; categories: string[] }
export type Hotel = { id: string; name: string; stars?: number; rating?: number; reviews?: number; address?: string; lat?: number; lon?: number; photo?: string; room?: string; board?: string; total: number; currency: string; refundable: boolean }
export type HotelResult = { configured: boolean; sandbox?: boolean; checkin?: string; checkout?: string; items: Hotel[]; source?: string; detail?: string; error?: string }
export type CompanionCard =
  | { type: 'places'; items: NearbyPlace[]; source?: string }
  | { type: 'hotels'; items: Hotel[]; source?: string; sandbox?: boolean }
  | { type: 'emergency'; items: { label: string; number: string }[] }
  | { type: 'packing'; items: string[] }
export type CompanionAction = { type: 'ripple'; label: string; day: number; now: string; event: Record<string, unknown>; confirm: string }
export type CompanionReply = { reply: string; cards: CompanionCard[]; action: CompanionAction | null; source: string }
export type TripAlert = { level: 'warn' | 'info'; kind: string; text: string; day?: number }
export type Finance = {
  currency: string; categories: Record<'tickets' | 'food' | 'transport' | 'stay', number>; total: number; people: number; per_person: number
  stay_rate: number; nights: number; budget_total: number | null; spent: number; remaining: number
  by_day: { day: number; date: string; planned: number; spent: number }[]; expenses: { day: number; amount: number; label: string }[]
  converted: Record<string, number>; fx: { source: string | null; date: string | null }; note: string
}
export type Recap = {
  city: string; start_date: string; days: number; stops: number; meals: number; km: number; travel_min: number
  highlights: { name: string; place_id?: string; day: number; start: string }[]; loved: string[]; reactions: number
  adaptations: { headline: string; day: number; auto: boolean }[]; learned: string[]; spent: number; story: string | null; story_source?: string | null
}

export type DnaCard = { id: string; a: { label: string; emoji: string }; b: { label: string; emoji: string } }

export const engine = {
  health: () => req<{ ok: boolean }>('/health'),
  parseBrief: (text: string) => post<Brief>('/brief/parse', { text }),
  cards: () => req<DnaCard[]>('/dna/cards'),
  capsule: (id: string) => req<CapsuleX>(`/trips/${id}`),
  route: (id: string, day: number) => req<{ line: [number, number][]; points: [number, number][] }>(`/trips/${id}/route/${day}`),
  places: (city: string) => req<CatalogPlace[]>(`/cities/${city}/places`),
  edit: (id: string, text: string) =>
    post<{ capsule: Capsule; messages: string[]; changes?: { day: number; added: string[]; removed: string[] }[] }>(`/trips/${id}/edit`, { text }),
  stay: (id: string, stay_id: string) => post<Capsule>(`/trips/${id}/stay`, { stay_id }),
  choose: (id: string, day: number, block_id: string, place_id: string) => post<Capsule>(`/trips/${id}/choose`, { day, block_id, place_id }),
  resequence: (id: string, day: number, place_ids: string[]) =>
    post<{ capsule: Capsule; feasibility: { before: number; after: number } }>(`/trips/${id}/resequence`, { day, place_ids }),
  booking: (id: string, b: Record<string, unknown>) => post<Capsule>(`/trips/${id}/bookings`, b),
  parseTicket: (text: string, city_key: string) => post<Record<string, string>>('/bookings/parse', { text, city_key }),
  ripple: (id: string, day: number, now: string, event: Record<string, unknown>) => post<Proposal>(`/trips/${id}/ripple`, { day, now, event }),
  accept: (id: string, pid: string) => post<Capsule>(`/trips/${id}/ripple/${pid}/accept`, {}),
  reject: (id: string, pid: string) => post<Capsule>(`/trips/${id}/ripple/${pid}/reject`, {}),
  feedback: (id: string, body: { day: number; block_id: string; reaction: string; actual_dwell?: number }) =>
    post<{ learned: string[]; dna_summary: string[] }>(`/trips/${id}/feedback`, body),
  retune: (id: string, from_day: number) => post<Capsule>(`/trips/${id}/retune`, { from_day }),
  expense: (id: string, day: number, amount: number, label: string) => post<Capsule['budget']>(`/trips/${id}/expense`, { day, amount, label }),
  link: (capsule_id: string, platform_trip_id: number, places: Record<string, string>) =>
    post<{ ok: boolean }>('/links', { capsule_id, platform_trip_id, places }),
  getLink: (platformTripId: number | string) => req<Link>(`/links/${platformTripId}`),
  demoSeed: () => post<{ capsule_id: string }>('/demo/seed', {}),
  profile: () => req<Profile>('/me/profile'),
  saveProfile: (p: ProfileInput) => req<Profile>('/me/profile', { method: 'PUT', body: JSON.stringify(p) }),
  myCapsules: () => req<CapsuleSummary[]>('/me/capsules'),
  discover: (city?: string, limit = 8) => req<{ personalised: boolean; items: DiscoverItem[] }>(`/me/discover?limit=${limit}${city ? `&city=${city}` : ''}`),
  providers: () => req<{ checked_at: string; providers: ProviderRow[] }>('/providers'),
  parseTicketFile: async (file: File, city_key: string) => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(`${BASE}/bookings/parse-file?city_key=${encodeURIComponent(city_key)}`, { method: 'POST', body: fd, credentials: 'same-origin' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Upload failed (${r.status})`)
    return (await r.json()) as { fields: Record<string, string>; chars: number; method?: 'pdf' | 'text' | 'ocr' }
  },
  fx: (base = 'INR') => req<Fx>(`/fx?base=${base}`),
  readiness: (id: string, documents = 0) => req<Readiness>(`/trips/${id}/readiness?documents=${documents}`),
  tick: (id: string, item: string, done: boolean, documents = 0) => post<Readiness>(`/trips/${id}/readiness/${item}?documents=${documents}`, { done }),
  companion: (id: string, message: string, day?: number, now?: string) => post<CompanionReply>(`/trips/${id}/companion`, { message, day, now }),
  alerts: (id: string, documents = 0) => req<{ alerts: TripAlert[] }>(`/trips/${id}/alerts?documents=${documents}`),
  hotels: (id: string) => req<HotelResult>(`/trips/${id}/hotels`),
  finance: (id: string) => req<Finance>(`/trips/${id}/finance`),
  recap: (id: string, story = false) => req<Recap>(`/trips/${id}/recap${story ? '?story=true' : ''}`),
  train: (number: string, date: string, station: string) =>
    req<{ number: string; name: string; status: string; delay_min: number; avg_delay_hist: number; source: string }>(
      `/live/train/${number}?date=${date}&station=${station}`),
}

/** Compose streams agent progress over SSE (POST, so the stream is parsed by hand). */
export async function composeStream(
  body: { brief: Brief; swipes: Record<string, string>; travellers?: unknown[] },
  onStep: (s: Step) => void,
): Promise<string> {
  const r = await fetch(BASE + '/trips/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok || !r.body) throw new Error(`Planning failed (${r.status})`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let id = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split(/\r?\n\r?\n/)
    buf = parts.pop() ?? ''
    for (const part of parts) {
      let ev = 'message'
      let data = ''
      for (const line of part.split(/\r?\n/)) {
        if (line.startsWith('event:')) ev = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      const parsed = JSON.parse(data)
      if (ev === 'step') onStep(parsed)
      else if (ev === 'done') id = parsed.id
      else if (ev === 'error') throw new Error(parsed.message)
    }
  }
  if (!id) throw new Error('Planning ended without a trip')
  return id
}

export const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
export const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const mapsLink = (lat?: number | null, lon?: number | null, name?: string) =>
  lat && lon
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
    : `https://www.google.com/maps/search/${encodeURIComponent(name ?? '')}`

/** Last capsule the traveller worked with: lets Live, DNA and Lab open without a picker. */
export function rememberCapsule(id: string, platformTripId?: number) {
  try {
    localStorage.setItem('tripzy:lastCapsule', JSON.stringify({ id, platformTripId }))
  } catch {
    /* storage unavailable */
  }
}
export function lastCapsule(): { id: string; platformTripId?: number } | null {
  try {
    return JSON.parse(localStorage.getItem('tripzy:lastCapsule') || 'null')
  } catch {
    return null
  }
}
