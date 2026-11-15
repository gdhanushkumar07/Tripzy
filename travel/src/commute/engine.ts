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
import { MODES, MODE_LABEL, type Mode } from '../lib/types'

// ---------------------------------------------------------------- graph types

type PrivateSpec = { base: number; perKm: number; perMin?: number; baseKm?: number; wait: number; speed: number; peakShare: number; maxKm: number; capacity: number
  /** your own vehicle: it starts at the origin, so it can only be the first ride (then it is parked) */
  own?: boolean }
export type GraphNode = { id: string; name: string; kind: string; lat: number; lon: number }
type Segment = { km: number; min: number; fare: number; peak?: number }
type Line = {
  id: string; mode: Mode; name: string; headway?: number; stops: string[]; segments: Segment[]
  departures?: { forward: string[]; reverse: string[] }
  /** Optional official fare between stops i and j of `stops` (metro zone fares). Overrides segment fares. */
  fareAt?: number[][]
  /** Fare system the line belongs to (e.g. one metro network): changing lines inside it keeps one ticket. */
  system?: string
}
export type GraphData = {
  peakWindows: [string, string][]
  /** Road vehicles that can be hired door to door (auto, bike taxi, cab, SUV, shared auto, …). */
  private: Partial<Record<Mode, PrivateSpec>>
  walk: { kmh: number; maxKm: number }
  nodes: GraphNode[]
  roads: { a: string; b: string; km: number; min: number; peak: number }[]
  transfers: { a: string; b: string; km: number; min: number }[]
  lines: Line[]
  /** One-ticket fare tables per fare system: fare between any two of `nodes` (metro: by total distance, not per line). */
  fareSystems?: Record<string, { nodes: string[]; fares: number[][] }>
}

type Arc =
  | { kind: 'road'; from: string; to: string; km: number; min: number; peak: number }
  | { kind: 'transfer'; from: string; to: string; km: number; min: number }
  | {
      kind: 'line'; from: string; to: string; km: number; min: number; fare: number; peak: number
      mode: Mode; key: string; name: string; origin: string; headway?: number; departures?: number[]; offset: number
      /** position of `from` along this direction, and the fare between two positions (boarding → alighting) */
      index: number; fareBetween?: (a: number, b: number) => number; system?: string
    }

export type Graph = { data: GraphData; nodes: Map<string, GraphNode>; out: Map<string, Arc[]>; peak: [number, number][]; sysFare: Map<string, (a: string, b: string) => number | undefined> }

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
  const add = (a: Arc) => { const l = out.get(a.from); if (l) l.push(a); else out.set(a.from, [a]) }
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
      const n = stops.length
      const fa = line.fareAt
      const fareBetween = fa ? (a: number, b: number) => (dir === 'forward' ? fa[a][b] : fa[n - 1 - a][n - 1 - b]) : undefined
      stops.slice(0, -1).forEach((s, i) => {
        const seg = segs[i]
        add({
          kind: 'line', from: s, to: stops[i + 1], km: seg.km, min: seg.min, fare: seg.fare, peak: seg.peak ?? 1,
          mode: line.mode, key: `${line.id}:${dir}`, name: line.name, origin: stops[0], headway: line.headway,
          // absolute, sorted departure times from this stop (looked up by binary search)
          departures: line.departures?.[dir].map((d) => toMin(d) + offset).sort((a, b) => a - b), offset: 0, index: i, fareBetween, system: line.system,
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
    sysFare: new Map(Object.entries(data.fareSystems ?? {}).map(([sys, t]) => {
      const at = new Map(t.nodes.map((id, i) => [id, i]))
      return [sys, (a: string, b: string) => { const i = at.get(a), j = at.get(b); return i === undefined || j === undefined ? undefined : t.fares[i][j] }]
    })),
  }
}

function firstAtOrAfter(sorted: number[], t: number): number | undefined {
  let lo = 0, hi = sorted.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < t) lo = m + 1; else hi = m }
  return sorted[lo]
}
const privModes = new WeakMap<Graph, Mode[]>()
const privOf = (g: Graph) => { let m = privModes.get(g); if (!m) { m = Object.keys(g.data.private) as Mode[]; privModes.set(g, m) } return m }

const isPeak = (g: Graph, t: number) => g.peak.some(([a, b]) => t % 1440 >= a && t % 1440 < b)

// ---------------------------------------------------------------- search

export type Objective = 'cost' | 'time' | 'changes' | 'general' | 'comfort' | 'clean'
export type Query = {
  from: string; to: string; depart: number; modes: Mode[]
  budget?: number | null; maxTransfers?: number | null
  /** Travellers going together; auto/cab fares are split per vehicle, results are per person. */
  people?: number
  /** longest single auto/bike/cab ride allowed (first/last mile only, for the public-transport option) */
  maxPrivateKm?: number
  /** minutes after departure beyond which the search stops (default 48 h) */
  horizon?: number
}

type Label = {
  node: string; t: number; fare: number; changes: number; boardings: number
  /** accumulated discomfort, ₹-equivalent per person (crowded bus, bike in traffic, walking with bags…) */
  dis: number
  /** the last ride (walks ignored) was a road vehicle: a new hire must follow public transport */
  lastPrivate?: boolean
  /** minutes spent in road vehicles (traffic, pollution): what "Least traffic & pollution" minimises */
  road: number
  vehicle: string; rideKm: number; prev: Label | null; step: Step | null
  /** stop position where the current line was boarded (fare is by boarding → alighting) */
  board?: number
  /** open ticket inside a fare system: where it started and what has been charged so far */
  tk?: { sys: string; from: string; paid: number }
}
type Step = { arc: Arc; mode: Mode; key: string; depart: number; wait: number; minutes: number; fare: number; peakDelay: number }

/** Value of time used only to rank group split points (₹ per person-minute). */
export const VALUE_OF_TIME = 5

/** Comfort cost of one change of vehicle, ₹ per person (carrying bags, waiting, finding the stop). */
export const CHANGE_PENALTY = 25
/** Minutes of friction per change when ranking the fastest route. */
export const TRANSFER_FRICTION = 4
/** ₹ per person-minute the Cheapest route still values (₹30 an hour). */
const CHEAP_VOT = 0.5
/**
 * Discomfort per minute on each mode (₹-equivalent per person). Door-to-door cars are the most
 * comfortable, the metro is calm and air-conditioned, city buses are crowded, two-wheelers and
 * walking are tiring. Used by "Most comfortable" and, lightly, by "Recommended".
 */
export const DISCOMFORT: Partial<Record<Mode, number>> = {
  cab: 0, suv: 0, owncar: 0.6, train: 0.5, metro: 0.8, ferry: 0.8, ibus: 1, rail: 1.2, auto: 1.5,
  erick: 2, citybus: 2.2, bike: 2.5, ownscooter: 2.5, cycle: 3.5, walk: 3,
}
/** Discomfort of each change of vehicle (₹-equivalent per person) for the comfort objective. */
const COMFORT_CHANGE = 40

function priority(l: Label, obj: Objective, depart: number, size: number): number[] {
  // least traffic & pollution: as few minutes on the road as possible (metro/train do the long part),
  // then money and time lightly so it stays a sensible trip
  if (obj === 'clean') return [size * (3 * l.road + 15 * l.changes + 0.5 * (l.t - depart)) + 0.5 * l.fare, l.t]
  // most comfortable: discomfort and changes first, time valued lightly, money barely
  if (obj === 'comfort') return [size * (l.dis + COMFORT_CHANGE * l.changes + 0.5 * (l.t - depart)) + 0.1 * l.fare, l.t]
  // recommended: money + time + changes, with a little comfort so a crowded hour on a bus counts
  // (+ ₹1 per minute in road traffic: in a metro city the calm metro beats a cab alongside it)
  if (obj === 'general') return [l.fare + VALUE_OF_TIME * size * (l.t - depart) + CHANGE_PENALTY * size * l.changes + 0.5 * size * l.dis + size * l.road, l.t]
  // cheapest, but not absurdly slow: each extra hour counts ₹30 per person (a 2-day wait is never "cheapest")
  if (obj === 'cost') return [l.fare + (CHEAP_VOT * size * (l.t - depart)), l.t, l.changes]
  if (obj === 'changes') return [l.changes, l.t, l.fare]
  // fastest: every change costs a few real minutes (walking between platforms, finding the vehicle)
  return [l.t + TRANSFER_FRICTION * l.changes, l.fare, l.changes]
}
const less = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/** Expand one label along one arc for every allowed way of travelling it. */
function expand(g: Graph, l: Label, arc: Arc, modes: Set<Mode>, size: number, maxPrivateKm = Infinity): Label[] {
  const next = (mode: Mode, key: string, wait: number, minutes: number, fare: number, rideKm: number, peakDelay: number, boarding: boolean): Label => {
    const depart = l.t + wait
    return {
      node: arc.to, t: depart + minutes, fare: l.fare + fare, dis: l.dis + minutes * (DISCOMFORT[mode] ?? 1),
      boardings: l.boardings + (boarding ? 1 : 0),
      changes: boarding && l.boardings > 0 ? l.changes + 1 : l.changes,
      vehicle: key, rideKm, prev: l,
      lastPrivate: mode === 'walk' ? l.lastPrivate : !!g.data.private[mode],
      road: l.road + (g.data.private[mode] || mode === 'citybus' || mode === 'ibus' ? minutes * (mode === 'citybus' || mode === 'ibus' ? 0.6 : 1) : 0),
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
    for (const m of privOf(g)) {
      if (!modes.has(m)) continue
      // you hail an auto/cab where you are; walking to a transit stop first only to hail one there is never useful
      if (l.vehicle === 'walk' && l.boardings === 0 && l.vehicle !== m) continue
      // bike → walk → bike (or auto → cab) is the same trip split to dodge a distance limit or a
      // base fare: nobody does that. A second road vehicle only after a bus, metro or train.
      if (l.vehicle !== m && l.lastPrivate) continue
      const p = g.data.private[m]!
      const cont = l.vehicle === m
      // the road graph links every point directly, so a hired ride goes straight where you get off;
      // "continuing" it through other points only multiplies equivalent paths (and search time)
      if (cont && !p.own) continue
      if (p.own && !cont && (l.boardings > 0 || l.vehicle === 'walk')) continue
      const rideKm = (cont ? l.rideKm : 0) + arc.km
      if (rideKm > p.maxKm || (!p.own && rideKm > maxPrivateKm)) continue
      const free = arc.min * p.speed
      const minutes = free * (1 + (mult(arc.peak) - 1) * p.peakShare)
      const vehicles = Math.ceil(size / p.capacity)
      const billKm = cont ? arc.km : Math.max(0, arc.km - (p.baseKm ?? 0))
      const fare = ((cont ? 0 : p.base) + p.perKm * billKm + (p.perMin ?? 0) * free) * vehicles
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
      const at = firstAtOrAfter(arc.departures, l.t)
      if (at === undefined) return res // no more trains today
      wait = at - l.t
    } else wait = (arc.headway ?? 10) / 2
  }
  const minutes = arc.min * mult(arc.peak)
  const board = cont ? l.board ?? arc.index : arc.index
  let fare = arc.fareBetween ? arc.fareBetween(board, arc.index + 1) - (cont ? arc.fareBetween(board, arc.index) : 0) : arc.fare
  // one ticket across a metro network: a change of line at an interchange continues the same ticket
  const sysFare = arc.system ? g.sysFare.get(arc.system) : undefined
  let tk: Label['tk']
  if (sysFare) {
    const inside = !!l.tk && l.tk.sys === arc.system && (cont || (l.step?.arc.kind === 'line' && l.step.arc.system === arc.system && l.step.arc.to === arc.from))
    const from = inside ? l.tk!.from : arc.from
    const paid = inside ? l.tk!.paid : 0
    const total = sysFare(from, arc.to)
    if (total !== undefined) { fare = Math.max(0, total - paid); tk = { sys: arc.system!, from, paid: Math.max(total, paid) } }
  }
  const out = next(arc.mode, arc.key, wait, minutes, fare * size, 0, minutes - arc.min, !cont)
  out.board = board
  out.tk = tk
  res.push(out)
  return res
}

/** Min-heap on lexicographic priority arrays (the open list of the label search). */
class Heap<T> {
  private a: { p: number[]; v: T }[] = []
  get size() { return this.a.length }
  push(p: number[], v: T) {
    const a = this.a
    a.push({ p, v })
    for (let i = a.length - 1; i > 0;) {
      const j = (i - 1) >> 1
      if (!less(a[i].p, a[j].p)) break
      ;[a[i], a[j]] = [a[j], a[i]]
      i = j
    }
  }
  pop(): T | undefined {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0].v
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < a.length && less(a[l].p, a[m].p)) m = l
        if (r < a.length && less(a[r].p, a[m].p)) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top
  }
}

/**
 * Best path for one objective from q.from to every node in `targets` (one search; the first label
 * popped at a node is optimal because every objective only grows along a path).
 */
export function searchMany(g: Graph, q: Omit<Query, 'to'>, obj: Objective, groupSize: number, targets: Set<string>, horizon = q.horizon ?? 48 * 60): Map<string, Route> {
  const modes = new Set(q.modes)
  const start: Label = { node: q.from, t: q.depart, fare: 0, dis: 0, road: 0, changes: 0, boardings: 0, vehicle: '', rideKm: 0, prev: null, step: null }
  const front = new Map<string, Label[]>()
  const dead = new WeakSet<Label>()
  const open = new Heap<Label>()
  open.push(priority(start, obj, q.depart, groupSize), start)
  const found = new Map<string, Route>()
  const key = (l: Label) => `${l.node}|${l.vehicle}`
  // Each objective is "time + one other quantity", so exact dominance needs only two criteria:
  // arriving no later and being no worse on the objective's non-time part (an earlier label can
  // always wait). Far smaller fronts than full (time, fare, changes) Pareto sets.
  const other: (l: Label) => number =
    obj === 'general' ? (l) => l.fare + CHANGE_PENALTY * groupSize * l.changes + 0.5 * groupSize * l.dis + groupSize * l.road
      : obj === 'comfort' ? (l) => groupSize * (l.dis + COMFORT_CHANGE * l.changes) + 0.1 * l.fare
        : obj === 'clean' ? (l) => groupSize * (3 * l.road + 15 * l.changes) + 0.5 * l.fare
        : obj === 'cost' ? (l) => l.fare
          : (l) => l.changes
  // ε-dominance: labels within a minute and ₹3 (per person) of each other count as equal, which keeps
  // fronts small on big intercity graphs; results move by at most that much
  const EPS_T = 1, EPS = obj === 'time' || obj === 'changes' ? 0 : 3 * groupSize
  // inside a one-ticket system the fare comes from where the ticket started, not where this line was boarded
  const sameFareState = (a: Label, b: Label) => (a.tk || b.tk ? a.tk?.from === b.tk?.from : a.board === b.board)
  const dom = (a: Label, b: Label) => a.t <= b.t + EPS_T && other(a) <= other(b) + EPS && a.rideKm <= b.rideKm && sameFareState(a, b)
  // a path never comes back to a stop it already passed (riding the metro back and forth is never better)
  const revisits = (n: Label) => { for (let p = n.prev; p; p = p.prev) if (p.node === n.node) return true; return false }
  while (open.size && found.size < targets.size) {
    const l = open.pop()!
    if (dead.has(l)) continue
    if (targets.has(l.node) && !found.has(l.node)) {
      found.set(l.node, toRoute(g, l, groupSize))
      if (found.size === targets.size) break
    }
    for (const arc of g.out.get(l.node) ?? []) {
      for (const n of expand(g, l, arc, modes, groupSize, q.maxPrivateKm)) {
        if (q.budget != null && n.fare / groupSize > q.budget) continue
        if (q.maxTransfers != null && n.changes > q.maxTransfers) continue
        if (n.t - q.depart > horizon) continue // long-distance trains and buses can run over a day
        if (revisits(n)) continue
        const k = key(n)
        const labels = front.get(k) ?? []
        if (labels.some((o) => dom(o, n))) continue
        const keep: Label[] = []
        for (const o of labels) { if (dom(n, o)) dead.add(o); else keep.push(o) }
        keep.push(n)
        front.set(k, keep)
        open.push(priority(n, obj, q.depart, groupSize), n)
      }
    }
  }
  return found
}

/** Best whole path for one objective. groupSize > 1 prices shared vehicles for the group. */
export function search(g: Graph, q: Query, obj: Objective, groupSize = 1): Route | null {
  return searchMany(g, q, obj, groupSize, new Set([q.to])).get(q.to) ?? null
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
export type RouteLabel = 'Recommended' | 'Fastest' | 'Cheapest' | 'Most comfortable' | 'Least traffic & pollution' | 'Via metro' | 'Public transport'

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
const labelOf = (m: Mode) => MODE_LABEL[m] ?? m

// ---------------------------------------------------------------- plan

export type Suggestion = { mode: Mode; text: string }
/** What a hub-by-hub greedy planner would do: go to the nearest intercity hub first. */
export type Baseline = { hub: string; hubName: string; totalMin: number; fare: number; segments: Route['segments'] }
export type PlanResult = { routes: Route[]; message?: string; suggestions: Suggestion[]; baseline?: Baseline }

const OBJECTIVES: [Objective, RouteLabel][] = [['general', 'Recommended'], ['time', 'Fastest'], ['cost', 'Cheapest'], ['comfort', 'Most comfortable']]

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
    const reach = searchMany(g, { ...q, from: nearest, depart: first.arrive, modes: [m] }, 'time', 1, new Set([...g.nodes.keys()].filter((id) => id !== nearest)))
    const stops = [...g.nodes.values()].filter((n) => reach.get(n.id)?.legs.some((l) => l.mode === m))
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
  // the fastest door-to-door time bounds the others: nobody takes a route 3x slower to save money
  const quickest = search(g, q, 'time', q.people ?? 1)
  const bounded: Query = quickest ? { ...q, horizon: Math.min(q.horizon ?? 48 * 60, Math.max(quickest.totalMin * 3, quickest.totalMin + 240)) } : q
  for (const [obj, label] of OBJECTIVES) {
    const r = obj === 'time' ? quickest : search(g, bounded, obj, q.people ?? 1)
    if (!r) continue
    const seen = byId.get(r.id)
    if (seen) seen.labels.push(label)
    else byId.set(r.id, { ...r, labels: [label] })
  }
  // nobody should have to guess the bus/metro way: if no labelled route uses public transport,
  // add the best one that does (hired vehicles only for the first or last few km)
  const LINE_MODES: Mode[] = ['metro', 'citybus', 'rail', 'train', 'ibus', 'ferry']
  const usesLine = (r: Route) => r.legs.some((l) => LINE_MODES.includes(l.mode))
  // the way a city traveller avoids traffic and pollution: nearest metro station, metro for the long part
  if (byId.size && q.modes.some((m) => m === 'metro' || m === 'rail' || m === 'train')) {
    const clean = search(g, bounded, 'clean', q.people ?? 1)
    if (clean && usesLine(clean)) {
      const seen = byId.get(clean.id)
      if (seen) seen.labels.push('Least traffic & pollution')
      else byId.set(clean.id, { ...clean, labels: ['Least traffic & pollution'] })
    }
  }
  // you chose the metro: show the best way that really uses it — hire a ride only as far as the
  // nearest stations (plus 2 km), then the metro takes over
  const usesMetro = (r: Route) => r.legs.some((l) => l.mode === 'metro')
  if (byId.size && q.modes.includes('metro') && ![...byId.values()].some(usesMetro)) {
    const toMetro = (g.out.get(q.from) ?? []).filter((a) => a.kind === 'road' && g.nodes.get(a.to)?.kind === 'metro').map((a) => a.km)
    if (toMetro.length) {
      const viaMetro = search(g, { ...bounded, maxPrivateKm: Math.max(4, Math.min(...toMetro) + 2) }, 'general', q.people ?? 1)
      if (viaMetro && usesMetro(viaMetro) && !byId.has(viaMetro.id)) byId.set(viaMetro.id, { ...viaMetro, labels: ['Via metro'] })
    }
  }
  if (byId.size && ![...byId.values()].some(usesLine) && q.modes.some((m) => LINE_MODES.includes(m))) {
    const pub = search(g, { ...bounded, maxPrivateKm: 8 }, 'general', q.people ?? 1)
    if (pub && usesLine(pub) && !byId.has(pub.id)) byId.set(pub.id, { ...pub, labels: ['Public transport'] })
  }
  const routes = [...byId.values()]
  if (routes.length) {
    const fastest = routes.find((r) => r.labels.includes('Fastest'))
    const b = greedyBaseline(g, q)
    const baseline = b && fastest && !fastest.segments.some((s) => s.a === b.hub) && b.totalMin > fastest.totalMin ? b : undefined
    routes.forEach((r) => {
      r.why = explain(g, r, routes, baseline)
      const shared = r.legs.find((l) => (l.mode === 'cab' || l.mode === 'suv' || l.mode === 'auto') && l.km > 3)
      if ((q.people ?? 1) >= 3 && shared) r.why += ` · ${MODE_LABEL[shared.mode]} split ${q.people} ways: ₹${shared.fare} each`
    })
    return { routes, suggestions: [], baseline }
  }
  return { routes: [], ...noRoute(g, q) }
}

/** Explain an empty result: which filter blocks it and which single mode would unblock it. */
function noRoute(g: Graph, q: Query): { message: string; suggestions: Suggestion[] } {
  const a = g.nodes.get(q.from)?.name ?? q.from
  const b = g.nodes.get(q.to)?.name ?? q.to
  const loose = { ...q, budget: null, maxTransfers: null }
  const unconstrained = search(g, loose, 'cost', q.people ?? 1)
  if (unconstrained) {
    const parts: string[] = []
    if (q.budget != null && unconstrained.fare > q.budget) parts.push(`the cheapest route costs ₹${unconstrained.fare}, above your budget of ₹${q.budget}`)
    if (q.maxTransfers != null) parts.push(`max ${q.maxTransfers} transfer${q.maxTransfers === 1 ? '' : 's'}`)
    return { message: `No route fits your limits: ${parts.join(' and ') || 'budget and transfers'}. Try raising the budget or allowing more transfers.`, suggestions: [] }
  }
  const all: Mode[] = [...MODES]
  const suggestions = all
    .filter((m) => !q.modes.includes(m))
    .filter((m) => search(g, { ...loose, modes: [...q.modes, m] }, 'time', q.people ?? 1))
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
  const by = (l: RouteLabel) => all.find((o) => o.labels.includes(l))
  const fastest = by('Fastest'), cheapest = by('Cheapest')
  const rail = r.legs.some((l) => l.mode === 'metro' || l.mode === 'rail' || l.mode === 'train')
  if (r.labels.includes('Fastest')) {
    // "skips traffic" is only true when this route rides a train or metro past a road jam the others sit in
    if (rail) {
      const mine = new Set(r.segments.map((s) => `${s.a}>${s.b}`))
      let worst: { a: string; b: string; peakDelay: number } | null = null
      const compare = baseline ? [{ segments: baseline.segments.filter((s) => s.a !== r.from) }] : others
      for (const o of compare) for (const s of o.segments) if (!mine.has(`${s.a}>${s.b}`) && (!worst || s.peakDelay > worst.peakDelay)) worst = s
      if (worst && worst.peakDelay >= 5) return `Skips ${Math.round(worst.peakDelay)} min of peak traffic between ${name(worst.a)} and ${name(worst.b)}`
    }
    const next = others.reduce((m, o) => Math.min(m, o.totalMin), Infinity)
    return Number.isFinite(next) && next > r.totalMin ? `Arrives ${fmtDur(next - r.totalMin)} sooner than the next option` : 'Quickest door to door'
  }
  if (r.labels.includes('Recommended')) {
    const parts: string[] = []
    if (fastest && fastest !== r && fastest.fare > r.fare) parts.push(`₹${fastest.fare - r.fare} cheaper than the fastest`)
    if (cheapest && cheapest !== r && cheapest.totalMin > r.totalMin) parts.push(`${fmtDur(cheapest.totalMin - r.totalMin)} quicker than the cheapest`)
    return parts.length ? `Best balance of money and time: ${parts.join(', ')}` : 'Best balance of money, time and comfort'
  }
  if (r.labels.includes('Cheapest')) {
    return fastest && fastest !== r && fastest.fare > r.fare ? `Saves ₹${fastest.fare - r.fare} compared with the fastest route` : `Lowest fare: ₹${r.fare}`
  }
  if (r.labels.includes('Most comfortable')) {
    const walk = r.legs.filter((l) => l.mode === 'walk').reduce((x, l) => x + l.km, 0)
    return r.changes === 0 ? `One vehicle door to door${walk < 0.3 ? ', no walking' : ''}` : `Only ${r.changes} change${r.changes > 1 ? 's' : ''}, mostly ${r.legs.some((l) => l.mode === 'metro') ? 'air-conditioned metro' : 'seated'}`
  }
  if (r.labels.includes('Least traffic & pollution')) {
    const road = Math.round(r.legs.filter((l) => !['walk', 'metro', 'rail', 'train', 'ferry'].includes(l.mode)).reduce((x, l) => x + l.minutes, 0))
    const main = r.legs.filter((l) => ['metro', 'rail', 'train'].includes(l.mode)).reduce((x, l) => x + l.minutes, 0)
    return `Only ${road} min on the road — the ${r.legs.some((l) => l.mode === 'metro') ? 'metro' : 'train'} does ${Math.round(main)} min of the trip, away from traffic and pollution`
  }
  if (r.labels.includes('Via metro')) {
    const first = r.legs.find((l) => l.mode === 'metro')!
    const rec = by('Recommended')
    const d = rec && rec !== r ? r.totalMin - rec.totalMin : 0
    return `Metro from ${name(first.from)}${rec && rec !== r ? ` · ${d > 0 ? `${fmtDur(d)} longer` : `${fmtDur(-d)} quicker`} and ${r.fare <= rec.fare ? `₹${rec.fare - r.fare} cheaper` : `₹${r.fare - rec.fare} dearer`} than Recommended` : ''} — less time in traffic`
  }
  if (r.labels.includes('Public transport')) return `Best way by bus or metro: ₹${r.fare}${fastest && fastest !== r ? `, ${fmtDur(r.totalMin - fastest.totalMin)} slower than the fastest` : ''}`
  return r.changes === 0 ? 'One vehicle all the way' : `Only ${r.changes} change${r.changes > 1 ? 's' : ''}`
}

// ---------------------------------------------------------------- group split

export type GroupMember = { id: string; name: string; to: string }
export type TogetherPlan = {
  mode: Mode; stops: { id: string; name: string; to: string; route: Route; perPerson: number; arrive: number }[]
  totalPerPerson: number; recommended: boolean; why: string
}
export type GroupPlan = {
  split: string; splitName: string; shared: Route | null; sharedPerPerson: number
  members: { id: string; name: string; to: string; route: Route | null; perPerson: number }[]
  totalPerPerson: number; message?: string
  /** Everyone in one cab (or SUV), dropped nearest-first — the comfortable option for groups. */
  together?: TogetherPlan
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
    let cost = shared ? shared.fare * n + VALUE_OF_TIME * n * (shared.arrive - shared.depart) + CHANGE_PENALTY * n * shared.changes : 0
    const legs: (Route | null)[] = []
    let ok = true
    for (const m of members) {
      if (m.to === S) { legs.push(null); continue }
      const r = search(g, { from: S, to: m.to, depart: tS, modes: q.modes }, 'general', 1)
      if (!r) { ok = false; break }
      // getting off the shared vehicle at S and onto another one is a change too
      const lastShared = shared?.legs.filter((l) => l.mode !== 'walk').at(-1)
      const firstOwn = r.legs.find((l) => l.mode !== 'walk')
      const splitChange = lastShared && firstOwn && (lastShared.mode !== firstOwn.mode || lastShared.name !== firstOwn.name) ? 1 : 0
      cost += r.fare + VALUE_OF_TIME * (r.arrive - r.depart) + CHANGE_PENALTY * (r.changes + splitChange)
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
  const plan: GroupPlan = {
    split: best.split, splitName: g.nodes.get(best.split)?.name ?? best.split,
    shared: best.shared, sharedPerPerson, members: out,
    totalPerPerson: Math.round(out.reduce((a, m) => a + m.perPerson, 0) / n),
  }
  const together = rideTogether(g, q, members)
  if (together) {
    const splitTime = out.reduce((a, m) => a + ((m.route?.arrive ?? best!.shared?.arrive ?? q.depart) - q.depart), 0)
    const togetherTime = together.stops.reduce((a, st) => a + (st.arrive - q.depart), 0)
    const changes = out.reduce((a, m) => a + (m.route?.changes ?? 0), 0) + (best.shared ? best.shared.changes * n : 0)
    const togetherCost = together.totalPerPerson * n + VALUE_OF_TIME * togetherTime
    together.recommended = togetherCost < best.cost
    const dMoney = plan.totalPerPerson - together.totalPerPerson
    const dMin = Math.round((splitTime - togetherTime) / n)
    together.why = [
      dMoney > 0 ? `₹${dMoney} cheaper per person` : dMoney < 0 ? `₹${-dMoney} more per person` : 'Same cost per person',
      dMin > 0 ? `${dMin} min faster on average` : dMin < 0 ? `${-dMin} min slower on average` : '',
      changes > 0 ? `no changes instead of ${changes}` : '',
    ].filter(Boolean).join(' · ')
    plan.together = together
  }
  return plan
}

/** One vehicle for the whole group, dropping members nearest-first; each segment's fare is shared by those still on board. */
function rideTogether(g: Graph, q: { from: string; depart: number; modes: Mode[] }, members: GroupMember[]): TogetherPlan | undefined {
  const n = members.length
  if (n < 2) return undefined
  const mode: Mode | undefined = n <= 4 && q.modes.includes('cab') ? 'cab' : n <= 6 && q.modes.includes('suv') ? 'suv' : n <= 6 && q.modes.includes('cab') ? 'cab' : undefined
  if (!mode || !g.data.private[mode]) return undefined
  const left = [...members]
  let at = q.from, t = q.depart
  const paid = new Map(members.map((m) => [m.id, 0]))
  const stops: TogetherPlan['stops'] = []
  while (left.length) {
    // nearest next drop by road time from the current point
    let pick: { m: GroupMember; r: Route } | null = null
    for (const m of left) {
      if (m.to === at) { pick = { m, r: { ...emptyRoute(at, t) } }; break }
      const r = search(g, { from: at, to: m.to, depart: t, modes: [mode, 'walk'] }, 'time', left.length)
      if (r && (!pick || r.arrive < pick.r.arrive)) pick = { m, r }
    }
    if (!pick) return undefined
    const segFareTotal = pick.r.fare * left.length // search returns per-head fare for the riders on board
    for (const m of left) paid.set(m.id, (paid.get(m.id) ?? 0) + segFareTotal / left.length)
    stops.push({ id: pick.m.id, name: pick.m.name, to: pick.m.to, route: pick.r, perPerson: 0, arrive: pick.r.arrive })
    at = pick.m.to
    t = pick.r.arrive
    left.splice(left.indexOf(pick.m), 1)
  }
  stops.forEach((st) => (st.perPerson = Math.round(paid.get(st.id) ?? 0)))
  return { mode, stops, totalPerPerson: Math.round([...paid.values()].reduce((a, b) => a + b, 0) / n), recommended: false, why: '' }
}

function emptyRoute(at: string, t: number): Route {
  return { id: 'here', labels: [], legs: [], from: at, to: at, depart: t, arrive: t, totalMin: 0, fare: 0, km: 0, changes: 0, why: '', segments: [] }
}

// ---------------------------------------------------------------- meeting point (different starts, one destination)

export type MeetMember = { id: string; name: string; from: string }
export type MeetPlan = {
  /** node where everyone meets; equal to the destination when travelling separately is best */
  at: string; atName: string; meetTime: number
  members: { id: string; name: string; route: Route; leaveBy: number; perPerson: number }[]
  together: Route | null
  totalPerPerson: number; arrive: number; score: number; why: string
}

/**
 * Pick the meeting point M for people who start in different places and travel on together:
 * minimise Σ fares to M + the group's fare from M (shared vehicles split) + value of time for
 * every person's door-to-door minutes + a comfort cost per change. Everyone meets 5 min before the
 * shared leg; early arrivers are told when to leave instead of waiting. "Meet at the destination"
 * (go separately) is always a candidate, so the result never does worse than going alone.
 */
export function planMeet(g: Graph, q: { to: string; depart: number; modes: Mode[]; members: MeetMember[]; candidates?: string[] }): { best: MeetPlan; alternatives: MeetPlan[] } | null {
  const n = q.members.length
  if (!n) return null
  const meetKinds = new Set(['metro', 'rail', 'bus', 'hub'])
  const target = g.nodes.get(q.to)
  const origins = q.members.map((m) => g.nodes.get(m.from)!).filter(Boolean)
  const dist = (a: GraphNode, b: GraphNode) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180))
  let cands = q.candidates ?? [...g.nodes.values()].filter((x) => meetKinds.has(x.kind) || x.id.startsWith('hub:')).map((x) => x.id)
  if (target && !q.candidates) {
    // keep the 40 points that add the least detour for the group: Σ origin→M + n × M→destination
    const cost = (id: string) => { const c = g.nodes.get(id)!; return origins.reduce((s, o) => s + dist(o, c), 0) + n * dist(c, target) }
    cands = cands.sort((a, b) => cost(a) - cost(b)).slice(0, 40)
  }
  const plans: MeetPlan[] = []
  const all = new Set([...cands, q.to])
  // a meeting point reached later than going straight to the destination is useless: bound each search by that
  const reach = q.members.map((m) => {
    const direct = search(g, { from: m.from, to: q.to, depart: q.depart, modes: q.modes }, 'time', 1)
    const r = searchMany(g, { from: m.from, depart: q.depart, modes: q.modes }, 'general', 1, all, direct ? direct.totalMin + 20 : 48 * 60)
    if (!r.has(q.to)) { const d = search(g, { from: m.from, to: q.to, depart: q.depart, modes: q.modes }, 'general', 1); if (d) r.set(q.to, d) }
    return r
  })
  // the shared leg is searched only for the 8 meeting points that are cheapest to reach for the group
  const reachCost = (at: string) => reach.reduce((s, r, i) => { const x = q.members[i].from === at ? emptyRoute(at, q.depart) : r.get(at); return x ? s + x.fare + VALUE_OF_TIME * x.totalMin : Infinity }, 0)
  // onward estimate: crow-fly km at ~40 km/h, valued for the whole group
  const estimate = (at: string) => reachCost(at) + (target ? n * VALUE_OF_TIME * dist(g.nodes.get(at)!, target) * 111 * 1.5 : 0)
  const shortlist = [...all].filter((at) => at !== q.to && Number.isFinite(reachCost(at)))
    .sort((a, b) => estimate(a) - estimate(b))
    .slice(0, 8)
  for (const at of [...shortlist, q.to]) {
    const routes = q.members.map((m, i) => (m.from === at ? emptyRoute(at, q.depart) : reach[i].get(at) ?? null))
    if (routes.some((r) => !r)) continue
    const rs = routes as Route[]
    const separate = at === q.to
    const meetTime = separate ? Math.max(...rs.map((r) => r.arrive)) : Math.max(...rs.map((r) => r.arrive)) + 5
    const together = separate ? null : search(g, { from: at, to: q.to, depart: meetTime, modes: q.modes, people: n }, 'general', n)
    if (!separate && !together) continue
    const arrive = together ? together.arrive : meetTime
    // door-to-door minutes per person, assuming early arrivers leave later instead of waiting
    const minutes = rs.reduce((s, r) => s + r.totalMin, 0) + (together ? n * (together.arrive - meetTime + 5) : 0)
    const fares = rs.reduce((s, r) => s + r.fare, 0) + (together ? together.fare * n : 0)
    const changes = rs.reduce((s, r) => s + r.changes, 0) + (together ? n * together.changes + n : 0)
    const score = fares + VALUE_OF_TIME * minutes + CHANGE_PENALTY * changes
    plans.push({
      at, atName: g.nodes.get(at)?.name ?? at, meetTime, together, arrive, score: Math.round(score),
      totalPerPerson: Math.round(fares / n),
      members: q.members.map((m, i) => ({ id: m.id, name: m.name, route: rs[i], perPerson: rs[i].fare + (together?.fare ?? 0), leaveBy: q.depart })),
      why: '',
    })
  }
  if (!plans.length) return null
  plans.sort((a, b) => a.score - b.score)
  // early arrivers: plan again from the latest time that still reaches the meeting point on time,
  // so the legs shown carry real clock times instead of "leave now and wait there"
  for (const p of plans.slice(0, 4)) {
    if (p.at === q.to) continue
    p.members.forEach((m, i) => {
      const slack = p.meetTime - 5 - m.route.arrive
      if (slack < 5 || !m.route.legs.length) return
      for (const back of [slack, slack * 0.66, slack * 0.33]) {
        const later = search(g, { from: q.members[i].from, to: p.at, depart: q.depart + Math.floor(back), modes: q.modes }, 'general', 1)
        if (later && later.arrive <= p.meetTime - 3) { m.route = later; m.leaveBy = later.depart; m.perPerson = later.fare + (p.together?.fare ?? 0); break }
      }
    })
    p.totalPerPerson = Math.round(p.members.reduce((t, m) => t + m.perPerson, 0) / n)
  }
  const alone = plans.find((p) => p.at === q.to)
  for (const p of plans) {
    // going "separately" can still put everyone on the same vehicle (same bus/train from the same stop)
    const lastRide = (r: Route) => [...r.legs].reverse().find((l) => l.mode !== 'walk')
    const shared = p.at === q.to ? p.members.map((m) => lastRide(m.route)).filter(Boolean) : []
    const sameRide = shared.length === n && n > 1 && shared.every((l) => l!.name === shared[0]!.name && l!.from === shared[0]!.from && l!.depart === shared[0]!.depart)
    p.why = p.at === q.to
      ? sameRide
        ? `You all end up on the same ${shared[0]!.name} from ${shared[0]!.fromName} at ${fmtTime(shared[0]!.depart)} — meet there; tickets are per person, so nothing is saved by meeting earlier.`
        : 'Everyone travels separately straight to the destination — no meeting point saves enough time or money.'
      : `Meet at ${p.atName} and ride together: ₹${p.totalPerPerson} each on average${alone ? `, ${alone.totalPerPerson - p.totalPerPerson >= 0 ? `₹${alone.totalPerPerson - p.totalPerPerson} cheaper` : `₹${p.totalPerPerson - alone.totalPerPerson} dearer`} and ${Math.round(alone.arrive - p.arrive) >= 0 ? `${Math.round(alone.arrive - p.arrive)} min earlier` : `${Math.round(p.arrive - alone.arrive)} min later`} than going separately` : ''}.`
  }
  // alternatives: distinct meeting places, best first
  return { best: plans[0], alternatives: plans.slice(1, 4) }
}
