/**
 * Tripzy AI: a chat agent that runs the app's own features.
 *  - It keeps a plan state per chat (the current trip request or tour answers), so follow-ups edit
 *    it: "make it cheaper", "avoid buses", "leave at 8", "we are 4 now", "add a day".
 *  - Gemini (function calling) decides; the tools run Tripzy's real planners (city routes, long
 *    journeys, tour itineraries, hotels, weather), so every fare and time comes from data.
 *  - Preferences (comfortable modes, luggage, vehicle, who travels, priority) are asked once with a
 *    picker in the chat and saved to the profile; the same answers drive the manual pages.
 *  - Each reply carries "actions" that fill the manual Daily Traveller / Tourist Planner forms.
 *  - Retrieval (BM25, rag.ts) grounds answers about the app and the user's saved data.
 *  - Without Gemini (no key, quota, outage) a rule-based parser does the same, deterministically.
 */
import type { Family, Mode, Priority, Vehicles } from '../../src/lib/types'
import { DEFAULT_PREFS, MODE_LABEL, MODES } from '../../src/lib/types'
import type { Answers } from '../../src/tour/questions'
import { env, haversineKm, UpstreamError } from '../lib'
import { planCommute, type Point } from '../plan/commute'
import { planJourney } from '../plan/journey'
import { geminiGenerate } from '../providers/ai'
import { geocode } from '../providers/geo'
import { hotelsNear } from '../providers/hotels'
import { weather, WX_TEXT } from '../providers/weather'
import { retrieve, type Doc } from './rag'

export type ChatMsg = { role: 'user' | 'assistant'; text: string }
export type UserPrefs = { modes?: Mode[]; vehicles?: Vehicles; family?: Family; priority?: Priority; luggage?: 'light' | 'heavy' }
export type ChatContext = {
  location?: { lat: number; lon: number; name?: string }
  prefs?: UserPrefs
  /** the user has confirmed preferences once (in chat or the dashboard) */
  prefsKnown?: boolean
  memory?: { title: string; text: string }[]
  name?: string
}
export type RouteArgs = {
  from?: string; to: string; time?: string; date?: string; priority?: Priority; avoid?: string[]; only?: string[]
  people?: number; own_vehicle?: 'car' | 'scooter' | 'none'; luggage?: 'light' | 'heavy'
  /** modes added in follow-ups beyond the saved ones ("use the metro") */
  extra?: string[]
  /** "I hate traffic and pollution": lead with the least-traffic / via-metro option */
  prefer?: 'clean'
}
export type TourArgs = Partial<Pick<Answers, 'start' | 'days' | 'party' | 'budget' | 'pace' | 'diet' | 'interests' | 'morning' | 'effort' | 'evening' | 'food' | 'getaround'>> & { destination?: string }
/** What this chat is working on; sent back by the app with every message. */
export type ChatState = { route?: RouteArgs; tour?: TourArgs; pending?: RouteArgs }

export type RouteCard = { type: 'routes'; title: string; url: string; journey: boolean; options: { labels: string[]; minutes: number; fare: number; perPerson: boolean; summary: string }[]; note?: string; request: RouteArgs }
export type HotelCard = { type: 'hotels'; title: string; items: { name: string; price?: number; rating?: number; url?: string; km: number }[]; note?: string }
export type WeatherCard = { type: 'weather'; title: string; days: { date: string; max: number; min: number; rain: number; summary: string }[] }
export type PrefsCard = { type: 'prefs'; reason: string; current: UserPrefs }
export type TourCard = { type: 'tour'; title: string; answers: Answers & { place?: { name: string; lat: number; lon: number; state?: string } }; missing: string[]; ready: boolean }
export type Card = RouteCard | HotelCard | WeatherCard | PrefsCard | TourCard
/** Things the app does for the user: fill the manual forms, create the itinerary. */
export type Action =
  | { type: 'commute'; url: string; params: Record<string, string>; journey: boolean }
  | { type: 'tour'; answers: TourCard['answers']; create: boolean }
export type AgentReply = { reply: string; cards: Card[]; actions: Action[]; state: ChatState; tools: string[]; engine: 'gemini' | 'rules'; sources: string[] }

const IN = (p: { lat: number; lon: number }) => p.lat > 6 && p.lat < 37.5 && p.lon > 68 && p.lon < 97.5
const nowIST = () => {
  const d = new Date(Date.now() + 330 * 60000)
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }
}
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`)
const ll = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`

// ---------------------------------------------------------------- words → modes

const MODE_WORDS: [RegExp, Mode[]][] = [
  [/scoot(y|er)|two.?wheeler|activa|my bike/i, ['ownscooter']], [/my car|own car|drive/i, ['owncar']], [/bike taxi|rapido|\bbikes?\b/i, ['bike']],
  [/\bbus(es)?\b/i, ['citybus']], [/metro/i, ['metro']], [/\bautos?\b/i, ['auto']], [/\bcabs?\b|uber|ola\b|taxi/i, ['cab', 'suv']], [/walk/i, ['walk']], [/train|mmts/i, ['rail', 'train']],
]
export const modesFromWords = (words: string[] = []) => [...new Set(words.flatMap((w) => {
  if ((MODES as readonly string[]).includes(w)) return [w as Mode]
  const hit = MODE_WORDS.find(([re]) => re.test(w))
  return hit ? hit[1] : []
}))]

async function place(name: string, ctx: ChatContext): Promise<Point> {
  if (/^(here|my location|current location|me|where i am)$/i.test(name.trim()) && ctx.location) return { name: ctx.location.name ?? 'My location', lat: ctx.location.lat, lon: ctx.location.lon }
  const r = await geocode(name, ctx.location)
  if (!r.length) throw new UpstreamError(`I couldn't find "${name}". Try a fuller name, like "${name}, Hyderabad".`, 404)
  // the same name exists in many countries: prefer a match near the user, then one in their country
  const loc = ctx.location
  const near = loc ? r.filter((x) => haversineKm(loc, x) <= 150) : []
  const home = loc && IN(loc) ? r.filter((x) => IN(x)) : []
  const p = near[0] ?? home[0] ?? r[0]
  return { name: p.name, lat: p.lat, lon: p.lon, state: p.state, city: p.city }
}

// ---------------------------------------------------------------- tools

export async function planRouteTool(a: RouteArgs, ctx: ChatContext): Promise<{ card: RouteCard; action: Action; text: string; sources: string[] }> {
  if (!a.to) throw new UpstreamError('Where do you want to go?', 400)
  if (!a.from && !ctx.location) throw new UpstreamError('Where are you starting from? (Or tap "Use my live location".)', 400)
  const [from, to] = await Promise.all([a.from ? place(a.from, ctx) : place('here', ctx), place(a.to, ctx)])
  const now = nowIST()
  const time = /^\d{1,2}:\d{2}$/.test(a.time ?? '') ? a.time!.padStart(5, '0') : now.time
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '') ? a.date! : now.date
  const own = a.own_vehicle ?? 'none'
  const avoid = modesFromWords(a.avoid)
  let modes: Mode[] = a.only?.length ? [...modesFromWords(a.only), 'walk'] : [...new Set<Mode>([...(ctx.prefs?.modes?.length ? ctx.prefs.modes : DEFAULT_PREFS.modes), 'walk', ...modesFromWords(a.extra)])]
  if (own === 'scooter') modes.push('ownscooter')
  if (own === 'car') modes.push('owncar')
  modes = [...new Set(modes)].filter((m) => !avoid.includes(m) || m === 'walk')
  const party = ctx.prefs?.family && !a.people ? ctx.prefs.family : { adults: Math.max(1, a.people ?? 1), children: 0, seniors: 0 }
  const people = party.adults + party.children + party.seniors
  const priority: Priority = a.priority ?? ctx.prefs?.priority ?? 'balanced'
  const luggage = a.luggage ?? ctx.prefs?.luggage ?? 'light'
  const journey = !IN(from) || !IN(to) || haversineKm(from, to) > 80
  const params: Record<string, string> = { f: from.name, fl: ll(from), t: to.name, tl: ll(to), tm: time, m: modes.join(','), d: date }
  if (people > 1 && !journey) params.p = String(people)
  if (journey) Object.assign(params, { pa: `${party.adults}.${party.children}.${party.seniors}`, lg: luggage, pr: priority, ow: own })
  const url = `/commute?${new URLSearchParams(params)}`
  const action: Action = { type: 'commute', url, params, journey }
  const request: RouteArgs = { ...a, from: from.name, to: to.name, time, date }
  const vehicles = own === 'none' ? ctx.prefs?.vehicles : { ...ctx.prefs?.vehicles, ...(own === 'scooter' ? { scooter: ctx.prefs?.vehicles?.scooter ?? { kmpl: 45 } } : { car: ctx.prefs?.vehicles?.car ?? { kmpl: 15, fuel: 'petrol' as const, seats: 5 } }) }
  if (journey) {
    const j = await planJourney({ from, to, date, time, party, luggage, priority, own, vehicles, modes })
    const options = j.options.slice(0, 6).map((o) => ({ labels: [...o.tags, ...(o.badges ?? [])], minutes: o.minutes, fare: o.cost, perPerson: false, summary: `${o.title} — ${o.legs.map((l) => l.name).join(' → ')}` }))
    const card: RouteCard = { type: 'routes', title: `${from.name} → ${to.name}`, url, journey: true, options, note: j.message, request }
    return { card, action, sources: j.sources, text: JSON.stringify({ from: from.name, to: to.name, date, time, people, priority, luggage, modes_used: modes, options: options.map((o) => ({ ...o, duration: fmtDur(o.minutes), cost_total_inr: o.fare })), filled_daily_traveller: true }) }
  }
  const r = await planCommute({ from, to, date, time, modes, people, vehicles, luggage })
  const options = r.routes.map((x) => ({
    labels: x.labels as string[], minutes: x.totalMin, fare: x.fare, perPerson: true,
    summary: x.legs.filter((l) => l.mode !== 'walk' || l.km > 0.5).map((l) => `${l.mode === 'metro' && /^Metro /.test(l.name) ? l.name : `${MODE_LABEL[l.mode]}${l.mode === 'citybus' ? ` ${l.name.replace(/^City bus /, '')}` : ''}`} ${l.fromName.replace(/ (bus stop|Metro)$/, '')}→${l.toName.replace(/ (bus stop|Metro)$/, '')}${l.km >= 1 ? ` ${Math.round(l.km)} km` : ''}`).join(' › '),
  }))
  const alts = r.routes.flatMap((x) => x.legs).find((l) => (l as { alts?: unknown[] }).alts) as { fromName: string; alts: { mode: Mode; minutes: number; fare: number; wait: number }[] } | undefined
  const card: RouteCard = { type: 'routes', title: `${from.name} → ${to.name} · ${time}`, url, journey: false, options, note: r.message, request }
  return {
    card, action, sources: r.sources,
    text: JSON.stringify({
      from: from.name, to: to.name, date, time, people, luggage, modes_used: modes, priority_asked: priority, message: r.message,
      options: options.map((o) => ({ ...o, duration: fmtDur(o.minutes), fare_inr_per_person: o.fare })),
      alternatives_at_last_stop: alts ? { stop: alts.fromName, options: alts.alts.map((x) => `${MODE_LABEL[x.mode]} ${x.minutes} min ₹${x.fare}${x.wait > 1 ? ` (next in ${x.wait} min)` : ''}`) } : undefined,
      suggestions: r.suggestions.map((s) => s.text), filled_daily_traveller: true,
    }),
  }
}

type RouteChanges = { prefer?: 'clean'; from?: string; to?: string; time?: string; date?: string; priority?: Priority; add_modes?: string[]; remove_modes?: string[]; people?: number; own_vehicle?: 'car' | 'scooter' | 'none'; luggage?: 'light' | 'heavy' }
/** Apply follow-up edits to the chat's current trip request. */
export function applyRouteChanges(base: RouteArgs, c: RouteChanges): RouteArgs {
  const next: RouteArgs = { ...base }
  for (const k of ['from', 'to', 'time', 'date', 'priority', 'people', 'own_vehicle', 'luggage', 'prefer'] as const) if (c[k] !== undefined && c[k] !== null && c[k] !== '') (next as Record<string, unknown>)[k] = c[k]
  if (c.remove_modes?.length) {
    next.avoid = [...new Set([...(next.avoid ?? []), ...c.remove_modes])]
    const gone = modesFromWords(c.remove_modes)
    next.extra = (next.extra ?? []).filter((w) => !modesFromWords([w]).some((m) => gone.includes(m)))
  }
  if (c.add_modes?.length) {
    const add = modesFromWords(c.add_modes)
    next.avoid = (next.avoid ?? []).filter((w) => !modesFromWords([w]).some((m) => add.includes(m)))
    if (next.only?.length) next.only = [...new Set([...next.only, ...c.add_modes])]
    else next.only = undefined
    next.extra = [...new Set([...(next.extra ?? []), ...c.add_modes])]
  }
  return next
}

const TOUR_DEFAULTS: Required<Pick<Answers, 'pace' | 'diet' | 'budget' | 'morning' | 'effort' | 'evening' | 'food'>> = { pace: 2, diet: 0, budget: 0, morning: 'early', effort: 'high', evening: 'early', food: 'sitdown' }

async function tourTool(a: TourArgs, prev: TourArgs | undefined, ctx: ChatContext): Promise<{ card: TourCard; action?: Action; state: TourArgs; text: string }> {
  const merged: TourArgs = { ...prev, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== '')) }
  const missing: string[] = []
  if (!merged.destination) missing.push('destination')
  if (!merged.start) missing.push('start date')
  if (!merged.days) missing.push('number of days')
  const p = merged.destination ? await place(merged.destination, { ...ctx, location: undefined }) : undefined
  const fam = ctx.prefs?.family
  const answers: TourCard['answers'] = {
    ...TOUR_DEFAULTS,
    party: merged.party ?? (fam ? (fam.children ? 'kids' : fam.seniors ? 'seniors' : fam.adults === 2 ? 'couple' : fam.adults > 2 ? 'friends' : 'solo') : 'solo'),
    interests: merged.interests?.length ? merged.interests : ['history', 'culture', 'food'],
    getaround: merged.getaround ?? (ctx.prefs?.modes ? (['walk', 'auto', 'bike', 'cab', ...(ctx.prefs.modes.some((m) => m === 'metro' || m === 'citybus') ? ['transit'] : []), ...(ctx.prefs.vehicles?.car ? ['owncar'] : [])] as Answers['getaround']) : undefined),
    ...Object.fromEntries(Object.entries(merged).filter(([k]) => k !== 'destination' && k !== 'interests' && k !== 'party' && k !== 'getaround')),
    ...(p ? { place: { name: p.name, lat: p.lat, lon: p.lon, state: p.state } } : {}),
    days: Math.max(1, Math.min(4, Number(merged.days ?? 0) || 0)) || undefined,
  } as TourCard['answers']
  const ready = !missing.length
  const card: TourCard = { type: 'tour', title: p ? `${answers.days ?? '?'} days in ${p.name}` : 'Your trip', answers, missing, ready }
  return {
    card, state: merged, action: { type: 'tour', answers, create: ready },
    text: JSON.stringify({ filled_tourist_planner: true, ready, missing, answers: { ...answers, place: p?.name }, note: ready ? 'The app is creating the itinerary now and will link it.' : 'Ask the user for the missing items.' }),
  }
}

async function hotelsTool(a: { place: string; checkin?: string; nights?: number; adults?: number }, ctx: ChatContext): Promise<{ card: HotelCard; text: string; sources: string[] }> {
  const p = await place(a.place, ctx)
  const checkin = /^\d{4}-\d{2}-\d{2}$/.test(a.checkin ?? '') ? a.checkin! : nowIST().date
  const checkout = addDays(checkin, Math.max(1, Math.min(14, a.nights ?? 1)))
  const r = await hotelsNear({ lat: p.lat, lon: p.lon, city: p.city ?? p.name, checkin, checkout, adults: Math.max(1, a.adults ?? 2), children: 0 })
  const items = r.hotels.slice(0, 6).map((h) => ({ name: h.name, price: h.pricePerNight, rating: h.rating, url: h.links[0]?.url, km: h.km }))
  return { card: { type: 'hotels', title: `Stay near ${p.name}`, items, note: r.sources[0] }, sources: r.sources, text: JSON.stringify({ place: p.name, checkin, hotels: items }) }
}

async function weatherTool(a: { place: string }, ctx: ChatContext): Promise<{ card: WeatherCard; text: string; sources: string[] }> {
  const p = await place(a.place, ctx)
  const w = await weather(p.lat, p.lon)
  const days = w.days.slice(0, 5).map((d) => ({ date: d.date, max: Math.round(d.max), min: Math.round(d.min), rain: d.rainProb, summary: WX_TEXT[d.code] ?? (d.rainProb >= 60 ? 'likely rain' : 'fine') }))
  return { card: { type: 'weather', title: `Weather · ${p.name}`, days }, sources: ['Open-Meteo'], text: JSON.stringify({ place: p.name, days }) }
}

const ARR = (desc: string) => ({ type: 'ARRAY', items: { type: 'STRING' }, description: desc })
const TOOL_DECLS = [
  {
    name: 'plan_route',
    description: 'Plan a NEW door-to-door trip with Tripzy (city: metro, bus, auto, bike taxi, cab, own vehicle; long or international: flights, trains, buses, car). Fills the Daily Traveller page. Returns labelled options with real fares and times.',
    parameters: {
      type: 'OBJECT', properties: {
        from: { type: 'STRING', description: 'Start. Omit (or "here") for the user\'s current location.' },
        to: { type: 'STRING', description: 'Destination' },
        time: { type: 'STRING', description: 'Departure HH:MM (24 h). Omit for now.' },
        date: { type: 'STRING', description: 'YYYY-MM-DD. Omit for today.' },
        priority: { type: 'STRING', enum: ['balanced', 'fastest', 'cheapest', 'comfort'] },
        avoid: ARR('Modes to avoid, e.g. ["scooter"] when they do not want to drive in traffic'),
        only: ARR('Use only these modes, e.g. ["metro","bus"]'),
        people: { type: 'NUMBER' },
        own_vehicle: { type: 'STRING', enum: ['car', 'scooter', 'none'] },
        luggage: { type: 'STRING', enum: ['light', 'heavy'] },
      }, required: ['to'],
    },
  },
  {
    name: 'update_route',
    description: 'Change the CURRENT trip in this chat and plan it again (e.g. "make it cheaper", "avoid buses", "use the metro", "leave at 8", "tomorrow", "we are 4", "I have heavy bags", "from Gachibowli instead"). Only pass what changes.',
    parameters: {
      type: 'OBJECT', properties: {
        from: { type: 'STRING' }, to: { type: 'STRING' }, time: { type: 'STRING' }, date: { type: 'STRING' },
        priority: { type: 'STRING', enum: ['balanced', 'fastest', 'cheapest', 'comfort'] },
        add_modes: ARR('Modes to allow again or add'), remove_modes: ARR('Modes to avoid'),
        people: { type: 'NUMBER' }, own_vehicle: { type: 'STRING', enum: ['car', 'scooter', 'none'] }, luggage: { type: 'STRING', enum: ['light', 'heavy'] },
      },
    },
  },
  {
    name: 'plan_tour',
    description: 'Create or change a sightseeing trip (Tourist Planner): destination, dates and style. Fills the Tourist Planner; when destination, start date and days are known the app creates the day-by-day itinerary. Pass only what the user said or changed.',
    parameters: {
      type: 'OBJECT', properties: {
        destination: { type: 'STRING' }, start: { type: 'STRING', description: 'YYYY-MM-DD' }, days: { type: 'NUMBER', description: '1–4' },
        party: { type: 'STRING', enum: ['solo', 'couple', 'friends', 'kids', 'seniors'] },
        budget: { type: 'NUMBER', description: '₹ per person per day, 0 = no limit' }, pace: { type: 'NUMBER', description: '1 relaxed, 2 balanced, 3 packed' },
        diet: { type: 'NUMBER', description: '0 anything, 1 vegetarian, 2 pure-veg' },
        interests: ARR('history, culture, food, shopping, nature, spiritual, art, nightlife, photography, adventure, kids, entertainment'),
        getaround: ARR('walk, auto, bike, cab, transit, owncar, ownscooter'),
        morning: { type: 'STRING', enum: ['early', 'late'] }, evening: { type: 'STRING', enum: ['spiritual', 'nightlife', 'early'] }, food: { type: 'STRING', enum: ['street', 'sitdown'] }, effort: { type: 'STRING', enum: ['high', 'low'] },
      },
    },
  },
  {
    name: 'ask_preferences',
    description: 'Show the preference picker in the chat (comfortable modes, luggage, own vehicle, who travels, priority). Use when they are unknown and matter for the request, or when the user asks to change their preferences.',
    parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING' } } },
  },
  { name: 'find_hotels', description: 'Hotels near a place with nightly prices and booking links.', parameters: { type: 'OBJECT', properties: { place: { type: 'STRING' }, checkin: { type: 'STRING' }, nights: { type: 'NUMBER' }, adults: { type: 'NUMBER' } }, required: ['place'] } },
  { name: 'get_weather', description: 'Five-day forecast for a place.', parameters: { type: 'OBJECT', properties: { place: { type: 'STRING' } }, required: ['place'] } },
]

type Out = { cards: Card[]; actions: Action[]; sources: Set<string>; tools: string[]; state: ChatState }
async function runTool(name: string, args: Record<string, unknown>, ctx: ChatContext, out: Out): Promise<string> {
  out.tools.push(name)
  if (name === 'plan_route' || name === 'update_route') {
    const req = name === 'plan_route' ? (args as RouteArgs) : out.state.route ? applyRouteChanges(out.state.route, args as RouteChanges) : null
    if (!req) return JSON.stringify({ error: 'There is no trip in this chat yet — ask where they want to go.' })
    const r = await planRouteTool(req, ctx)
    out.cards.push(r.card); out.actions.push(r.action); r.sources.forEach((s) => out.sources.add(s))
    out.state = { ...out.state, route: r.card.request, pending: undefined }
    return r.text
  }
  if (name === 'plan_tour') {
    const r = await tourTool(args as TourArgs, out.state.tour, ctx)
    out.cards.push(r.card); if (r.action) out.actions.push(r.action)
    out.state = { ...out.state, tour: r.state }
    return r.text
  }
  if (name === 'ask_preferences') {
    out.cards.push({ type: 'prefs', reason: String(args.reason ?? 'So I plan the way you like to travel'), current: ctx.prefs ?? {} })
    return JSON.stringify({ shown: true, note: 'The picker is in the chat. Wait for the user to choose.' })
  }
  if (name === 'find_hotels') { const r = await hotelsTool(args as { place: string }, ctx); out.cards.push(r.card); r.sources.forEach((s) => out.sources.add(s)); return r.text }
  if (name === 'get_weather') { const r = await weatherTool(args as { place: string }, ctx); out.cards.push(r.card); r.sources.forEach((s) => out.sources.add(s)); return r.text }
  return JSON.stringify({ error: `Unknown tool ${name}` })
}

// ---------------------------------------------------------------- Gemini loop

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } }
type Content = { role: 'user' | 'model'; parts: Part[] }

function systemPrompt(ctx: ChatContext, state: ChatState, passages: Doc[]) {
  const n = nowIST()
  const p = ctx.prefs
  return [
    'You are Tripzy AI inside the Tripzy app. You do the app\'s work for the user through tools: Daily Traveller (city and long journeys) and Tourist Planner (sightseeing trips). The app fills those pages with what you plan.',
    `Today is ${n.date}, now ${n.time} IST.${ctx.location ? ` The user is at ${ctx.location.name ?? `${ctx.location.lat.toFixed(4)},${ctx.location.lon.toFixed(4)}`}.` : ' Location unknown.'}`,
    `Saved preferences (${ctx.prefsKnown ? 'confirmed' : 'NOT confirmed yet'}): modes ${p?.modes?.join(', ') || 'unknown'}; luggage ${p?.luggage ?? 'unknown'}; vehicles ${p?.vehicles?.car ? `car ${p.vehicles.car.kmpl} km/l ` : ''}${p?.vehicles?.scooter ? `scooter ${p.vehicles.scooter.kmpl} km/l` : ''}${!p?.vehicles?.car && !p?.vehicles?.scooter ? 'none' : ''}; family ${p?.family ? `${p.family.adults} adults, ${p.family.children} children, ${p.family.seniors} seniors` : 'unknown'}; priority ${p?.priority ?? 'balanced'}.`,
    `Current trip in this chat: ${state.route ? JSON.stringify(state.route) : 'none'}. Current tour: ${state.tour ? JSON.stringify(state.tour) : 'none'}.`,
    'Rules:',
    '- A new trip → plan_route. A change to the current trip ("cheaper", "faster", "avoid X", "use metro", "leave at", "tomorrow", "we are N", "heavy bags", "from/to Y instead") → update_route with only the changes.',
    '- A sightseeing trip ("3 days in Jaipur", "plan my Goa trip") → plan_tour; follow-ups ("make it 2 days", "more food places", "we are vegetarian") → plan_tour with the change. Ask for destination, start date and days if missing.',
    '- If preferences are NOT confirmed and the request is a trip, call ask_preferences first (once) and wait.',
    '- Map intent: hurry → fastest; save money → cheapest; comfortable / AC / kids / elders / heavy bags → comfort; pollution / traffic / "by metro" → keep the metro and LEAD with the "Least traffic & pollution" or "Via metro" option (board at the nearest station, metro for the long part).',
    '- "I have a scooty/car" → own_vehicle; "but don\'t want to drive in traffic" → avoid it.',
    '- Never invent fares, times or places — only what tools return. Answer in 2–5 short lines: the recommended option with time and fare, the other options briefly, why. Say the Daily Traveller / Tourist Planner page has been filled. Use the user\'s language.',
    passages.length ? `Help passages:\n${passages.map((d) => `[${d.title}] ${d.text}`).join('\n\n')}` : '',
  ].filter(Boolean).join('\n')
}

async function withGemini(history: ChatMsg[], ctx: ChatContext, state: ChatState, passages: Doc[]): Promise<AgentReply> {
  const contents: Content[] = history.slice(-14).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
  const out: Out = { cards: [], actions: [], sources: new Set(), tools: [], state: { ...state } }
  for (let step = 0; step < 4; step++) {
    const j = await geminiGenerate<{ candidates?: { content?: Content }[] }>(
      { systemInstruction: { parts: [{ text: systemPrompt(ctx, out.state, passages) }] }, contents, tools: [{ functionDeclarations: TOOL_DECLS }], generationConfig: { temperature: 0.3 } }, 10000)
    const c = j.candidates?.[0]?.content
    if (!c?.parts?.length) throw new UpstreamError('The AI returned no answer', 502)
    contents.push({ role: 'model', parts: c.parts })
    const calls = c.parts.filter((p) => p.functionCall)
    if (!calls.length) return { reply: c.parts.map((p) => p.text ?? '').join('').trim(), cards: out.cards, actions: out.actions, state: out.state, tools: out.tools, engine: 'gemini', sources: [...out.sources] }
    const responses: Part[] = []
    for (const call of calls) {
      const { name, args } = call.functionCall!
      try { responses.push({ functionResponse: { name, response: { result: await runTool(name, args ?? {}, ctx, out) } } }) }
      catch (e) { responses.push({ functionResponse: { name, response: { error: (e as Error).message } } }) }
    }
    contents.push({ role: 'user', parts: responses })
    if (out.cards.some((x) => x.type === 'prefs')) break // wait for the user's choices
  }
  return { reply: out.cards.some((x) => x.type === 'prefs') ? 'Before I plan, choose how you like to travel — I will remember it.' : 'Here is what I found.', cards: out.cards, actions: out.actions, state: out.state, tools: out.tools, engine: 'gemini', sources: [...out.sources] }
}

// ---------------------------------------------------------------- rule-based understanding (also the offline fallback)

type Intent =
  | { kind: 'route'; args: RouteArgs }
  | { kind: 'edit'; changes: RouteChanges }
  | { kind: 'tour'; args: TourArgs }
  | { kind: 'prefs' }
  | { kind: 'hotels' | 'weather'; place: string }
  | { kind: 'help' }

function timeOf(t: string): string | undefined {
  const m = t.match(/\b(?:at|by|around|leave at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i) ?? t.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/i) ?? t.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if (!m) return undefined
  let h = +m[1]
  const ap = (m[3] ?? (m[2] && /am|pm/i.test(m[2]) ? m[2] : ''))?.toLowerCase()
  const mm = m[2] && /^\d{2}$/.test(m[2]) ? m[2] : '00'
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return h < 24 ? `${String(h).padStart(2, '0')}:${mm}` : undefined
}
const dateOf = (t: string) => (/day after tomorrow/i.test(t) ? addDays(nowIST().date, 2) : /tomorrow/i.test(t) ? addDays(nowIST().date, 1) : /today|tonight/i.test(t) ? nowIST().date : t.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1])
const priorityOf = (t: string): Priority | undefined => (/hurry|faster|fastest|quick|late|asap|urgent/i.test(t) ? 'fastest' : /cheap|save|budget|less money|low cost|cheaper/i.test(t) ? 'cheapest' : /comfort|relax|\bac\b|luggage|kids|elder|senior|no crowd/i.test(t) ? 'comfort' : undefined)

export function parseIntent(text: string, state: ChatState = {}): Intent {
  const t = text.trim()
  if (/^my preferences:/i.test(t)) return { kind: 'prefs' }
  if (/\b(change|update|set|edit)\b.*\bpreferences?\b|\bmy preferences\b/i.test(t)) return { kind: 'prefs' }
  const hotel = t.match(/\b(hotels?|stay|rooms?)\b/i) && t.match(/\b(?:in|near|at)\s+([\p{L}\s.,'-]+?)(?:\s+(?:for|on|from)\b|[?.!]|$)/iu)
  if (hotel) return { kind: 'hotels', place: hotel[1].trim() }
  const wx = t.match(/\b(weather|rain|temperature|forecast)\b/i) && t.match(/\b(?:in|at|for)\s+([\p{L}\s.,'-]+?)(?:[?.!]|$)/iu)
  if (wx) return { kind: 'weather', place: wx[1].trim() }
  // sightseeing: "3 days in Jaipur", "plan a trip to Goa from 2026-12-20", follow-ups on a tour
  const days = Number(t.match(/\b(\d)\s*-?\s*days?\b/i)?.[1]) || undefined
  const tourWords = /\b(trip|tour|holiday|vacation|itinerary|sightseeing|visit|explore)\b/i.test(t) || (days && /\bin\s+\p{L}/iu.test(t))
  if (tourWords || (state.tour && !state.route && (days || /\bveg|food|history|nature|relaxed|packed|kids|start\b/i.test(t)))) {
    const dest = t.match(/\b(?:to|in|at|visit|explore)\s+([\p{L}][\p{L} .'-]+?)(?=\s+(?:for|from|on|starting|next|this|with|in)\b|[?.!,]|$)/iu)?.[1]?.trim()
    const interests = (['history', 'culture', 'food', 'shopping', 'nature', 'spiritual', 'art', 'nightlife', 'photography', 'adventure', 'entertainment'] as const).filter((w) => new RegExp(`\\b${w}`, 'i').test(t))
    return {
      kind: 'tour', args: {
        destination: dest && !/^(the|a|my)$/i.test(dest) ? dest : undefined, days, start: dateOf(t),
        party: /\bkids?|children\b/i.test(t) ? 'kids' : /parents|seniors|elders/i.test(t) ? 'seniors' : /\bwife|husband|partner|couple\b/i.test(t) ? 'couple' : /friends/i.test(t) ? 'friends' : /\balone|solo\b/i.test(t) ? 'solo' : undefined,
        diet: /pure.?veg/i.test(t) ? 2 : /\bveg(etarian)?\b/i.test(t) ? 1 : undefined,
        pace: /relax|slow|easy/i.test(t) ? 1 : /packed|as much as|lots/i.test(t) ? 3 : undefined,
        interests: interests.length ? [...interests] : undefined,
      },
    }
  }
  // the trip is in the sentence that says "to" ("I have a scooty… . Karmanghat to Kokapet")
  const sentences = t.split(/(?<=[.!?;])\s+/)
  const tripS = [...sentences].reverse().find((x) => /\b(to|reach|towards)\b|→|->/i.test(x)) ?? t
  const LEAD = /^(?:(?:please|pls|hey|hi|ok|so|now|i am in a hurry|i'm in a hurry|in a hurry)[,;:]?\s+)*(?:(?:can you\s+)?(?:take me|get me|show me(?: the)?(?: fastest| cheapest| best| quickest)?(?: option| route| way)?|plan(?: a)?(?: route)?|route|i want to go|i need to go|i have to go|how (?:do|can) i (?:go|get|reach)|go)\s+)*/i
  const STOPW = String.raw`(?=\s+(?:at|by|on|tomorrow|today|tonight|now|but|and|with|in a hurry|asap|for)\b|[?.!,;]|$)`
  const body = tripS.replace(LEAD, '').trim()
  const m = body.match(new RegExp(String.raw`(?:^|\bfrom\s+)([\p{L}\d .,'-]+?)\s+(?:to|→|->)\s+([\p{L}\d .,'-]+?)` + STOPW, 'iu'))
  const toOnly = !m ? body.match(new RegExp(String.raw`(?:^|\b(?:to|reach)\s+)([\p{L}\d .,'-]+?)` + STOPW, 'iu')) : null
  const hasScooter = /scoot(y|er)|activa|two.?wheeler/i.test(t), hasCar = /\bmy car\b|own car|have a car/i.test(t)
  const noDrive = /(don'?t|do not|dont|not)\s+(want|like)\s+to\s+(drive|ride)|no driving|avoid traffic|in traffic/i.test(t)
  const avoidList = (s: string) => [...s.matchAll(/\b(?:no|avoid|without|not by|skip)\s+(bus(?:es)?|metro|bike(?: taxi)?s?|autos?|cabs?|walking|trains?)/gi)].map((x) => x[1])
  const addList = (s: string) => [...s.matchAll(/\b(?:use|by|via|add|include|allow|with)\s+(?:the\s+)?(metro|bus(?:es)?|bike(?: taxi)?|autos?|cabs?|trains?)/gi)].map((x) => x[1])
  const people = Number(t.match(/\b(\d{1,2})\s+(people|persons|of us|friends|members|adults)/i)?.[1]) || Number(t.match(/\bwe are (\d{1,2})\b/i)?.[1]) || undefined
  const luggage = /heavy (bags|luggage)|lots of (bags|luggage)|big (bags|suitcase)/i.test(t) ? 'heavy' as const : /light (bags|luggage)|no luggage|just a (bag|backpack)/i.test(t) ? 'light' as const : undefined
  if (!m && !(toOnly && /\b(to|reach|go|take me)\b/i.test(t))) {
    // a follow-up on the current trip?
    if (state.route) {
      const changes: RouteChanges = {
        priority: priorityOf(t), time: timeOf(t), date: dateOf(t), people, luggage,
        remove_modes: [...avoidList(t), ...(noDrive && hasScooter ? ['scooter'] : []), ...(noDrive && hasCar ? ['my car'] : [])],
        add_modes: [...addList(t), ...(/pollution|traffic/i.test(t) && !noDrive ? ['metro'] : [])],
        prefer: /pollution|traffic|fumes|dust/i.test(t) && !noDrive ? 'clean' : undefined,
        own_vehicle: hasScooter && !noDrive ? 'scooter' : hasCar && !noDrive ? 'car' : undefined,
        from: t.match(/\bfrom\s+([\p{L}][\p{L} .'-]+?)(?:\s+instead)?(?=[?.!,]|$)/iu)?.[1],
      }
      if (Object.values(changes).some((v) => (Array.isArray(v) ? v.length : v !== undefined))) return { kind: 'edit', changes }
    }
    return { kind: 'help' }
  }
  return {
    kind: 'route',
    args: {
      from: m ? m[1].replace(/^from\s+/i, '').trim() : undefined, to: (m ? m[2] : toOnly![1]).trim(), time: timeOf(t), date: dateOf(t), priority: priorityOf(t),
      avoid: [noDrive && hasScooter ? 'scooter' : '', noDrive && hasCar ? 'my car' : '', ...avoidList(t)].filter(Boolean),
      only: /public transport only|only (metro|bus)|by metro|by bus/i.test(t) ? ['metro', 'bus', 'walk'] : undefined,
      people, luggage, own_vehicle: hasScooter && !noDrive ? 'scooter' : hasCar && !noDrive ? 'car' : 'none',
      prefer: /pollution|traffic|fumes|dust/i.test(t) && !noDrive ? 'clean' : undefined,
    },
  }
}

function describeRoutes(card: RouteCard, args: RouteArgs): string {
  const o = card.options
  if (!o.length) return `${card.note ?? 'No route found with those modes.'} Try adding auto or bike taxi.`
  const want = args.priority === 'fastest' ? 'Fastest' : args.priority === 'cheapest' ? 'Cheapest' : args.priority === 'comfort' ? 'Most comfortable' : card.journey ? 'Best balanced' : 'Recommended'
  const pick = (args.prefer === 'clean' ? o.find((x) => x.labels.includes('Least traffic & pollution') || x.labels.includes('Via metro')) : undefined) ?? o.find((x) => x.labels.includes(want)) ?? o[0]
  const money = (x: typeof pick) => `₹${x.fare.toLocaleString('en-IN')}${x.perPerson ? '' : ' total'}`
  return [
    `**${pick.labels.join(' · ')}: ${fmtDur(pick.minutes)}, ${money(pick)}** — ${pick.summary}`,
    ...o.filter((x) => x !== pick).slice(0, 4).map((x) => `${x.labels.join(' · ')}: ${fmtDur(x.minutes)}, ${money(x)} — ${x.summary}`),
    args.avoid?.length ? `Left out: ${args.avoid.join(', ')}.` : '',
    'I filled Daily Traveller with this — open it for the map, every leg and booking links.',
  ].filter(Boolean).join('\n')
}

async function withRules(history: ChatMsg[], ctx: ChatContext, state: ChatState, passages: Doc[]): Promise<AgentReply> {
  const last = history.filter((m) => m.role === 'user').pop()?.text ?? ''
  const intent = parseIntent(last, state)
  const out: Out = { cards: [], actions: [], sources: new Set(), tools: [], state: { ...state } }
  const done = (reply: string): AgentReply => ({ reply, cards: out.cards, actions: out.actions, state: out.state, tools: out.tools, engine: 'rules', sources: [...out.sources] })
  try {
    if (intent.kind === 'prefs') {
      if (/^my preferences:/i.test(last) && state.pending) { await runTool('plan_route', state.pending as unknown as Record<string, unknown>, ctx, out); const c = out.cards.find((x) => x.type === 'routes') as RouteCard; return done(`Saved. ${describeRoutes(c, c.request)}`) }
      if (/^my preferences:/i.test(last)) return done('Saved — I will plan with these from now on. Where would you like to go?')
      await runTool('ask_preferences', { reason: 'Update how you like to travel' }, ctx, out)
      return done('Choose how you like to travel — I will remember it.')
    }
    if (intent.kind === 'route') {
      await runTool('plan_route', intent.args as unknown as Record<string, unknown>, ctx, out)
      const c = out.cards.find((x) => x.type === 'routes') as RouteCard
      return done(describeRoutes(c, c.request))
    }
    if (intent.kind === 'edit') {
      await runTool('update_route', intent.changes as unknown as Record<string, unknown>, ctx, out)
      const c = out.cards.find((x) => x.type === 'routes') as RouteCard
      return done(`Updated. ${describeRoutes(c, c.request)}`)
    }
    if (intent.kind === 'tour') {
      await runTool('plan_tour', intent.args as unknown as Record<string, unknown>, ctx, out)
      const c = out.cards.find((x) => x.type === 'tour') as TourCard
      return done(c.ready ? `Creating your ${c.title} itinerary now — I filled the Tourist Planner with your answers.` : `Got it. I still need: ${c.missing.join(', ')}.`)
    }
    if (intent.kind === 'hotels') { await runTool('find_hotels', { place: intent.place }, ctx, out); return done(`Places to stay near ${intent.place}.`) }
    if (intent.kind === 'weather') { await runTool('get_weather', { place: intent.place }, ctx, out); return done(`Forecast for ${intent.place}.`) }
  } catch (e) {
    return done((e as Error).message)
  }
  if (passages.length) { out.tools.push('search_help'); out.sources.add(`Tripzy help: ${passages[0].title}`); return done(passages[0].text.split('\n').slice(0, 6).join('\n')) }
  return done('Tell me where you want to go — for example "Kokapet to Miyapur at 6 pm" — or a trip like "3 days in Jaipur from 20 December".')
}

export async function chat(history: ChatMsg[], ctx: ChatContext, state: ChatState = {}): Promise<AgentReply> {
  const last = history.filter((m) => m.role === 'user').pop()?.text ?? ''
  const memory: Doc[] = (ctx.memory ?? []).slice(0, 40).map((m, i) => ({ id: `mem${i}`, title: m.title, text: m.text, source: 'your Tripzy data' }))
  const passages = retrieve(last, memory, 4)
  // preferences just chosen in the picker: plan the trip that was waiting, right away
  if (/^my preferences:/i.test(last) && state.pending) return withRules(history, ctx, state, passages)
  if (env('GEMINI_API_KEY')) {
    try {
      // answer within ~25 s: if the model is overloaded, the rule-based planner answers instead
      const r = await Promise.race([
        withGemini(history, ctx, state, passages),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('AI took longer than 25 s')), 25000)),
      ])
      if (r.reply || r.cards.length) return { ...r, sources: [...r.sources, ...passages.slice(0, 2).map((p) => `${p.source === 'your Tripzy data' ? 'Your data' : 'Tripzy help'}: ${p.title}`)] }
    } catch (e) { console.warn('Tripzy AI: Gemini failed, using rules —', (e as Error).message) }
  }
  return withRules(history, ctx, state, passages)
}
