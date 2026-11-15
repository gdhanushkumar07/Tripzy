import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const env = (k: string) => process.env[k]?.trim() || undefined

/** Contact string for public OSM services' usage policies (no personal data). */
const UA = 'Tripzy/1.0 (hackathon demo travel planner)'

export class UpstreamError extends Error {
  constructor(message: string, public status = 502) { super(message) }
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 12000, ...rest } = init
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...rest, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(rest.headers ?? {}) } })
    if (!res.ok) throw new UpstreamError(`${new URL(url).host} answered ${res.status}`, res.status === 429 ? 429 : 502)
    return (await res.json()) as T
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new UpstreamError(`${new URL(url).host} timed out`, 504)
    throw e
  } finally {
    clearTimeout(t)
  }
}

/** In-memory TTL cache with de-duplication of identical in-flight calls, optionally persisted to disk. */
const mem = new Map<string, { at: number; v: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
const DISK = 'server/data/cache'
let disk: Record<string, { at: number; v: unknown }> | null = null
const diskFile = join(DISK, 'cache.json')
function loadDisk() {
  if (disk) return disk
  try { disk = existsSync(diskFile) ? JSON.parse(readFileSync(diskFile, 'utf8')) : {} } catch { disk = {} }
  return disk!
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveDisk() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { mkdirSync(DISK, { recursive: true }); writeFileSync(diskFile, JSON.stringify(disk)) } catch { /* cache is best effort */ }
  }, 1000)
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, persist = false): Promise<T> {
  const now = Date.now()
  const hit = mem.get(key) ?? (persist ? loadDisk()[key] : undefined)
  if (hit && now - hit.at < ttlMs) return hit.v as T
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  const p = fn()
    .then((v) => {
      mem.set(key, { at: Date.now(), v })
      if (persist) { loadDisk()[key] = { at: Date.now(), v }; saveDisk() }
      return v
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export type LatLon = { lat: number; lon: number }
export function haversineKm(a: LatLon, b: LatLon) {
  const R = 6371, r = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
