/**
 * Tripzy API (Express app, no listen). Keeps provider keys out of the browser, caches upstream
 * calls and falls back to no-key sources. Used by server/index.ts (Node server: local, Render)
 * and by api/index.ts (Vercel serverless function).
 */
process.env.TZ = 'Asia/Kolkata'
try { process.loadEnvFile('.env') } catch { /* no .env: keyless mode */ }

import express, { type NextFunction, type Request, type Response } from 'express'
import { MODES, type Family, type Mode, type Priority, type Vehicles } from '../src/lib/types'
import { cached, env, fetchJson, HOUR, UpstreamError } from './lib'
import { aiEnabled, liveCheck } from './providers/ai'
import { geocode, reverse } from './providers/geo'
import { weather } from './providers/weather'
import { planCommute, planGroupCommute, planMeetCommute, type Point } from './plan/commute'
import { planTour } from './plan/tour'
import { planJourney } from './plan/journey'
import { hotelsNear } from './providers/hotels'
import { chat, type ChatContext, type ChatMsg } from './ai/agent'
import { loadFeeds } from './transit/gtfs'

const app = express()
app.set('trust proxy', 1) // behind Render/Railway proxies: real client IP for the rate limit
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
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
/** Any place on Earth (journeys, tours). */
const anyPoint = (v: unknown): Point & { country?: string } => {
  const p = v as Point & { country?: string }
  if (!p || typeof p.name !== 'string') throw new UpstreamError('A location is missing', 400)
  return { name: p.name.slice(0, 80), lat: num(p.lat, -90, 90), lon: num(p.lon, -180, 180), state: str(p.state, 60), city: str(p.city, 60), country: str(p.country, 40) }
}
/** The city engine uses Indian tariffs and GTFS feeds: other places go through the journey planner. */
const point = (v: unknown): Point => {
  const out = anyPoint(v)
  if (!inIndia(out)) throw new UpstreamError(`${out.name} is outside India — use the journey planner for international trips.`, 400)
  return out
}
const date = (v: unknown) => { const s = String(v ?? new Date().toISOString().slice(0, 10)).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UpstreamError('Invalid date', 400); return s }
const time = (v: unknown) => { const s = String(v ?? '09:00').slice(0, 5); if (!/^\d{2}:\d{2}$/.test(s)) throw new UpstreamError('Invalid time', 400); return s }
const vehicles = (v: unknown): Vehicles | undefined => {
  const x = v as Vehicles | undefined
  if (!x || typeof x !== 'object') return undefined
  const fuel = (['petrol', 'diesel', 'cng', 'ev'] as const).find((f) => f === x.car?.fuel) ?? 'petrol'
  return {
    car: x.car ? { kmpl: num(x.car.kmpl ?? 15, 3, 60), fuel, seats: num(x.car.seats ?? 5, 2, 9) } : undefined,
    scooter: x.scooter ? { kmpl: num(x.scooter.kmpl ?? 45, 10, 120) } : undefined,
  }
}
const party = (v: unknown): Family => {
  const f = (v ?? {}) as Partial<Family>
  const p = { adults: num(f.adults ?? 1, 0, 12), children: num(f.children ?? 0, 0, 10), seniors: num(f.seniors ?? 0, 0, 10) }
  if (p.adults + p.seniors < 1) throw new UpstreamError('At least one adult travels', 400)
  return p
}
const modes = (v: unknown): Mode[] => (Array.isArray(v) ? v.filter((m): m is Mode => (MODES as readonly string[]).includes(m)) : [])
const wrap = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req).then((r) => res.json(r)).catch(next)

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    providers: {
      olaMaps: !!env('OLA_MAPS_API_KEY'), gemini: !!env('GEMINI_API_KEY'), tavily: !!env('TAVILY_API_KEY'),
      openTripMap: !!env('OPENTRIPMAP_API_KEY'), rail: !!env('RAIL_API_KEY'), geoapify: !!env('GEOAPIFY_API_KEY'), ai: aiEnabled(),
      serpApi: !!env('SERPAPI_KEY'), liteApi: !!env('LITEAPI_KEY'), travelpayouts: !!env('TRAVELPAYOUTS_TOKEN'), transitous: true,
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
    people: b.people == null ? 1 : num(b.people, 1, 12), vehicles: vehicles(b.vehicles),
  })
}))

app.post('/api/journey/plan', wrap(async (req) => {
  const b = req.body ?? {}
  const pr = (['balanced', 'fastest', 'cheapest', 'comfort'] as Priority[]).find((x) => x === b.priority) ?? 'balanced'
  return planJourney({
    from: anyPoint(b.from), to: anyPoint(b.to), date: date(b.date), time: time(b.time), party: party(b.party),
    luggage: b.luggage === 'heavy' ? 'heavy' : 'light', priority: pr, own: b.own === 'car' || b.own === 'scooter' ? b.own : 'none', vehicles: vehicles(b.vehicles),
    modes: modes(b.modes), flights: b.flights !== false,
  })
}))

app.get('/api/hotels', wrap(async (req) => {
  const checkin = date(req.query.checkin), checkout = date(req.query.checkout)
  if (checkout <= checkin) throw new UpstreamError('Check-out must be after check-in', 400)
  return hotelsNear({ lat: num(req.query.lat, -90, 90), lon: num(req.query.lon, -180, 180), city: str(req.query.city, 60), checkin, checkout, adults: num(req.query.adults ?? 2, 1, 12), children: num(req.query.children ?? 0, 0, 10) })
}))

app.post('/api/commute/group', wrap(async (req) => {
  const b = req.body ?? {}
  const members = (Array.isArray(b.members) ? b.members : []).slice(0, 12).map((m: { id: string; name: string; point: unknown }) => ({ id: String(m.id), name: String(m.name).slice(0, 40), to: '', point: point(m.point) }))
  if (!members.length) throw new UpstreamError('Members need a destination first', 400)
  return planGroupCommute({ from: point(b.from), to: members[0].point, date: String(b.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10), time: String(b.time ?? '09:00').slice(0, 5), modes: modes(b.modes), members })
}))

app.post('/api/commute/meet', wrap(async (req) => {
  const b = req.body ?? {}
  const members = (Array.isArray(b.members) ? b.members : []).slice(0, 12).map((m: { id: string; name: string; point: unknown }) => ({ id: String(m.id), name: String(m.name).slice(0, 40), point: point(m.point) }))
  if (members.length < 2) throw new UpstreamError('At least two members need to set where they start', 400)
  return planMeetCommute({ to: point(b.to), date: date(b.date), time: time(b.time), modes: modes(b.modes), members })
}))

// Tripzy AI chat: the last messages + what the app knows (location, preferences, saved items)
app.post('/api/ai/chat', wrap(async (req) => {
  const b = req.body ?? {}
  const messages: ChatMsg[] = (Array.isArray(b.messages) ? b.messages : []).slice(-14)
    .filter((m: ChatMsg) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string')
    .map((m: ChatMsg) => ({ role: m.role, text: m.text.slice(0, 2000) }))
  if (!messages.some((m) => m.role === 'user')) throw new UpstreamError('Say something first', 400)
  const c = (b.context ?? {}) as ChatContext
  const ctx: ChatContext = {
    location: c.location && Number.isFinite(c.location.lat) && Number.isFinite(c.location.lon) ? { lat: num(c.location.lat, -90, 90), lon: num(c.location.lon, -180, 180), name: str(c.location.name, 80) } : undefined,
    prefs: c.prefs ? { modes: modes(c.prefs.modes), vehicles: vehicles(c.prefs.vehicles), family: c.prefs.family ? party(c.prefs.family) : undefined, priority: (['balanced', 'fastest', 'cheapest', 'comfort'] as Priority[]).find((x) => x === c.prefs?.priority) } : undefined,
    memory: (Array.isArray(c.memory) ? c.memory : []).slice(0, 40).map((m) => ({ title: String(m?.title ?? '').slice(0, 80), text: String(m?.text ?? '').slice(0, 300) })),
    name: str(c.name, 40),
  }
  return chat(messages, ctx)
}))

app.post('/api/tour/plan', wrap(async (req) => {
  const b = req.body ?? {}
  if (!b.answers || typeof b.answers !== 'object') throw new UpstreamError('Answers are missing', 400)
  return planTour({ answers: b.answers, groupSize: b.groupSize ? num(b.groupSize, 1, 12) : 1, place: anyPoint(b.place), boost: b.boost, boostWhy: b.boostWhy })
}))

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  const status = err.status ?? 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: status >= 500 && !(err instanceof UpstreamError) ? 'The planner hit an error. Please try again.' : err.message })
})

export default app
