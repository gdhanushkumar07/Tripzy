/**
 * Live scenario checks (real roads, real Hyderabad Metro + TGSRTC timetables). Prints every
 * labelled route and fails on answers a normal person would call wrong.
 *   npx tsx scripts/scenarios.ts            (needs network; npm run gtfs -- hmrl tgsrtc first)
 */
process.env.TZ = 'Asia/Kolkata'
try { process.loadEnvFile('.env') } catch { /* keyless */ }
import { planCommute, planGroupCommute, planMeetCommute, type Point } from '../server/plan/commute'
import { planJourney } from '../server/plan/journey'
import type { Mode } from '../src/lib/types'

const P = (name: string, lat: number, lon: number): Point => ({ name, lat, lon, city: 'Hyderabad', state: 'Telangana' })
const KARMANGHAT = P('Karmanghat', 17.34101, 78.53297), KOKAPET = P('Kokapet', 17.39486, 78.33652), MIYAPUR = P('Miyapur', 17.4968, 78.3614)
const HITEC = P('HITEC City', 17.4474, 78.3762), LBNAGAR = P('LB Nagar', 17.3457, 78.5522), AMEERPET = P('Ameerpet', 17.4375, 78.4482)
const SECUNDERABAD = P('Secunderabad', 17.4399, 78.4983), CHARMINAR = P('Charminar', 17.3616, 78.4747), UPPAL = P('Uppal', 17.4018, 78.5602)
const GACHIBOWLI = P('Gachibowli', 17.4401, 78.3489), WARANGAL = P('Warangal', 17.9689, 79.5941), RAIDURG = P('Raidurg', 17.4433, 78.3770)
const ALL: Mode[] = ['walk', 'auto', 'bike', 'cab', 'suv', 'metro', 'citybus', 'rail', 'ibus', 'train']
const PUBLIC: Mode[] = ['walk', 'metro', 'citybus', 'rail']
const METRO_MAX = 75 // Hyderabad Metro's highest single-journey fare (one ticket, any number of line changes)

let failures = 0
const fail = (name: string, why: string) => { failures++; console.log(`   ✗ ${name}: ${why}`) }
type R = Awaited<ReturnType<typeof planCommute>>['routes'][number]
const show = (r: R) => `${r.labels.join('+').padEnd(28)} ${String(Math.round(r.totalMin)).padStart(4)} min  ₹${String(r.fare).padStart(5)}  ${r.legs.map((l) => `${l.mode}(${l.fromName.replace(/ Metro$/, '')}→${l.toName.replace(/ Metro$/, '')}${l.km > 2 ? ` ${Math.round(l.km)}km` : ''})`).join(' › ')}`

function checkRoutes(name: string, routes: R[], expect: { metroIfLong?: boolean; maxPrivateKmAfterMetro?: number; partialOk?: boolean } = {}) {
  if (!routes.length) return fail(name, 'no route')
  const by = (l: string) => routes.find((r) => r.labels.includes(l as never))
  const cheapest = by('Cheapest'), fastest = by('Fastest'), rec = by('Recommended'), comfy = by('Most comfortable')
  if (!expect.partialOk && (!cheapest || !fastest || !rec || !comfy)) fail(name, 'a label is missing')
  for (const r of routes) {
    const cheapScore = (x: R) => x.fare + 0.5 * x.totalMin // the Cheapest objective: money, with time at ₹30/h
    if (cheapest && cheapScore(cheapest) > cheapScore(r) + 1) fail(name, `Cheapest (₹${cheapest.fare}, ${cheapest.totalMin} min) worse than ${r.labels} (₹${r.fare}, ${r.totalMin} min) on money + ₹30/h`)
    // Fastest counts 4 min of friction per change (finding the platform, waiting to board)
    const quick = (x: R) => x.totalMin + 4 * x.changes
    if (fastest && quick(fastest) > quick(r) + 1 && fastest.id !== r.id) fail(name, `Fastest (${fastest.totalMin} min, ${fastest.changes} changes) slower than ${r.labels} (${r.totalMin} min, ${r.changes} changes)`)
    // one metro ticket across line changes
    const metroFare = r.legs.filter((l) => l.mode === 'metro').reduce((s, l) => s + l.fare, 0)
    if (metroFare > METRO_MAX) fail(name, `metro charged ₹${metroFare} (> ₹${METRO_MAX}: two tickets for one trip?)`)
    // after riding the metro, a long private ride should only happen when it beats the alternatives
    const mi = r.legs.map((l) => l.mode).lastIndexOf('metro')
    const after = mi >= 0 ? r.legs.slice(mi + 1).filter((l) => ['bike', 'auto', 'cab'].includes(l.mode)).reduce((s, l) => s + l.km, 0) : 0
    if (expect.maxPrivateKmAfterMetro && after > expect.maxPrivateKmAfterMetro) fail(name, `${Math.round(after)} km by road after getting off the metro in ${r.labels}`)
    if (r.legs.some((l) => l.mode === 'walk' && l.km > 2.2)) fail(name, `walks ${r.legs.find((l) => l.mode === 'walk' && l.km > 2.2)!.km} km`)
  }
  if (expect.metroIfLong && !routes.some((r) => r.legs.some((l) => ['metro', 'citybus'].includes(l.mode)))) fail(name, 'no option uses the metro or a bus')
  if (rec && fastest && cheapest && rec.totalMin > fastest.totalMin * 2.2 && rec.fare > cheapest.fare * 1.5) fail(name, 'Recommended is both slow and dear')
}

async function solo(name: string, from: Point, to: Point, time: string, modes: Mode[], people = 1, expect: { metroIfLong?: boolean; maxPrivateKmAfterMetro?: number; noneOk?: boolean; budget?: number; vehicles?: { scooter?: { kmpl: number } }; firstMode?: Mode } = {}) {
  console.log(`\n▶ ${name} (${time}, ${people} ${people === 1 ? 'person' : 'people'}, ${modes.join('/')})`)
  try {
    const t = Date.now()
    const r = await planCommute({ from, to, date: '2026-11-23', time, modes, people, budget: expect.budget ?? null, vehicles: expect.vehicles })
    r.routes.forEach((x) => console.log('   ' + show(x)))
    if (!r.routes.length) console.log(`   no route: ${r.message} · suggestions: ${r.suggestions.map((x) => x.text).join('; ') || 'none'}`)
    if (!r.routes.length && expect.noneOk) { if (!r.suggestions.length && !r.message) fail(name, 'no route and no explanation'); return }
    if (expect.budget != null) for (const x of r.routes) if (x.fare > expect.budget) fail(name, `₹${x.fare} is over the ₹${expect.budget} budget`)
    if (expect.firstMode && !r.routes.some((x) => x.legs[0]?.mode === expect.firstMode)) fail(name, `no route starts with ${expect.firstMode}`)
    const alt = r.routes.flatMap((x) => x.legs).find((l) => (l as { alts?: unknown[] }).alts)
    if (alt) console.log(`   alternatives at ${alt.fromName}: ${(alt as unknown as { alts: { mode: string; minutes: number; fare: number }[] }).alts.map((a) => `${a.mode} ${a.minutes}m ₹${a.fare}`).join(', ')}`)
    console.log(`   (${Date.now() - t} ms)`)
    checkRoutes(name, r.routes, { ...expect, partialOk: expect.budget != null })
  } catch (e) { fail(name, (e as Error).message) }
}

const main = async () => {
  // the reported case: should ride the metro LB Nagar → Ameerpet → Blue Line west, not get off at Gandhi Bhavan
  await solo('Karmanghat → Kokapet', KARMANGHAT, KOKAPET, '07:30', ALL, 1, { metroIfLong: true, maxPrivateKmAfterMetro: 16 })
  // the open TGSRTC feed has no reliable bus connection here (its own timings say 13 h): the planner must say so and suggest a mode
  await solo('Karmanghat → Kokapet, public transport only', KARMANGHAT, KOKAPET, '07:30', PUBLIC, 1, { noneOk: true })
  await solo('Karmanghat → Kokapet, budget ₹120', KARMANGHAT, KOKAPET, '07:30', ALL, 1, { budget: 120, noneOk: true })
  await solo('Karmanghat → Kokapet, own scooter + metro', KARMANGHAT, KOKAPET, '07:30', ['walk', 'ownscooter', 'metro', 'citybus', 'auto', 'bike'], 1, { vehicles: { scooter: { kmpl: 45 } }, firstMode: 'ownscooter' })
  // metro zigzags via Ameerpet (84 min) — a bike taxi (39 min, ₹20 more) is the honest answer here
  await solo('Miyapur → HITEC City, office peak', MIYAPUR, HITEC, '09:00', ALL)
  await solo('LB Nagar → Ameerpet (one metro line)', LBNAGAR, AMEERPET, '08:30', ALL, 1, { metroIfLong: true })
  await solo('Uppal → Raidurg (end to end Blue Line)', UPPAL, RAIDURG, '18:00', ALL, 1, { metroIfLong: true })
  await solo('Secunderabad → Charminar', SECUNDERABAD, CHARMINAR, '10:00', ALL)
  await solo('Kokapet → Miyapur, evening', KOKAPET, MIYAPUR, '18:30', ALL)
  await solo('Family of 4: Kokapet → Charminar', KOKAPET, CHARMINAR, '11:00', ALL, 4)
  await solo('Gachibowli → Warangal (intercity)', GACHIBOWLI, WARANGAL, '07:00', ALL)

  // the reported journey: no auto/bike chosen; the metro must be boarded at a station near Kokapet
  // (Raidurg / HITEC City / Jubilee Hills Checkpost / Durgam Cheruvu), never after a cab ride alongside the line
  console.log('\n▶ Kokapet → Warangal, walk/cab/bus/metro/train, light bags (journey)')
  try {
    const j = await planJourney({ from: KOKAPET, to: WARANGAL, date: '2026-11-23', time: '07:00', party: { adults: 1, children: 0, seniors: 0 }, luggage: 'light', priority: 'balanced', own: 'none', modes: ['walk', 'cab', 'citybus', 'metro', 'rail', 'ibus', 'train'] })
    for (const o of j.options) console.log(`   ${[...o.tags, ...(o.badges ?? [])].join('+').padEnd(36)} ${o.title.slice(0, 50).padEnd(50)} ${Math.round(o.minutes)} min ₹${o.cost}`)
    const NEAR = /Raidurg|HITEC City|Jubilee Hills Checkpost|Durgam Cheruvu/
    const metroOpts = j.options.filter((o) => o.legs.some((l) => l.mode === 'metro'))
    if (!metroOpts.length) fail('Kokapet → Warangal', 'no option uses the metro')
    for (const o of metroOpts) { const m = o.legs.find((l) => l.mode === 'metro')!; if (!NEAR.test(m.from)) fail('Kokapet → Warangal', `metro boarded at ${m.from}, not a station near Kokapet`) }
    if (j.options.some((o) => o.legs.some((l) => l.mode === 'bike' || l.mode === 'auto'))) fail('Kokapet → Warangal', 'used a mode that was not chosen')
  } catch (e) { fail('Kokapet → Warangal', (e as Error).message) }

  console.log('\n▶ Group, same start: Kokapet → Miyapur / HITEC City / Ameerpet at 18:00')
  try {
    const g = await planGroupCommute({ from: KOKAPET, to: MIYAPUR, date: '2026-11-23', time: '18:00', modes: ALL, members: [{ id: 'a', name: 'Asha', to: '', point: MIYAPUR }, { id: 'b', name: 'Ravi', to: '', point: HITEC }, { id: 'c', name: 'Meena', to: '', point: AMEERPET }] })
    console.log(`   split at ${g.splitName} · ₹${g.totalPerPerson} each · together: ${g.together ? `${g.together.mode} ₹${g.together.totalPerPerson} each${g.together.recommended ? ' (recommended)' : ''}` : 'n/a'}`)
    for (const m of g.members) console.log(`   ${m.name} → ${m.to}: ₹${m.perPerson}`)
    if (!(g.totalPerPerson > 0)) fail('group split', 'no cost')
  } catch (e) { fail('group split', (e as Error).message) }

  console.log('\n▶ Group, different starts: Karmanghat + Secunderabad + Miyapur → HITEC City at 09:00')
  try {
    const m = await planMeetCommute({ to: HITEC, date: '2026-11-23', time: '09:00', modes: ALL, members: [{ id: 'a', name: 'Asha', point: KARMANGHAT }, { id: 'b', name: 'Ravi', point: SECUNDERABAD }, { id: 'c', name: 'Meena', point: MIYAPUR }] })
    console.log(`   ${m.best.atName}: ₹${m.best.totalPerPerson} each — ${m.best.why}`)
    for (const x of m.best.members) console.log(`   ${x.name} from ${x.from}: leave ${Math.floor(x.leaveBy / 60)}:${String(Math.round(x.leaveBy % 60)).padStart(2, '0')}, ${x.route?.legs.map((l) => l.mode).join('›') ?? 'already there'}`)
    const alone = [m.best, ...m.alternatives].find((p) => p.at === 'D')
    if (alone && m.best.score > alone.score) fail('meet', 'meeting plan worse than going separately')
  } catch (e) { fail('meet', (e as Error).message) }

  console.log('\n▶ Family of 4 with own car: Hyderabad → Bengaluru (journey)')
  try {
    const j = await planJourney({ from: P('Kokapet', 17.39486, 78.33652), to: { name: 'Bengaluru', lat: 12.9716, lon: 77.5946 }, date: '2026-11-28', time: '07:00', party: { adults: 2, children: 2, seniors: 0 }, luggage: 'heavy', priority: 'balanced', own: 'car', vehicles: { car: { kmpl: 14, fuel: 'petrol', seats: 5 } } })
    for (const o of j.options) console.log(`   ${o.tags.join('+').padEnd(30)} ${o.title.padEnd(40)} ${Math.round(o.minutes / 60 * 10) / 10} h ₹${o.cost} comfort ${o.comfort}`)
    const kinds = new Set(j.options.map((o) => o.kind))
    for (const k of ['flight', 'car']) if (!kinds.has(k as never)) fail('family journey', `no ${k} option`)
    if (!kinds.has('train') && !kinds.has('bus')) fail('family journey', 'no train or bus option')
  } catch (e) { fail('family journey', (e as Error).message) }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll scenario checks passed')
  process.exit(failures ? 1 : 0)
}
void main()
