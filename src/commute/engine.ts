/**
 * Daily Traveller engine — pure, no UI.
 *
 * Door-to-door, multi-modal, time-dependent search. Edges whose mode the user
 * did not select are removed, then a label-setting Dijkstra runs over whole
 * paths (state = node + arrival time + current vehicle). Labels are kept on the
 * Pareto front of (time, fare, changes, km on the current private vehicle), so
 * budget and transfer limits never hide a valid route. Hubs are never chosen
 * greedily: MGBS only wins if the whole path through it wins.
 */
import type { Mode } from '../lib/types'

// ---------------------------------------------------------------- graph types

type PrivateMode = 'auto' | 'bike' | 'cab'
type PrivateSpec = { base: number; perKm: number; wait: number; speed: number; peakShare: number; maxKm: number; capacity: number }
export type GraphNode = { id: string; name: string; kind: string; lat: number; lon: number }
type Segment = { km: number; min: number; fare: number; peak?: number }
type Line = {
  id: string; mode: Mode; name: string; headway?: number; stops: string[]; segments: Segment[]
  departures?: { forward: string[]; reverse: string[] }
}
export type GraphData = {
  peakWindows: [string, string][]
  private: Record<PrivateMode, PrivateSpec>
  walk: { kmh: number; maxKm: number }
  nodes: GraphNode[]
  roads: { a: string; b: string; km: number; min: number; peak: number }[]
  transfers: { a: string; b: string; km: number; min: number }[]
  lines: Line[]
}

type Arc =
  | { kind: 'road'; from: string; to: string; km: number; min: number; peak: number }
  | { kind: 'transfer'; from: string; to: string; km: number; min: number }
  | {
      kind: 'line'; from: string; to: string; km: number; min: number; fare: number; peak: number
      mode: Mode; key: string; name: string; origin: string; headway?: number; departures?: number[]; offset: number
    }

export type Graph = { data: GraphData; nodes: Map<string, GraphNode>; out: Map<string, Arc[]>; peak: [number, number][] }

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const fmtTime = (min: number) => {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const fmtDur = (min: number) => {
  const m = Math.round(min)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`
}

export function buildGraph(data: GraphData): Graph {
  const out = new Map<string, Arc[]>()
  const add = (a: Arc) => out.set(a.from, [...(out.get(a.from) ?? []), a])
  for (const r of data.roads) {
    add({ kind: 'road', from: r.a, to: r.b, km: r.km, min: r.min, peak: r.peak })
    add({ kind: 'road', from: r.b, to: r.a, km: r.km, min: r.min, peak: r.peak })
  }
  for (const t of data.transfers) {
    add({ kind: 'transfer', from: t.a, to: t.b, km: t.km, min: t.min })
    add({ kind: 'transfer', from: t.b, to: t.a, km: t.km, min: t.min })
  }
  for (const line of data.lines) {
    for (const dir of ['forward', 'reverse'] as const) {
      const stops = dir === 'forward' ? line.stops : [...line.stops].reverse()
      const segs = dir === 'forward' ? line.segments : [...line.segments].reverse()
      let offset = 0
      stops.slice(0, -1).forEach((s, i) => {
        const seg = segs[i]
        add({
          kind: 'line', from: s, to: stops[i + 1], km: seg.km, min: seg.min, fare: seg.fare, peak: seg.peak ?? 1,
          mode: line.mode, key: `${line.id}:${dir}`, name: line.name, origin: stops[0], headway: line.headway,
          departures: line.departures?.[dir].map(toMin), offset,
        })
        offset += seg.min
      })
    }
  }
  return {
    data,
    nodes: new Map(data.nodes.map((n) => [n.id, n])),
    out,
    peak: data.peakWindows.map(([a, b]) => [toMin(a), toMin(b)]),
  }
}

const isPeak = (g: Graph, t: number) => g.peak.some(([a, b]) => t % 1440 >= a && t % 1440 < b)

// ---------------------------------------------------------------- search

export type Objective = 'cost' | 'time' | 'changes' | 'general'
export type Query = {
  from: string; to: string; depart: number; modes: Mode[]
  budget?: number | null; maxTransfers?: number | null
}

type Label = {
  node: string; t: number; fare: number; changes: number; boardings: number
  vehicle: string; rideKm: number; prev: Label | null; step: Step | null
}
type Step = { arc: Arc; mode: Mode; key: string; depart: number; wait: number; minutes: number; fare: number; peakDelay: number }

/** Value of time used only to rank group split points (₹ per person-minute). */
export const VALUE_OF_TIME = 5

const PRIVATE: PrivateMode[] = ['auto', 'bike', 'cab']

function priority(l: Label, obj: Objective, depart: number, size: number): number[] {
  if (obj === 'cost') return [l.fare, l.t, l.changes]
  if (obj === 'changes') return [l.changes, l.t, l.fare]
  if (obj === 'general') return [l.fare + VALUE_OF_TIME * size * (l.t - depart), l.t]
  return [l.t, l.fare, l.changes]
}
const less = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}
const dominates = (a: Label, b: Label) => a.t <= b.t && a.fare <= b.fare && a.changes <= b.changes && a.rideKm <= b.rideKm

/** Expand one label along one arc for every allowed way of travelling it. */
function expand(g: Graph, l: Label, arc: Arc, modes: Set<Mode>, size: number): Label[] {
  const next = (mode: Mode, key: string, wait: number, minutes: number, fare: number, rideKm: number, peakDelay: number, boarding: boolean): Label => {
    const depart = l.t + wait
    return {
      node: arc.to, t: depart + minutes, fare: l.fare + fare,
      boardings: l.boardings + (boarding ? 1 : 0),
      changes: boarding && l.boardings > 0 ? l.changes + 1 : l.changes,
      vehicle: key, rideKm, prev: l,
      step: { arc, mode, key, depart, wait, minutes, fare, peakDelay },
    }
  }
  if (arc.kind === 'transfer') return [next('walk', 'walk', 0, arc.min, 0, 0, 0, false)]
  const res: Label[] = []
  const mult = (peak: number) => (isPeak(g, l.t) ? peak : 1)
  if (arc.kind === 'road') {
    if (modes.has('walk') && arc.km <= g.data.walk.maxKm) {
      res.push(next('walk', 'walk', 0, (arc.km / g.data.walk.kmh) * 60, 0, 0, 0, false))
    }
    for (const m of PRIVATE) {
      if (!modes.has(m)) continue
      const p = g.data.private[m]
      const cont = l.vehicle === m
      const rideKm = (cont ? l.rideKm : 0) + arc.km
      if (rideKm > p.maxKm) continue
      const free = arc.min * p.speed
      const minutes = free * (1 + (mult(arc.peak) - 1) * p.peakShare)
      const vehicles = m === 'bike' ? size : Math.ceil(size / p.capacity)
      const fare = ((cont ? 0 : p.base) + p.perKm * arc.km) * vehicles
      res.push(next(m, m, cont ? 0 : p.wait, minutes, fare, rideKm, minutes - free, !cont))
    }
    return res
  }
  // public transport line
  if (!modes.has(arc.mode)) return res
  const cont = l.vehicle === arc.key
  let wait = 0
  if (!cont) {
    if (arc.departures) {
      const at = arc.departures.map((d) => d + arc.offset).find((d) => d >= l.t)
      if (at === undefined) return res // no more trains today
      wait = at - l.t
    } else wait = (arc.headway ?? 10) / 2
  }
  const minutes = arc.min * mult(arc.peak)
  res.push(next(arc.mode, arc.key, wait, minutes, arc.fare * size, 0, minutes - arc.min, !cont))
  return res
}

/** Best whole path for one objective. groupSize > 1 prices shared vehicles for the group. */
export function search(g: Graph, q: Query, obj: Objective, groupSize = 1): Route | null {
  const modes = new Set(q.modes)
  const start: Label = { node: q.from, t: q.depart, fare: 0, changes: 0, boardings: 0, vehicle: '', rideKm: 0, prev: null, step: null }
  const front = new Map<string, Label[]>()
  const open: Label[] = [start]
  const key = (l: Label) => `${l.node}|${l.vehicle}`
  while (open.length) {
    let bi = 0
    for (let i = 1; i < open.length; i++) {
      if (less(priority(open[i], obj, q.depart, groupSize), priority(open[bi], obj, q.depart, groupSize))) bi = i
    }
    const l = open.splice(bi, 1)[0]
    if (l.node === q.to) return toRoute(g, l, groupSize)
    for (const arc of g.out.get(l.node) ?? []) {
      for (const n of expand(g, l, arc, modes, groupSize)) {
        if (q.budget != null && n.fare / groupSize > q.budget) continue
        if (q.maxTransfers != null && n.changes > q.maxTransfers) continue
        if (n.t - q.depart > 24 * 60) continue
        const k = key(n)
        const labels = front.get(k) ?? []
        if (labels.some((o) => dominates(o, n))) continue
        front.set(k, [...labels.filter((o) => !dominates(n, o)), n])
        open.push(n)
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- routes

export type Leg = {
  mode: Mode; name: string; from: string; to: string; fromName: string; toName: string
  depart: number; arrive: number; wait: number; minutes: number; km: number; fare: number; peakDelay: number
  stops: string[]; note?: string
}
export type Route = {
  id: string; labels: RouteLabel[]; legs: Leg[]; from: string; to: string
  depart: number; arrive: number; totalMin: number; fare: number; km: number; changes: number
  why: string; segments: { a: string; b: string; peakDelay: number }[]
}
export type RouteLabel = 'Cheapest' | 'Fastest' | 'Fewest transfers'

function toRoute(g: Graph, end: Label, groupSize: number): Route {
  const steps: Step[] = []
  for (let l: Label | null = end; l?.step; l = l.prev) steps.unshift(l.step)
  const legs: Leg[] = []
  const name = (id: string) => g.nodes.get(id)?.name ?? id
  for (const s of steps) {
    const last = legs[legs.length - 1]
    const lastKey = (last as Leg & { key?: string })?.key
    if (last && lastKey === s.key && s.wait === 0) {
      last.to = s.arc.to
      last.toName = name(s.arc.to)
      last.arrive = s.depart + s.minutes
      last.minutes += s.minutes
      last.km += s.arc.km
      last.fare += s.fare
      last.peakDelay += s.peakDelay
      last.stops.push(s.arc.to)
      continue
    }
    const leg: Leg & { key: string } = {
      key: s.key, mode: s.mode,
      name: s.arc.kind === 'line' ? s.arc.name : s.arc.kind === 'transfer' ? 'Walk (change)' : labelOf(s.mode),
      from: s.arc.from, to: s.arc.to, fromName: name(s.arc.from), toName: name(s.arc.to),
      depart: s.depart, arrive: s.depart + s.minutes, wait: s.wait, minutes: s.minutes, km: s.arc.km,
      fare: s.fare, peakDelay: s.peakDelay, stops: [s.arc.from, s.arc.to],
    }
    if (s.arc.kind === 'line' && s.mode === 'ibus' && s.arc.from !== s.arc.origin) {
      leg.note = `Seat risk: bus starts at ${name(s.arc.origin)}, it may be full when it reaches ${name(s.arc.from)}`
    }
    legs.push(leg)
  }
  const clean = legs.map((x) => {
    const { key: _key, ...rest } = x as Leg & { key?: string }
    void _key
    return { ...rest, minutes: Math.round(rest.minutes), fare: Math.round(rest.fare / groupSize), km: round1(rest.km), peakDelay: Math.round(rest.peakDelay) }
  })
  const first = steps[0]
  const depart = first ? first.depart - first.wait : end.t
  return {
    id: clean.map((x) => `${x.mode}:${x.from}>${x.to}`).join('|') || 'here',
    labels: [], legs: clean, from: first?.arc.from ?? end.node, to: end.node,
    depart, arrive: end.t, totalMin: Math.round(end.t - depart), fare: Math.round(end.fare / groupSize),
    km: round1(steps.reduce((a, s) => a + s.arc.km, 0)), changes: end.changes, why: '',
    segments: steps.map((s) => ({ a: s.arc.from, b: s.arc.to, peakDelay: s.peakDelay })),
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10
const labelOf = (m: Mode) => ({ walk: 'Walk', auto: 'Auto', bike: 'Bike taxi', cab: 'Cab', citybus: 'City bus', metro: 'Metro', ibus: 'Intercity bus', train: 'Train' })[m]

// ---------------------------------------------------------------- plan

export type Suggestion = { mode: Mode; text: string }
/** What a hub-by-hub greedy planner would do: go to the nearest intercity hub first. */
export type Baseline = { hub: string; hubName: string; totalMin: number; fare: number; segments: Route['segments'] }
export type PlanResult = { routes: Route[]; message?: string; suggestions: Suggestion[]; baseline?: Baseline }

const OBJECTIVES: [Objective, RouteLabel][] = [['cost', 'Cheapest'], ['time', 'Fastest'], ['changes', 'Fewest transfers']]

const km = (a: GraphNode, b: GraphNode) => {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function greedyBaseline(g: Graph, q: Query): Baseline | undefined {
  const origin = g.nodes.get(q.from)
  if (!origin) return undefined
  const hubs = new Set<string>()
  for (const arcs of g.out.values()) for (const a of arcs) {
    if (a.kind === 'line' && (a.mode === 'ibus' || a.mode === 'train') && q.modes.includes(a.mode)) hubs.add(a.from)
  }
  hubs.delete(q.from)
  hubs.delete(q.to)
  const nearest = [...hubs].sort((a, b) => km(origin, g.nodes.get(a)!) - km(origin, g.nodes.get(b)!))[0]
  if (!nearest) return undefined
  const dest = g.nodes.get(q.to)!
  // The greedy plan reaches the hub by road (auto, bike, cab, city bus), as other apps suggest.
  const road = q.modes.filter((m) => ['walk', 'auto', 'bike', 'cab', 'citybus'].includes(m))
  const first = search(g, { ...q, to: nearest, modes: road }, 'time') ?? search(g, { ...q, to: nearest }, 'time')
  if (!first) return undefined
  let best: Baseline | undefined
  // Board the intercity service at that hub, ride it to the stop nearest the destination, then the last mile.
  for (const m of ['ibus', 'train'] as Mode[]) {
    if (!q.modes.includes(m)) continue
    const stops = [...g.nodes.values()].filter(
      (n) => n.id !== nearest && search(g, { ...q, from: nearest, to: n.id, depart: first.arrive, modes: [m] }, 'time')?.legs.some((l) => l.mode === m),
    )
    const stop = stops.sort((a, b) => km(a, dest) - km(b, dest))[0]
    if (!stop) continue
    const ride = search(g, { ...q, from: nearest, to: stop.id, depart: first.arrive, modes: [m] }, 'time')!
    const last = stop.id === q.to ? null : search(g, { ...q, from: stop.id, depart: ride.arrive }, 'time')
    if (stop.id !== q.to && !last) continue
    const end = last ?? ride
    const cand: Baseline = {
      hub: nearest, hubName: g.nodes.get(nearest)!.name, totalMin: Math.round(end.arrive - q.depart),
      fare: first.fare + ride.fare + (last?.fare ?? 0), segments: [...first.segments, ...ride.segments, ...(last?.segments ?? [])],
    }
    if (!best || cand.totalMin < best.totalMin) best = cand
  }
  return best
}

export function plan(g: Graph, q: Query): PlanResult {
  if (q.from === q.to) return { routes: [], message: 'Start and destination are the same place.', suggestions: [] }
  const byId = new Map<string, Route>()
  for (const [obj, label] of OBJECTIVES) {
    const r = search(g, q, obj)
    if (!r) continue
    const seen = byId.get(r.id)
    if (seen) seen.labels.push(label)
    else byId.set(r.id, { ...r, labels: [label] })
  }
  const routes = [...byId.values()]
  if (routes.length) {
    const fastest = routes.find((r) => r.labels.includes('Fastest'))
    const b = greedyBaseline(g, q)
    const baseline = b && fastest && !fastest.segments.some((s) => s.a === b.hub) && b.totalMin > fastest.totalMin ? b : undefined
    routes.forEach((r) => (r.why = explain(g, r, routes, baseline)))
    return { routes, suggestions: [], baseline }
  }
  return { routes: [], ...noRoute(g, q) }
}

/** Explain an empty result: which filter blocks it and which single mode would unblock it. */
function noRoute(g: Graph, q: Query): { message: string; suggestions: Suggestion[] } {
  const a = g.nodes.get(q.from)?.name ?? q.from
  const b = g.nodes.get(q.to)?.name ?? q.to
  const loose = { ...q, budget: null, maxTransfers: null }
  const unconstrained = search(g, loose, 'cost')
  if (unconstrained) {
    const parts: string[] = []
    if (q.budget != null && unconstrained.fare > q.budget) parts.push(`the cheapest route costs ₹${unconstrained.fare}, above your budget of ₹${q.budget}`)
    if (q.maxTransfers != null) parts.push(`max ${q.maxTransfers} transfer${q.maxTransfers === 1 ? '' : 's'}`)
    return { message: `No route fits your limits: ${parts.join(' and ') || 'budget and transfers'}. Try raising the budget or allowing more transfers.`, suggestions: [] }
  }
  const all: Mode[] = ['walk', 'auto', 'bike', 'cab', 'citybus', 'metro', 'ibus', 'train']
  const suggestions = all
    .filter((m) => !q.modes.includes(m))
    .filter((m) => search(g, { ...loose, modes: [...q.modes, m] }, 'time'))
    .map((m) => ({ mode: m, text: `Try with ${labelOf(m).toLowerCase()} added` }))
  const picked = q.modes.length ? q.modes.map((m) => labelOf(m).toLowerCase()).join(', ') : 'no modes'
  return {
    message: q.modes.length
      ? `No route from ${a} to ${b} using only ${picked}. Your mode filter blocks every path.`
      : `No transport modes are selected, so there is no way from ${a} to ${b}.`,
    suggestions,
  }
}

/** One "Why this route" line, comparing a route with the other options found. */
export function explain(g: Graph, r: Route, all: Route[], baseline?: Baseline): string {
  const name = (id: string) => g.nodes.get(id)?.name.replace(/ (Metro|Bus Station|Bus Stand)( \(interchange\))?$/, '') ?? id
  const others = all.filter((o) => o !== r)
  if (r.labels.includes('Fastest')) {
    const mine = new Set(r.segments.map((s) => `${s.a}>${s.b}`))
    let worst: { a: string; b: string; peakDelay: number } | null = null
    // Compare with the greedy nearest-hub plan first: that is the plan other apps give.
    const compare = baseline ? [{ segments: baseline.segments.filter((s) => s.a !== r.from) }] : others
    for (const o of compare) for (const s of o.segments) {
      if (!mine.has(`${s.a}>${s.b}`) && (!worst || s.peakDelay > worst.peakDelay)) worst = s
    }
    if (worst && worst.peakDelay >= 5) return `Skips ${Math.round(worst.peakDelay)} min of peak traffic between ${name(worst.a)} and ${name(worst.b)}`
    const slow = others.reduce((m, o) => Math.max(m, o.totalMin), 0)
    return slow > r.totalMin ? `Arrives ${fmtDur(slow - r.totalMin)} sooner than the other options` : 'Quickest door to door'
  }
  const fastest = all.find((o) => o.labels.includes('Fastest'))
  if (r.labels.includes('Cheapest')) {
    return fastest && fastest !== r && fastest.fare > r.fare ? `Saves ₹${fastest.fare - r.fare} compared with the fastest route` : `Lowest fare: ₹${r.fare}`
  }
  if (fastest && fastest !== r && fastest.changes > r.changes) {
    const d = fastest.changes - r.changes
    return `${r.changes === 0 ? 'No changes' : `Only ${r.changes} change${r.changes > 1 ? 's' : ''}`} — ${d} fewer than the fastest route`
  }
  return r.changes === 0 ? 'One vehicle all the way' : `Only ${r.changes} change${r.changes > 1 ? 's' : ''}`
}

// ---------------------------------------------------------------- group split

export type GroupMember = { id: string; name: string; to: string }
export type GroupPlan = {
  split: string; splitName: string; shared: Route | null; sharedPerPerson: number
  members: { id: string; name: string; to: string; route: Route | null; perPerson: number }[]
  totalPerPerson: number; message?: string
}

/**
 * Pick the split node S that minimises
 *   cost(origin → S, travelled together) + Σ cost(S → each member's destination).
 * Cost = fare + value of time. On shared legs auto and cab fares are split
 * across the group (one vehicle per 3 or 4 people); bus/metro/train are per head.
 */
export function planGroup(g: Graph, q: { from: string; depart: number; modes: Mode[]; members: GroupMember[] }): GroupPlan | null {
  const members = q.members.filter((m) => m.to)
  const n = members.length
  if (!n) return null
  let best: { cost: number; split: string; shared: Route | null; legs: (Route | null)[] } | null = null
  for (const node of g.data.nodes) {
    const S = node.id
    const shared = S === q.from ? null : search(g, { from: q.from, to: S, depart: q.depart, modes: q.modes }, 'general', n)
    if (S !== q.from && !shared) continue
    const tS = shared?.arrive ?? q.depart
    let cost = shared ? shared.fare * n + VALUE_OF_TIME * n * (shared.arrive - shared.depart) : 0
    const legs: (Route | null)[] = []
    let ok = true
    for (const m of members) {
      if (m.to === S) { legs.push(null); continue }
      const r = search(g, { from: S, to: m.to, depart: tS, modes: q.modes }, 'general', 1)
      if (!r) { ok = false; break }
      cost += r.fare + VALUE_OF_TIME * (r.arrive - r.depart)
      legs.push(r)
    }
    if (!ok) continue
    // prefer travelling together longer when costs tie
    if (!best || cost < best.cost - 1 || (Math.abs(cost - best.cost) <= 1 && (shared?.totalMin ?? 0) > (best.shared?.totalMin ?? 0))) {
      best = { cost, split: S, shared, legs }
    }
  }
  if (!best) return null
  const sharedPerPerson = best.shared?.fare ?? 0
  const out = members.map((m, i) => {
    const r = best!.legs[i]
    return { id: m.id, name: m.name, to: m.to, route: r, perPerson: sharedPerPerson + (r?.fare ?? 0) }
  })
  return {
    split: best.split, splitName: g.nodes.get(best.split)?.name ?? best.split,
    shared: best.shared, sharedPerPerson, members: out,
    totalPerPerson: Math.round(out.reduce((a, m) => a + m.perPerson, 0) / n),
  }
}
