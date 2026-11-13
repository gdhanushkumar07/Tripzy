/**
 * Client for the Tripzy Intelligence engine (FastAPI, proxied at /engine).
 * The engine owns DNA, Time-Truth, energy, Plan B, the Ripple Engine and learning;
 * the platform (trips, days, places, budget, files, collaboration) owns the trip record.
 */
import type { Brief, Capsule, CapsuleX, CatalogPlace, Link, Proposal, Step } from './types'

const BASE = '/engine'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
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
