/**
 * Live Daily Traveller planner. Builds a graph per query from real data and runs the
 * tested engine (src/commute/engine.ts) on it:
 *  - origin/destination anywhere in India (geocoded on the client)
 *  - intercity: major railway junctions and bus terminals of each city (OpenStreetMap)
 *  - metro / city-bus stations near the ends and near those terminals, from GTFS
 *    timetables, with that day's real departures and published or slab fares
 *  - one OSRM road matrix between every point (drive times), peak multiplier by hour
 *  - road vehicles priced from published tariffs (estimates) with booking links
 */
import { buildGraph, plan, planGroup, planMeet, type GraphData, type GroupMember, type Leg, type PlanResult, type GroupPlan, type Route } from '../../src/commute/engine'
import type { Mode, Vehicles } from '../../src/lib/types'
import { busLinks, ownPerKm, rideLinks, tariffs, trainLinks, type Link } from '../fares'
import { haversineKm, type LatLon } from '../lib'
import { busHubs, cityOf, railHubs, type Hub } from '../providers/hubs'
import { trainsBetweenNames } from '../providers/rail'
import { road, roadTable } from '../providers/route'
import { dayType, fareBetween, feedsNear, nearestStations } from '../transit/gtfs'

export type Point = LatLon & { name: string; state?: string; city?: string }
export type CommuteQuery = { from: Point; to: Point; date: string; time: string; modes: Mode[]; budget?: number | null; maxTransfers?: number | null; people?: number; vehicles?: Vehicles }

type Node = GraphData['nodes'][number]
type LineMeta = { source: string; estimate: boolean; links: Link[]; color?: string; stops?: [number, number][] }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0) }
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`
const BIG_METROS = /hyderabad|bengaluru|bangalore|mumbai|delhi|gurugram|noida|chennai|kolkata|pune|ahmedabad/i
const feedsAround = (pts: LatLon[]) => [...new Set(pts.flatMap((p) => feedsNear(p)))]

/** extraOrig: more starting points (O1, O2, …) — used to find a meeting point for people starting in different places. */
export async function buildLiveGraph(q: CommuteQuery, extraDest: Point[] = [], extraOrig: Point[] = []) {
  const day = dayType(new Date(`${q.date}T12:00:00`))
  const depart = toMin(q.time)
  const dests = [q.to, ...extraDest]
  const origins = [q.from, ...extraOrig]
  const allEnds = [...origins, ...dests]
  const intercity = Math.max(...origins.flatMap((o) => dests.map((d) => haversineKm(o, d)))) > 60
  const cityName = cityOf(q.from)?.name ?? q.from.city ?? q.from.name
  const T = tariffs(cityName)
  // evening/morning peak multiplier on free-flow road times: OSRM is optimistic for Indian metros
  // calibration: OSRM free-flow times are speed-limit times. City roads run ~1.3x slower all day,
  // and the peak multiplier (08–11, 17–21) brings big metros to ~2.2x at rush hour.
  const URBAN_BASE = 1.3
  const URBAN_PEAK = BIG_METROS.test(cityName) ? 1.7 : 1.35

  const nodes: Node[] = []
  const meta: Record<string, LineMeta> = {}
  const lines: GraphData['lines'] = []
  const transfers: GraphData['transfers'] = []
  const add = (n: Node) => { if (!nodes.some((x) => x.id === n.id)) nodes.push(n) }
  add({ id: 'O', name: q.from.name, kind: 'place', lat: q.from.lat, lon: q.from.lon })
  dests.forEach((d, i) => add({ id: i === 0 ? 'D' : `D${i}`, name: d.name, kind: 'place', lat: d.lat, lon: d.lon }))
  extraOrig.forEach((o, i) => add({ id: `O${i + 1}`, name: o.name, kind: 'place', lat: o.lat, lon: o.lon }))

  // ---------------- intercity terminals first, so city transit can feed them
  const hubsO: Hub[] = [], hubsD: Hub[] = []
  if (intercity) {
    const metroPts = feedsAround(allEnds).filter((f) => f.mode === 'metro').flatMap((f) => f.stations.map((st) => ({ lat: st[2], lon: st[3] })))
    const [railO, busO, ...dSide] = await Promise.all([
      railHubs(q.from, metroPts), busHubs(q.from, dests[0], 6),
      ...dests.flatMap((d) => [railHubs(d, metroPts, 2), busHubs(d, undefined, 2)]),
    ])
    const railD = dSide.filter((_, i) => i % 2 === 0).flat(), busD = dSide.filter((_, i) => i % 2 === 1).flat()
    hubsO.push(...railO, ...busO)
    hubsD.push(...railD, ...busD)
    for (const h of [...hubsO, ...hubsD]) {
      add({ id: `hub:${h.id}`, name: h.kind === 'rail' && !/station|junction|\bjn\b/i.test(h.name) ? `${h.name} railway station` : h.name, kind: h.kind, lat: h.lat, lon: h.lon })
    }
    // trains between major stations: real timetable with RAIL_API_KEY, else a labelled estimate
    const majorO = railO.some((h) => h.major) ? railO.filter((h) => h.major) : railO.slice(0, 1)
    const majorD = railD.some((h) => h.major) ? railD.filter((h) => h.major) : railD.slice(0, 1)
    for (const a of majorO) for (const b of majorD) {
      const km = haversineKm(a, b) * 1.2
      const live = await trainsBetweenNames(a.name, b.name).catch(() => [])
      if (live.length) {
        for (const t of live.slice(0, 6)) {
          const name = `${t.number} ${t.name}`
          lines.push({ id: `train-${t.number}-${a.id}`, mode: 'train', name, stops: [`hub:${a.id}`, `hub:${b.id}`], segments: [{ km: +km.toFixed(0), min: t.minutes, fare: Math.round(km * 0.45 + 30) }], departures: { forward: [t.depart], reverse: [] } })
          meta[name] = { source: 'Indian Railways timetable (indianrailapi.com)', estimate: true, links: trainLinks() }
        }
      } else {
        const name = `Train ${a.name} → ${b.name}`
        lines.push({ id: `train-est-${a.id}-${b.id}`, mode: 'train', name, headway: 180, stops: [`hub:${a.id}`, `hub:${b.id}`], segments: [{ km: +km.toFixed(0), min: Math.round((km / (km > 500 ? 60 : 50)) * 60), fare: Math.round(km * 0.45 + 30) }] })
        meta[name] = { source: 'Estimate from distance — add RAIL_API_KEY for real train timings', estimate: true, links: trainLinks() }
      }
    }
  }

  // ---------------- city transit from GTFS timetables
  // journeys to wire: origin → (destinations + origin-side terminals), destination-side terminals → destinations
  const wire: [LatLon[], LatLon[]][] = [[origins, [...dests, ...hubsO]]]
  if (hubsD.length) wire.push([hubsD, dests])
  for (const feed of feedsAround([...allEnds, ...hubsO, ...hubsD])) {
    // metro: people take an auto/bike/cab to a station up to ~10 km away; buses: walkable stops
    const nearOf = (p: LatLon) => (feed.mode === 'metro' ? nearestStations(feed, p, 10, 3) : nearestStations(feed, p, 1.2, 4)).map((s) => s.i)
    const chosen = new Set<number>()
    const key = new Set<number>()
    for (const [starts, ends] of wire) {
      const startSet = new Set(starts.flatMap(nearOf)), endSet = new Set(ends.flatMap(nearOf))
      if (!startSet.size || !endSet.size) continue
      startSet.forEach((x) => key.add(x)); endSet.forEach((x) => key.add(x))
      const pats = new Set<number>()
      for (const st of [...startSet, ...endSet]) for (const pi of feed.byStation!.get(st) ?? []) pats.add(pi)
      for (const pi of pats) {
        const pt = feed.patterns[pi]
        const i0 = pt.stops.findIndex((x) => startSet.has(x))
        if (i0 >= 0 && pt.stops.slice(i0 + 1).some((x) => endSet.has(x))) chosen.add(pi)
      }
      // one transfer: a start-area pattern meets an end-area pattern at a shared station
      const touches = (pi: number, set: Set<number>) => feed.patterns[pi].stops.some((x) => set.has(x))
      const fromP = [...pats].filter((pi) => touches(pi, startSet)).slice(0, 14)
      const toP = [...pats].filter((pi) => touches(pi, endSet)).slice(0, 14)
      let pairs = 0
      for (const a of fromP) for (const b of toP) {
        if (a === b || pairs >= (feed.mode === 'metro' ? 40 : 12)) continue
        const shared = feed.patterns[a].stops.find((x) => feed.patterns[b].stops.includes(x))
        if (shared !== undefined) { chosen.add(a); chosen.add(b); key.add(shared); pairs++ }
      }
    }
    const capped = [...chosen].slice(0, feed.mode === 'metro' ? 16 : 20)
    // metro: every interchange between chosen lines (few); buses: only the transfer stops found above
    if (feed.mode === 'metro') for (const a of capped) for (const b of capped) if (a < b) for (const x of feed.patterns[a].stops) if (feed.patterns[b].stops.includes(x)) key.add(x)
    const nodeId = (x: number) => `${feed.id}:${feed.stations[x][0]}`
    const used = new Set<number>()
    for (const pi of capped) {
      const pt = feed.patterns[pi]
      const idx = pt.stops.map((x, i) => [x, i] as const).filter(([x]) => key.has(x))
      if (idx.length < 2) continue
      const deps = (pt.deps[day] ?? pt.deps.wk ?? []).map((sec) => sec / 60 + pt.times[idx[0][1]] / 60).filter((m) => m >= depart - 30 && m <= depart + 8 * 60)
      if (!deps.length) continue
      idx.forEach(([x]) => used.add(x))
      const mode: Mode = feed.mode === 'metro' ? 'metro' : feed.mode === 'rail' ? 'rail' : 'citybus'
      const segments = idx.slice(1).map(([x, i], k) => {
        const [px, pi2] = idx[k]
        const km = haversineKm({ lat: feed.stations[px][2], lon: feed.stations[px][3] }, { lat: feed.stations[x][2], lon: feed.stations[x][3] }) * 1.25
        const cumPrev = k === 0 ? 0 : fareBetween(feed, idx[0][0], px)
        const cum = fareBetween(feed, idx[0][0], x)
        return { km: +km.toFixed(2), min: Math.max(1, (pt.times[i] - pt.times[pi2]) / 60), fare: Math.max(0, cum - cumPrev), peak: mode === 'citybus' ? 1.3 : 1 }
      })
      // official boarding → alighting fares (metro zone table) when the feed publishes them
      const fareAt = feed.fares ? idx.map(([a]) => idx.map(([b]) => (a === b ? 0 : fareBetween(feed, a, b)))) : undefined
      lines.push({ id: `${feed.id}-${pi}`, mode, name: pt.name, stops: idx.map(([x]) => nodeId(x)), segments, departures: { forward: deps.map((m) => fmt(m)), reverse: [] }, fareAt })
      meta[pt.name] = {
        source: `${feed.attribution} · timetable ${feed.builtAt.slice(0, 10)}`, estimate: feed.mode !== 'metro' || !feed.fares, links: [], color: pt.color,
        stops: pt.stops.slice(idx[0][1], idx[idx.length - 1][1] + 1).map((x) => [feed.stations[x][2], feed.stations[x][3]]),
      }
    }
    for (const x of used) add({ id: nodeId(x), name: feed.stations[x][1] + (feed.mode === 'metro' ? ' Metro' : ' bus stop'), kind: feed.mode === 'metro' ? 'metro' : 'bus', lat: feed.stations[x][2], lon: feed.stations[x][3] })
  }

  // ---------------- roads: one matrix between all points
  if (process.env.DEBUG_PLAN) console.log('nodes', nodes.length, nodes.map((n) => n.kind).join(','))
  const tbl = await roadTable(nodes)
  const roads: GraphData['roads'] = []
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const km = tbl.km[i][j], min = tbl.min[i][j]
    if (km == null || min == null || km < 0.05) continue
    const stops = (n: Node) => n.kind === 'metro' || (n.kind === 'bus' && !n.id.startsWith('hub:'))
    if (stops(nodes[i]) && stops(nodes[j]) && km > 0.6) continue // between two stops you ride the line (walk only at interchanges)
    if (!intercity && km > 60) continue
    const urban = km < 40
    roads.push({ a: nodes[i].id, b: nodes[j].id, km: +km.toFixed(2), min: +(min * (urban ? URBAN_BASE : 1.05)).toFixed(1), peak: urban ? URBAN_PEAK : 1.15 })
    if (km <= 0.6 && nodes[i].kind !== 'place' && nodes[j].kind !== 'place') transfers.push({ a: nodes[i].id, b: nodes[j].id, km, min: Math.max(3, (km / 4.5) * 60) })
  }
  // intercity buses (state RTC / private), labelled estimate. Each service runs as a chain:
  // origin terminal → city-exit stand (city traffic) → destination terminal, so boarding at the
  // exit stand (e.g. Uppal) is a real option with a seat-risk note, as on the road.
  const busO = hubsO.filter((h) => h.kind === 'bus'), busD = hubsD.filter((h) => h.kind === 'bus')
  const idx = (h: Hub) => nodes.findIndex((n) => n.id === `hub:${h.id}`)
  const exit = busO.length ? busO.reduce((a, b) => (haversineKm(a, dests[0]) < haversineKm(b, dests[0]) ? a : b)) : undefined
  for (const a of busO) for (const b of busD) {
    const ia = idx(a), ib = idx(b)
    const viaExit = exit && exit !== a && haversineKm(exit, dests[0]) < haversineKm(a, dests[0]) - 5
    const ix = viaExit ? idx(exit!) : -1
    const seg = (i: number, j: number, peak: number) => {
      const km = tbl.km[i]?.[j], min = tbl.min[i]?.[j]
      // buses run ~15 % slower than cars; city stretches also carry the base congestion
      return km && min ? { km: +km.toFixed(1), min: Math.round(min * 1.15 * (peak === URBAN_PEAK ? URBAN_BASE : 1)), fare: Math.round(km * 1.3), peak } : null
    }
    const name = `Intercity bus ${a.name} → ${b.name}`
    const segs = viaExit ? [seg(ia, ix, URBAN_PEAK), seg(ix, ib, 1.15)] : [seg(ia, ib, 1.25)]
    if (segs.some((x) => !x)) continue
    const stops = viaExit ? [`hub:${a.id}`, `hub:${exit!.id}`, `hub:${b.id}`] : [`hub:${a.id}`, `hub:${b.id}`]
    lines.push({ id: `ibus-${a.id}-${b.id}`, mode: 'ibus', name, headway: 30, stops, segments: segs as NonNullable<(typeof segs)[number]>[] })
    meta[name] = { source: 'Estimate from road distance and state bus fares — check the operator for times', estimate: true, links: busLinks({ ...a, state: a.state ?? q.from.state, name: a.city ?? q.from.name }, { ...b, name: b.city ?? q.to.name }) }
  }

  const priv: GraphData['private'] = {}
  for (const m of ['auto', 'shareauto', 'erick', 'bike', 'cab', 'suv', 'cycle'] as const) {
    const t = T[m]
    priv[m] = { base: t.base, baseKm: t.baseKm, perKm: t.perKm, perMin: t.perMin, wait: t.wait, speed: t.speed, peakShare: t.peakShare, maxKm: t.maxKm, capacity: t.seats }
  }
  // your own scooter/car: fuel cost only, it can only be the first ride (park-and-ride), parking at the station
  const v = { ...q.vehicles }
  if (q.modes.includes('ownscooter') && !v.scooter) v.scooter = { kmpl: 45 }
  if (q.modes.includes('owncar') && !v.car) v.car = { kmpl: 15, fuel: 'petrol', seats: 5 }
  if (v.scooter) priv.ownscooter = { base: 20, baseKm: 0, perKm: +ownPerKm(v.scooter.kmpl, 'petrol').toFixed(2), wait: 2, speed: 1.05, peakShare: 0.5, maxKm: 120, capacity: 2, own: true }
  if (v.car) priv.owncar = { base: 40, baseKm: 0, perKm: +ownPerKm(v.car.kmpl, v.car.fuel).toFixed(2), wait: 3, speed: 1, peakShare: 1, maxKm: 900, capacity: Math.max(2, v.car.seats || 5), own: true }
  const data: GraphData = { peakWindows: [['08:00', '11:00'], ['17:00', '21:00']], private: priv, walk: { kmh: 4.5, maxKm: 2 }, nodes, roads, transfers, lines }
  return { graph: buildGraph(data), meta, depart, roadSource: tbl.source }
}

type LegOut = Leg & { source: string; estimate: boolean; links: Link[]; geometry?: [number, number][]; color?: string; from_ll: [number, number]; to_ll: [number, number] }
const ROAD_MODES = ['auto', 'shareauto', 'erick', 'bike', 'cab', 'suv', 'cycle', 'walk', 'ownscooter', 'owncar']

export async function enrich(r: Route, g: ReturnType<typeof buildGraph>, meta: Record<string, LineMeta>, q: CommuteQuery, shapes = true) {
  const ll = (id: string): [number, number] => { const n = g.nodes.get(id)!; return [n.lat, n.lon] }
  const legs: LegOut[] = await Promise.all(r.legs.map(async (l) => {
    const a = g.nodes.get(l.from)!, b = g.nodes.get(l.to)!
    const m = meta[l.name]
    let geometry: [number, number][] | undefined = m?.stops
    if (shapes && ROAD_MODES.includes(l.mode)) geometry = await road(a, b, l.mode === 'walk' ? 'walking' : l.mode === 'cycle' ? 'cycling' : 'driving').then((x) => x.geometry).catch(() => undefined)
    return {
      ...l, geometry, color: m?.color, from_ll: ll(l.from), to_ll: ll(l.to),
      source: m?.source ?? (l.mode === 'walk' ? 'Walking time (OSRM)' : l.mode.startsWith('own') ? 'Road time (OSRM/Ola Maps) · fuel from your saved mileage + parking' : 'Road time (OSRM/Ola Maps) · fare from published tariff'),
      estimate: m?.estimate ?? l.mode !== 'walk',
      links: [...(m?.links ?? []), ...rideLinks(l.mode, a, b)].filter((x, i, arr) => arr.findIndex((y) => y.label === x.label) === i),
    }
  }))
  const pts = [q.from, ...r.legs.map((l) => g.nodes.get(l.to)!)]
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${q.from.lat},${q.from.lon}&destination=${q.to.lat},${q.to.lon}&waypoints=${pts.slice(1, -1).slice(0, 8).map((p) => `${p.lat},${p.lon}`).join('|')}&travelmode=transit`
  return { ...r, legs, gmaps }
}

export async function planCommute(q: CommuteQuery): Promise<PlanResult & { live: true; sources: string[] }> {
  const { graph, meta, depart, roadSource } = await buildLiveGraph(q)
  const res = plan(graph, { from: 'O', to: 'D', depart, modes: q.modes, budget: q.budget, maxTransfers: q.maxTransfers, people: q.people })
  const routes = await Promise.all(res.routes.map((r) => enrich(r, graph, meta, q)))
  return { ...res, routes, live: true, sources: [roadSource, ...new Set(Object.values(meta).map((m) => m.source))] }
}

/** One live graph, several mode sets (e.g. train-only and bus-only intercity variants) — used by the journey planner. */
export async function planCommuteVariants(q: CommuteQuery, sets: Mode[][]) {
  const { graph, meta, depart, roadSource } = await buildLiveGraph(q)
  const out = await Promise.all(sets.map(async (modes) => {
    const res = plan(graph, { from: 'O', to: 'D', depart, modes, people: q.people })
    return Promise.all(res.routes.map((r) => enrich(r, graph, meta, q)))
  }))
  return { variants: out, sources: [roadSource, ...new Set(Object.values(meta).map((m) => m.source))] }
}

export async function planGroupCommute(q: CommuteQuery & { members: (GroupMember & { point: Point })[] }): Promise<GroupPlan & { sources: string[] }> {
  const pts = q.members.map((m) => m.point)
  const { graph, meta, depart, roadSource } = await buildLiveGraph({ ...q, to: pts[0] }, pts.slice(1))
  const members = q.members.map((m, i) => ({ id: m.id, name: m.name, to: i === 0 ? 'D' : `D${i}` }))
  const p = planGroup(graph, { from: 'O', depart, modes: q.modes, members })
  if (!p) throw Object.assign(new Error('No shared plan works with these modes. Add more modes and try again.'), { status: 404 })
  const name = (id: string) => graph.nodes.get(id)?.name ?? id
  const enr = (r: Route | null, to: Point) => (r ? enrich(r, graph, meta, { ...q, to }) : null)
  const splitNode = graph.nodes.get(p.split)!
  return {
    ...p, splitName: name(p.split),
    shared: p.shared ? await enrich(p.shared, graph, meta, { ...q, to: { lat: splitNode.lat, lon: splitNode.lon, name: name(p.split) } }) : null,
    members: await Promise.all(p.members.map(async (m, i) => ({ ...m, to: pts[i].name, route: await enr(m.route, pts[i]) }))),
    together: p.together ? {
      ...p.together,
      stops: await Promise.all(p.together.stops.map(async (s) => { const i = q.members.findIndex((m) => m.id === s.id); return { ...s, to: pts[i].name, route: (await enr(s.route, pts[i]))! } })),
    } : undefined,
    sources: [roadSource, ...new Set(Object.values(meta).map((m) => m.source))],
  }
}

/** Different starts, one destination: find where to meet and ride on together (live graph). */
export async function planMeetCommute(q: Omit<CommuteQuery, 'from'> & { members: { id: string; name: string; point: Point }[] }) {
  const pts = q.members.map((m) => m.point)
  const n = pts.length
  const centre: Point = { name: 'Group centre', lat: pts.reduce((s, p) => s + p.lat, 0) / n, lon: pts.reduce((s, p) => s + p.lon, 0) / n, state: pts[0].state, city: pts[0].city }
  const { graph, meta, depart, roadSource } = await buildLiveGraph({ ...q, from: centre, people: n }, [], pts)
  const res = planMeet(graph, { to: 'D', depart, modes: q.modes, members: q.members.map((m, i) => ({ id: m.id, name: m.name, from: `O${i + 1}` })) })
  if (!res) throw Object.assign(new Error('No way for everyone to reach the destination with these modes. Add more modes and try again.'), { status: 404 })
  const node = (id: string) => graph.nodes.get(id)!
  // road shapes only for the recommended plan: alternatives draw straight lines until chosen
  const out = async (p: NonNullable<typeof res>['best'], shapes: boolean) => {
    const at = node(p.at)
    const atPt: Point = { name: p.atName, lat: at.lat, lon: at.lon }
    return {
      ...p, atLL: [at.lat, at.lon] as [number, number],
      together: p.together ? await enrich(p.together, graph, meta, { ...q, from: atPt }, shapes) : null,
      members: await Promise.all(p.members.map(async (m, i) => ({ ...m, from: pts[i].name, route: m.route.legs.length ? await enrich(m.route, graph, meta, { ...q, from: pts[i], to: atPt }, shapes) : null }))),
    }
  }
  return { best: await out(res.best, true), alternatives: await Promise.all(res.alternatives.map((p) => out(p, false))), toName: q.to.name, sources: [roadSource, ...new Set(Object.values(meta).map((m) => m.source))] }
}
