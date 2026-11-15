/**
 * Tripzy AI: a chat agent over the app's own planners.
 *  - Gemini (function calling) decides what to do; the tools run Tripzy's real planners (city routes,
 *    long journeys, hotels, weather, geocoding), so every fare and time in an answer comes from data.
 *  - Retrieval (BM25, rag.ts) grounds answers about the app and about the user (saved routes, trips,
 *    preferences sent by the app).
 *  - Without Gemini (no key, quota, outage) a rule-based parser handles the common requests
 *    ("Kokapet to Miyapur", "I'm in a hurry", "I have a scooty but don't want to drive in traffic").
 */
import type { Family, Mode, Priority, Vehicles } from '../../src/lib/types'
import { DEFAULT_PREFS, MODE_LABEL, MODES } from '../../src/lib/types'
import { env, haversineKm, UpstreamError } from '../lib'
import { geminiGenerate } from '../providers/ai'
import { planCommute, type Point } from '../plan/commute'
import { planJourney } from '../plan/journey'
import { geocode } from '../providers/geo'
import { hotelsNear } from '../providers/hotels'
import { weather, WX_TEXT } from '../providers/weather'
import { retrieve, type Doc } from './rag'

export type ChatMsg = { role: 'user' | 'assistant'; text: string }
export type ChatContext = {
  location?: { lat: number; lon: number; name?: string }
  prefs?: { modes?: Mode[]; vehicles?: Vehicles; family?: Family; priority?: Priority }
  memory?: { title: string; text: string }[]
  name?: string
}
export type RouteCard = { type: 'routes'; title: string; url: string; journey: boolean; options: { labels: string[]; minutes: number; fare: number; perPerson: boolean; summary: string }[]; note?: string }
export type HotelCard = { type: 'hotels'; title: string; items: { name: string; price?: number; rating?: number; url?: string; km: number }[]; note?: string }
export type WeatherCard = { type: 'weather'; title: string; days: { date: string; max: number; min: number; rain: number; summary: string }[] }
export type Card = RouteCard | HotelCard | WeatherCard
export type AgentReply = { reply: string; cards: Card[]; tools: string[]; engine: 'gemini' | 'rules'; sources: string[] }

const IN = (p: { lat: number; lon: number }) => p.lat > 6 && p.lat < 37.5 && p.lon > 68 && p.lon < 97.5
const nowIST = () => {
  const d = new Date(Date.now() + 330 * 60000)
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }
}
const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`)
const ll = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`

// ---------------------------------------------------------------- tools

const MODE_WORDS: [RegExp, Mode[]][] = [
  [/scoot(y|er)|two.?wheeler|activa|my bike/i, ['ownscooter']], [/my car|own car|drive/i, ['owncar']], [/bike taxi|rapido/i, ['bike']],
  [/\bbus(es)?\b/i, ['citybus']], [/metro/i, ['metro']], [/\bauto/i, ['auto']], [/\bcabs?\b|uber|ola\b|taxi/i, ['cab', 'suv']], [/walk/i, ['walk']], [/train|mmts/i, ['rail', 'train']],
]
export const modesFromWords = (words: string[] = []) => [...new Set(words.flatMap((w) => MODE_WORDS.filter(([re]) => re.test(w)).flatMap(([, m]) => m)).concat(words.filter((w): w is Mode => (MODES as readonly string[]).includes(w))))]

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

type RouteArgs = { from?: string; to: string; time?: string; date?: string; priority?: Priority; avoid?: string[]; only?: string[]; people?: number; own_vehicle?: 'car' | 'scooter' | 'none' }

export async function planRouteTool(a: RouteArgs, ctx: ChatContext): Promise<{ card: RouteCard; text: string; sources: string[] }> {
  if (!a.to) throw new UpstreamError('Where do you want to go?', 400)
  if (!a.from && !ctx.location) throw new UpstreamError('Where are you starting from? (Or allow location access.)', 400)
  const [from, to] = await Promise.all([a.from ? place(a.from, ctx) : place('here', ctx), place(a.to, ctx)])
  const now = nowIST()
  const time = /^\d{1,2}:\d{2}$/.test(a.time ?? '') ? a.time!.padStart(5, '0') : now.time
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '') ? a.date! : now.date
  const own = a.own_vehicle ?? 'none'
  const avoid = modesFromWords(a.avoid)
  let modes: Mode[] = a.only?.length ? modesFromWords(a.only) : [...new Set<Mode>([...(ctx.prefs?.modes?.length ? ctx.prefs.modes : DEFAULT_PREFS.modes), 'walk', 'cab'])]
  if (own === 'scooter') modes.push('ownscooter')
  if (own === 'car') modes.push('owncar')
  modes = [...new Set(modes)].filter((m) => !avoid.includes(m) || m === 'walk')
  const party = ctx.prefs?.family && (a.people ?? 0) <= 0 ? ctx.prefs.family : { adults: Math.max(1, a.people ?? 1), children: 0, seniors: 0 }
  const people = party.adults + party.children + party.seniors
  const priority: Priority = a.priority ?? ctx.prefs?.priority ?? 'balanced'
  const journey = !IN(from) || !IN(to) || haversineKm(from, to) > 80
  const q = new URLSearchParams({ f: from.name, fl: ll(from), t: to.name, tl: ll(to), tm: time, m: modes.join(','), d: date })
  if (people > 1 && !journey) q.set('p', String(people))
  if (journey) { q.set('pa', `${party.adults}.${party.children}.${party.seniors}`); q.set('lg', 'light'); q.set('pr', priority); q.set('ow', own) }
  const url = `/commute?${q}`
  if (journey) {
    const j = await planJourney({ from, to, date, time, party, luggage: 'light', priority, own, vehicles: ctx.prefs?.vehicles, modes })
    const options = j.options.slice(0, 5).map((o) => ({ labels: o.tags, minutes: o.minutes, fare: o.cost, perPerson: false, summary: `${o.title} — ${o.legs.map((l) => l.name).join(' → ')}` }))
    const card: RouteCard = { type: 'routes', title: `${from.name} → ${to.name}`, url, journey: true, options, note: j.message }
    return { card, sources: j.sources, text: JSON.stringify({ from: from.name, to: to.name, date, time, people, priority, options: options.map((o) => ({ ...o, duration: fmtDur(o.minutes), cost_total_inr: o.fare })), open_in_app: url }) }
  }
  const r = await planCommute({ from, to, date, time, modes, people, vehicles: own === 'none' ? ctx.prefs?.vehicles : { ...ctx.prefs?.vehicles, ...(own === 'scooter' ? { scooter: ctx.prefs?.vehicles?.scooter ?? { kmpl: 45 } } : { car: ctx.prefs?.vehicles?.car ?? { kmpl: 15, fuel: 'petrol', seats: 5 } }) } })
  const options = r.routes.map((x) => ({
    labels: x.labels as string[], minutes: x.totalMin, fare: x.fare, perPerson: true,
    summary: x.legs.filter((l) => l.mode !== 'walk' || l.km > 0.5).map((l) => `${l.mode === 'metro' && /^Metro /.test(l.name) ? l.name : `${MODE_LABEL[l.mode]}${l.mode === 'metro' || l.mode === 'citybus' ? ` ${l.name.replace(/^City bus /, '')}` : ''}`} ${l.fromName.replace(/ (bus stop|Metro)$/, '')}→${l.toName.replace(/ (bus stop|Metro)$/, '')}${l.km >= 1 ? ` ${Math.round(l.km)} km` : ''}`).join(' › '),
  }))
  const alts = r.routes.flatMap((x) => x.legs).find((l) => (l as { alts?: unknown[] }).alts) as { fromName: string; alts: { mode: Mode; minutes: number; fare: number; wait: number }[] } | undefined
  const card: RouteCard = { type: 'routes', title: `${from.name} → ${to.name} · ${time}`, url, journey: false, options, note: r.message }
  return {
    card, sources: r.sources,
    text: JSON.stringify({
      from: from.name, to: to.name, date, time, people, modes_used: modes, priority_asked: priority, message: r.message,
      options: options.map((o) => ({ ...o, duration: fmtDur(o.minutes), fare_inr_per_person: o.fare })),
      alternatives_at_last_stop: alts ? { stop: alts.fromName, options: alts.alts.map((x) => `${MODE_LABEL[x.mode]} ${x.minutes} min ₹${x.fare}${x.wait > 1 ? ` (next in ${x.wait} min)` : ''}`) } : undefined,
      suggestions: r.suggestions.map((s) => s.text), open_in_app: url,
    }),
  }
}

async function hotelsTool(a: { place: string; checkin?: string; nights?: number; adults?: number }, ctx: ChatContext): Promise<{ card: HotelCard; text: string; sources: string[] }> {
  const p = await place(a.place, ctx)
  const checkin = /^\d{4}-\d{2}-\d{2}$/.test(a.checkin ?? '') ? a.checkin! : nowIST().date
  const out = new Date(`${checkin}T12:00:00`); out.setDate(out.getDate() + Math.max(1, Math.min(14, a.nights ?? 1)))
  const r = await hotelsNear({ lat: p.lat, lon: p.lon, city: p.city ?? p.name, checkin, checkout: out.toISOString().slice(0, 10), adults: Math.max(1, a.adults ?? 2), children: 0 })
  const items = r.hotels.slice(0, 6).map((h) => ({ name: h.name, price: h.pricePerNight, rating: h.rating, url: h.links[0]?.url, km: h.km }))
  return { card: { type: 'hotels', title: `Stay near ${p.name}`, items, note: r.sources[0] }, sources: r.sources, text: JSON.stringify({ place: p.name, checkin, hotels: items }) }
}

async function weatherTool(a: { place: string }, ctx: ChatContext): Promise<{ card: WeatherCard; text: string; sources: string[] }> {
  const p = await place(a.place, ctx)
  const w = await weather(p.lat, p.lon)
  const days = w.days.slice(0, 5).map((d) => ({ date: d.date, max: Math.round(d.max), min: Math.round(d.min), rain: d.rainProb, summary: WX_TEXT[d.code] ?? (d.rainProb >= 60 ? 'likely rain' : 'fine') }))
  return { card: { type: 'weather', title: `Weather · ${p.name}`, days }, sources: ['Open-Meteo'], text: JSON.stringify({ place: p.name, days }) }
}

const TOOL_DECLS = [
  {
    name: 'plan_route',
    description: 'Plan a door-to-door trip with Tripzy (city routes mixing metro, bus, auto, bike taxi, cab and own vehicle; long or international journeys with flights, trains, buses, car). Returns labelled options (Recommended, Fastest, Cheapest, Most comfortable) with real fares and times, and a link to open it in the app.',
    parameters: {
      type: 'OBJECT', properties: {
        from: { type: 'STRING', description: 'Start place. Omit (or "here") to use the user\'s current location.' },
        to: { type: 'STRING', description: 'Destination place' },
        time: { type: 'STRING', description: 'Departure time HH:MM (24 h). Omit for now.' },
        date: { type: 'STRING', description: 'YYYY-MM-DD. Omit for today.' },
        priority: { type: 'STRING', enum: ['balanced', 'fastest', 'cheapest', 'comfort'], description: 'What matters: hurry → fastest, save money → cheapest, comfort/AC/no crowds → comfort' },
        avoid: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Modes to avoid, e.g. ["scooter"] if they do not want to drive in traffic, ["bus"], ["bike taxi"]' },
        only: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Use only these modes, e.g. ["metro","bus","walk"] for public transport only' },
        people: { type: 'NUMBER', description: 'Number of travellers if stated' },
        own_vehicle: { type: 'STRING', enum: ['car', 'scooter', 'none'], description: 'Include the user\'s own vehicle (car or scooter) as the first ride' },
      }, required: ['to'],
    },
  },
  {
    name: 'find_hotels', description: 'Hotels near a place with nightly prices and booking links.',
    parameters: { type: 'OBJECT', properties: { place: { type: 'STRING' }, checkin: { type: 'STRING', description: 'YYYY-MM-DD' }, nights: { type: 'NUMBER' }, adults: { type: 'NUMBER' } }, required: ['place'] },
  },
  {
    name: 'get_weather', description: 'Five-day weather forecast for a place (temperature, rain chance).',
    parameters: { type: 'OBJECT', properties: { place: { type: 'STRING' } }, required: ['place'] },
  },
]

async function runTool(name: string, args: Record<string, unknown>, ctx: ChatContext) {
  if (name === 'plan_route') return planRouteTool(args as RouteArgs, ctx)
  if (name === 'find_hotels') return hotelsTool(args as { place: string }, ctx)
  if (name === 'get_weather') return weatherTool(args as { place: string }, ctx)
  throw new UpstreamError(`Unknown tool ${name}`, 400)
}

// ---------------------------------------------------------------- Gemini loop

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } }
type Content = { role: 'user' | 'model'; parts: Part[] }

function systemPrompt(ctx: ChatContext, passages: Doc[]) {
  const n = nowIST()
  const p = ctx.prefs
  return [
    'You are Tripzy AI, the travel assistant inside the Tripzy app (India-first, works worldwide).',
    `Today is ${n.date}, time now ${n.time} (IST).${ctx.location ? ` The user is at ${ctx.location.name ?? `${ctx.location.lat.toFixed(4)},${ctx.location.lon.toFixed(4)}`}.` : ' The user\'s location is unknown.'}`,
    p ? `User profile: usual modes ${p.modes?.join(', ') || 'not set'}; vehicles ${p.vehicles?.car ? `car (${p.vehicles.car.kmpl} km/l)` : ''}${p.vehicles?.scooter ? ` scooter (${p.vehicles.scooter.kmpl} km/l)` : ''}${!p.vehicles?.car && !p.vehicles?.scooter ? 'none saved' : ''}; family ${p.family ? `${p.family.adults} adults, ${p.family.children} children, ${p.family.seniors} seniors` : 'not set'}; priority ${p.priority ?? 'balanced'}.` : '',
    'Rules:',
    '- For any trip request call plan_route. Never invent fares, times, routes or hotel prices — only state what tools return.',
    '- Map intent to arguments: "in a hurry" → priority fastest; "cheap / save money" → cheapest; "comfortable / AC / no crowds / with luggage or kids" → comfort.',
    '- "I have a scooty/car" → own_vehicle; "but don\'t want to drive in traffic" → avoid that vehicle (then offer park-and-ride or metro).',
    '- Answer in 2–5 short lines: name the Recommended option first with time and fare, then the others briefly, then the reason. Mention "Other ways from <stop>" when given. End with: Open in Tripzy → <open_in_app link>.',
    '- If the destination is missing, ask one short question. Use the user\'s language.',
    '- For questions about how Tripzy works, use the passages below.',
    passages.length ? `Passages:\n${passages.map((d) => `[${d.title}] ${d.text}`).join('\n\n')}` : '',
  ].filter(Boolean).join('\n')
}

async function gemini(contents: Content[], system: string): Promise<Content> {
  const j = await geminiGenerate<{ candidates?: { content?: Content }[] }>(
    { systemInstruction: { parts: [{ text: system }] }, contents, tools: [{ functionDeclarations: TOOL_DECLS }], generationConfig: { temperature: 0.3 } }, 10000)
  const c = j.candidates?.[0]?.content
  if (!c?.parts?.length) throw new UpstreamError('The AI returned no answer', 502)
  return { role: 'model', parts: c.parts }
}

async function withGemini(history: ChatMsg[], ctx: ChatContext, passages: Doc[]): Promise<AgentReply> {
  const contents: Content[] = history.slice(-12).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
  const system = systemPrompt(ctx, passages)
  const cards: Card[] = [], tools: string[] = [], sources = new Set<string>()
  for (let step = 0; step < 4; step++) {
    const out = await gemini(contents, system)
    contents.push(out)
    const calls = out.parts.filter((p) => p.functionCall)
    if (!calls.length) return { reply: out.parts.map((p) => p.text ?? '').join('').trim(), cards, tools, engine: 'gemini', sources: [...sources] }
    const responses: Part[] = []
    for (const c of calls) {
      const { name, args } = c.functionCall!
      tools.push(name)
      try {
        const r = await runTool(name, args ?? {}, ctx)
        cards.push(r.card); r.sources.forEach((s) => sources.add(s))
        responses.push({ functionResponse: { name, response: { result: r.text } } })
      } catch (e) {
        responses.push({ functionResponse: { name, response: { error: (e as Error).message } } })
      }
    }
    contents.push({ role: 'user', parts: responses })
  }
  return { reply: 'Here is what I found.', cards, tools, engine: 'gemini', sources: [...sources] }
}

// ---------------------------------------------------------------- rule-based fallback

export function parseIntent(text: string): { kind: 'route'; args: RouteArgs } | { kind: 'hotels' | 'weather'; place: string } | { kind: 'help' } {
  const t = text.trim()
  const hotel = t.match(/\b(hotels?|stay|rooms?)\b/i) && t.match(/\b(?:in|near|at)\s+([\p{L}\s.,'-]+?)(?:\s+(?:for|on|from)\b|[?.!]|$)/iu)
  if (hotel) return { kind: 'hotels', place: hotel[1].trim() }
  const wx = t.match(/\b(weather|rain|temperature|forecast)\b/i) && t.match(/\b(?:in|at|for)\s+([\p{L}\s.,'-]+?)(?:[?.!]|$)/iu)
  if (wx) return { kind: 'weather', place: wx[1].trim() }
  // the trip is in the sentence that says "to" ("I have a scooty… . Karmanghat to Kokapet")
  const sentences = t.split(/(?<=[.!?;])\s+/)
  const tripS = [...sentences].reverse().find((x) => /\b(to|reach|towards)\b|→|->/i.test(x)) ?? t
  const LEAD = /^(?:(?:please|pls|hey|hi|ok|so|now|i am in a hurry|i'm in a hurry|in a hurry)[,;:]?\s+)*(?:(?:can you\s+)?(?:take me|get me|show me(?: the)?(?: fastest| cheapest| best| quickest)?(?: option| route| way)?|plan(?: a)?(?: trip| route)?|route|i want to go|i need to go|i have to go|how (?:do|can) i (?:go|get|reach)|go)\s+)*/i
  const STOPW = String.raw`(?=\s+(?:at|by|on|tomorrow|today|tonight|now|but|and|with|in a hurry|asap|for)\b|[?.!,;]|$)`
  const body = tripS.replace(LEAD, '').trim()
  const m = body.match(new RegExp(String.raw`(?:^|\bfrom\s+)([\p{L}\d .,'-]+?)\s+(?:to|→|->)\s+([\p{L}\d .,'-]+?)` + STOPW, 'iu'))
  const toOnly = !m ? body.match(new RegExp(String.raw`(?:^|\b(?:to|reach)\s+)([\p{L}\d .,'-]+?)` + STOPW, 'iu')) : null
  if (!m && !(toOnly && /\b(to|reach|go|take me)\b/i.test(t))) return { kind: 'help' }
  const time = t.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  let hh: string | undefined
  if (time) { let h = +time[1]; if (time[3]?.toLowerCase() === 'pm' && h < 12) h += 12; if (time[3]?.toLowerCase() === 'am' && h === 12) h = 0; hh = `${String(h).padStart(2, '0')}:${time[2] ?? '00'}` }
  const date = /tomorrow/i.test(t) ? (() => { const d = new Date(Date.now() + 330 * 60000 + 864e5); return d.toISOString().slice(0, 10) })() : undefined
  const priority: Priority | undefined = /hurry|fast|quick|late|asap|urgent/i.test(t) ? 'fastest' : /cheap|save|budget|less money|low cost/i.test(t) ? 'cheapest' : /comfort|relax|ac\b|luggage|kids|elder|senior|no crowd/i.test(t) ? 'comfort' : undefined
  const hasScooter = /scoot(y|er)|activa|two.?wheeler/i.test(t), hasCar = /\bmy car\b|own car|have a car/i.test(t)
  const noDrive = /(don'?t|do not|dont|not)\s+(want|like)\s+to\s+(drive|ride)|no driving|avoid traffic|in traffic/i.test(t)
  const avoid = [noDrive && hasScooter ? 'scooter' : '', noDrive && hasCar ? 'my car' : '', /no bus|avoid bus|not by bus/i.test(t) ? 'bus' : '', /no bike|avoid bike/i.test(t) ? 'bike taxi' : ''].filter(Boolean)
  const only = /public transport only|only (metro|bus)|by metro|by bus/i.test(t) ? ['metro', 'bus', 'walk'] : undefined
  const people = Number(t.match(/\b(\d{1,2})\s+(people|persons|of us|friends|members)/i)?.[1]) || undefined
  return {
    kind: 'route',
    args: { from: m ? m[1].replace(/^from\s+/i, '').trim() : undefined, to: (m ? m[2] : toOnly![1]).trim(), time: hh, date, priority, avoid, only, people, own_vehicle: hasScooter && !noDrive ? 'scooter' : hasCar && !noDrive ? 'car' : 'none' },
  }
}

async function withRules(history: ChatMsg[], ctx: ChatContext, passages: Doc[]): Promise<AgentReply> {
  const last = history.filter((m) => m.role === 'user').pop()?.text ?? ''
  const intent = parseIntent(last)
  try {
    if (intent.kind === 'route') {
      const r = await planRouteTool(intent.args, ctx)
      const o = r.card.options
      if (!o.length) return { reply: `${r.card.note ?? 'No route found with those modes.'} Try adding auto or bike taxi.`, cards: [r.card], tools: ['plan_route'], engine: 'rules', sources: r.sources }
      const pick = o.find((x) => x.labels.includes(intent.args.priority === 'fastest' ? 'Fastest' : intent.args.priority === 'cheapest' ? 'Cheapest' : intent.args.priority === 'comfort' ? 'Most comfortable' : 'Recommended')) ?? o[0]
      const money = (x: typeof pick) => `₹${x.fare.toLocaleString('en-IN')}${x.perPerson ? '' : ' total'}`
      const lines = [
        `**${pick.labels.join(' · ')}: ${fmtDur(pick.minutes)}, ${money(pick)}** — ${pick.summary}`,
        ...o.filter((x) => x !== pick).slice(0, 3).map((x) => `${x.labels.join(' · ')}: ${fmtDur(x.minutes)}, ${money(x)} — ${x.summary}`),
        intent.args.avoid?.length ? `I left out: ${intent.args.avoid.join(', ')}.` : '',
        `Open in Tripzy → ${r.card.url}`,
      ].filter(Boolean)
      return { reply: lines.join('\n'), cards: [r.card], tools: ['plan_route'], engine: 'rules', sources: r.sources }
    }
    if (intent.kind === 'hotels') { const r = await hotelsTool({ place: intent.place }, ctx); return { reply: r.card.items.length ? `Here are places to stay near ${intent.place}.` : `I found no hotels near ${intent.place}.`, cards: [r.card], tools: ['find_hotels'], engine: 'rules', sources: r.sources } }
    if (intent.kind === 'weather') { const r = await weatherTool({ place: intent.place }, ctx); return { reply: `Forecast for ${intent.place}.`, cards: [r.card], tools: ['get_weather'], engine: 'rules', sources: r.sources } }
  } catch (e) {
    return { reply: (e as Error).message, cards: [], tools: [], engine: 'rules', sources: [] }
  }
  if (passages.length) return { reply: `${passages[0].text.split('\n').slice(0, 6).join('\n')}`, cards: [], tools: ['search_help'], engine: 'rules', sources: [`Tripzy help: ${passages[0].title}`] }
  return { reply: 'Tell me where you want to go, for example "Kokapet to Miyapur at 6 pm" or "I am in a hurry, take me to HITEC City".', cards: [], tools: [], engine: 'rules', sources: [] }
}

export async function chat(history: ChatMsg[], ctx: ChatContext): Promise<AgentReply> {
  const last = history.filter((m) => m.role === 'user').pop()?.text ?? ''
  const memory: Doc[] = (ctx.memory ?? []).slice(0, 40).map((m, i) => ({ id: `mem${i}`, title: m.title, text: m.text, source: 'your Tripzy data' }))
  const passages = retrieve(last, memory, 4)
  if (env('GEMINI_API_KEY')) {
    try {
      // answer within ~25 s: if the model is overloaded, the rule-based planner answers instead
      const r = await Promise.race([
        withGemini(history, ctx, passages),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('AI took longer than 25 s')), 25000)),
      ])
      if (r.reply || r.cards.length) return { ...r, sources: [...r.sources, ...passages.slice(0, 2).map((p) => `${p.source === 'your Tripzy data' ? 'Your data' : 'Tripzy help'}: ${p.title}`)] }
    } catch (e) { console.warn('Tripzy AI: Gemini failed, using rules —', (e as Error).message) }
  }
  return withRules(history, ctx, passages)
}
