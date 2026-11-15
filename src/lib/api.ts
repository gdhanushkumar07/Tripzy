/** Typed client for the Tripzy API server (all calls go through request(): timeout, retries, de-dup, friendly errors). */
import { request } from './request'

export type GeoPoint = { name: string; label?: string; lat: number; lon: number; state?: string; city?: string; country?: string }

async function call<T>(path: string, init?: RequestInit, timeoutMs = 45000): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new Error(body.error || `Server error ${res.status}`), { code: res.status >= 500 || res.status === 429 ? 'unavailable' : 'invalid-argument', status: res.status })
    throw err
  }
  void timeoutMs
  return body as T
}

export const api = {
  geocode: (q: string, near?: { lat: number; lon: number }) =>
    request(() => call<GeoPoint[]>(`/api/geocode?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lon=${near.lon}` : ''}`), { key: `geo:${q}`, timeoutMs: 12000, retries: 1 }),
  reverse: (lat: number, lon: number) => request(() => call<GeoPoint | null>(`/api/reverse?lat=${lat}&lon=${lon}`), { timeoutMs: 12000, retries: 1 }),
  health: () => request(() => call<{ providers: Record<string, boolean>; feeds: { id: string; name: string; city: string; builtAt: string }[] }>('/api/health'), { key: 'health', timeoutMs: 6000, retries: 0 }),
  get: <T>(path: string, key: string) => request(() => call<T>(path), { key, timeoutMs: 30000, retries: 1 }),
  post: <T>(path: string, body: unknown, key: string) =>
    request(() => call<T>(path, { method: 'POST', body: JSON.stringify(body) }), { key, timeoutMs: 60000, retries: 1, backoffMs: 1500 }),
}
