/**
 * Tripzy API server. Keeps provider keys out of the browser, caches upstream calls
 * and falls back to no-key sources. Run with `npm run dev` (starts it next to Vite).
 */
process.env.TZ = 'Asia/Kolkata'
try { process.loadEnvFile('.env') } catch { /* no .env: keyless mode */ }

import express, { type NextFunction, type Request, type Response } from 'express'
import { MODES, type Mode } from '../src/lib/types'
import { cached, env, fetchJson, HOUR, UpstreamError } from './lib'
import { aiEnabled, liveCheck } from './providers/ai'
import { geocode, reverse } from './providers/geo'
import { weather } from './providers/weather'
import { planCommute, planGroupCommute, type Point } from './plan/commute'
import { planTour } from './plan/tour'
import { loadFeeds } from './transit/gtfs'

const app = express()
app.use(express.json({ limit: '200kb' }))

// small per-IP rate limit: protects the free quotas of the upstream APIs
const hits = new Map<string, { n: number; at: number }>()
app.use('/api', (req, res, next) => {
  const ip = req.ip ?? 'x'
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.at > 60_000) hits.set(ip, { n: 1, at: now })
  else if (++h.n > 90) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' })
  next()
})

const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new UpstreamError('Invalid number', 400); return n }
const inIndia = (p: { lat: number; lon: number }) => p.lat > 6 && p.lat < 37.5 && p.lon > 68 && p.lon < 97.5
const point = (v: unknown): Point => {
  const p = v as Point
  if (!p || typeof p.name !== 'string') throw new UpstreamError('A location is missing', 400)
  const out = { ...p, lat: num(p.lat, -90, 90), lon: num(p.lon, -180, 180), name: p.name.slice(0, 80) }
  if (!inIndia(out)) throw new UpstreamError(`${out.name} is outside India. Tripzy plans trips within India.`, 400)
  return out
}
const modes = (v: unknown): Mode[] => (Array.isArray(v) ? v.filter((m): m is Mode => (MODES as readonly string[]).includes(m)) : [])
const wrap = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req).then((r) => res.json(r)).catch(next)

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    providers: {
      olaMaps: !!env('OLA_MAPS_API_KEY'), gemini: !!env('GEMINI_API_KEY'), tavily: !!env('TAVILY_API_KEY'),
      openTripMap: !!env('OPENTRIPMAP_API_KEY'), rail: !!env('RAIL_API_KEY'), ai: aiEnabled(),
    },
    feeds: loadFeeds().map((f) => ({ id: f.id, name: f.name, city: f.city, builtAt: f.builtAt })),
  })
})

app.get('/api/geocode', wrap(async (req) => {
  const q = String(req.query.q ?? '')
  const near = req.query.lat ? { lat: num(req.query.lat, -90, 90), lon: num(req.query.lon, -180, 180) } : undefined
  return geocode(q, near)
}))
app.get('/api/reverse', wrap(async (req) => reverse(num(req.query.lat, -90, 90), num(req.query.lon, -180, 180))))
app.get('/api/fx', wrap(() => cached('fx:INR', 6 * HOUR, () => fetchJson<{ rates: Record<string, number>; date: string }>('https://api.frankfurter.app/latest?from=INR&to=USD,EUR,GBP')).then((j) => ({ ...j, source: 'Frankfurter (ECB reference rates)' }))))
app.get('/api/weather', wrap(async (req) => weather(num(req.query.lat, -90, 90), num(req.query.lon, -180, 180))))
app.get('/api/place/check', wrap(async (req) => liveCheck(String(req.query.name ?? '').slice(0, 80), String(req.query.city ?? '').slice(0, 60), String(req.query.date ?? '').slice(0, 10))))

app.post('/api/commute/plan', wrap(async (req) => {
  const b = req.body ?? {}
  return planCommute({
    from: point(b.from), to: point(b.to), date: String(b.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10), time: String(b.time ?? '09:00').slice(0, 5),
    modes: modes(b.modes), budget: b.budget == null ? null : num(b.budget, 0, 100000), maxTransfers: b.maxTransfers == null ? null : num(b.maxTransfers, 0, 5),
    people: b.people == null ? 1 : num(b.people, 1, 12),
  })
}))

app.post('/api/commute/group', wrap(async (req) => {
  const b = req.body ?? {}
  const members = (Array.isArray(b.members) ? b.members : []).slice(0, 12).map((m: { id: string; name: string; point: unknown }) => ({ id: String(m.id), name: String(m.name).slice(0, 40), to: '', point: point(m.point) }))
  if (!members.length) throw new UpstreamError('Members need a destination first', 400)
  return planGroupCommute({ from: point(b.from), to: members[0].point, date: String(b.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10), time: String(b.time ?? '09:00').slice(0, 5), modes: modes(b.modes), members })
}))

app.post('/api/tour/plan', wrap(async (req) => {
  const b = req.body ?? {}
  if (!b.answers || typeof b.answers !== 'object') throw new UpstreamError('Answers are missing', 400)
  return planTour({ answers: b.answers, groupSize: b.groupSize ? num(b.groupSize, 1, 12) : 1, place: point(b.place), boost: b.boost, boostWhy: b.boostWhy })
}))

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  const status = err.status ?? 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: status >= 500 && !(err instanceof UpstreamError) ? 'The planner hit an error. Please try again.' : err.message })
})

const port = Number(env('API_PORT') ?? 8787)
app.listen(port, '127.0.0.1', () => {
  const keys = ['OLA_MAPS_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY', 'OPENTRIPMAP_API_KEY', 'RAIL_API_KEY'].filter((k) => env(k))
  console.log(`Tripzy API on http://127.0.0.1:${port} · feeds: ${loadFeeds().map((f) => f.id).join(', ') || 'none (run npm run gtfs)'} · keys: ${keys.join(', ') || 'none (no-key mode)'}`)
})
