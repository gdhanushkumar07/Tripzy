import { describe, expect, it } from 'vitest'
import data from '../data/hyderabad-graph.json'
import type { Mode } from '../lib/types'
import { buildGraph, plan, planGroup, planMeet, toMin, type GraphData, type Route } from './engine'

const g = buildGraph(data as unknown as GraphData)
const ALL: Mode[] = ['walk', 'auto', 'bike', 'cab', 'citybus', 'metro', 'ibus', 'train']
const places = (r: Route) => r.legs.flatMap((l) => l.stops)
const at6pm = { from: 'kokapet', to: 'wgl', depart: toMin('18:00') }

describe('Kokapet → Warangal at evening peak', () => {
  it('Fastest goes via Raidurg metro and Uppal, not MGBS', () => {
    const res = plan(g, { ...at6pm, modes: ALL })
    const fastest = res.routes.find((r) => r.labels.includes('Fastest'))!
    expect(fastest).toBeTruthy()
    expect(places(fastest)).toContain('raidurg')
    expect(places(fastest)).toContain('uppal')
    expect(fastest.legs.some((l) => l.mode === 'metro')).toBe(true)
    expect(places(fastest)).not.toContain('mgbs')
    expect(fastest.why).toMatch(/Skips \d+ min of peak traffic between MGBS and Uppal/)
  })

  it('flags seat risk when boarding the intercity bus at Uppal', () => {
    const fastest = plan(g, { ...at6pm, modes: ALL }).routes.find((r) => r.labels.includes('Fastest'))!
    expect(fastest.legs.find((l) => l.mode === 'ibus')?.note).toMatch(/Seat risk: bus starts at MGBS/)
  })

  it('with metro deselected the Fastest goes via MGBS', () => {
    const res = plan(g, { ...at6pm, modes: ALL.filter((m) => m !== 'metro') })
    const fastest = res.routes.find((r) => r.labels.includes('Fastest'))!
    expect(places(fastest)).toContain('mgbs')
  })

  it('returns up to four distinct routes: Recommended, Fastest, Cheapest, Most comfortable', () => {
    const res = plan(g, { ...at6pm, modes: ALL })
    expect(res.routes.length).toBeGreaterThan(0)
    expect(res.routes.length).toBeLessThanOrEqual(4)
    expect(new Set(res.routes.map((r) => r.id)).size).toBe(res.routes.length)
    const labels = res.routes.flatMap((r) => r.labels).sort()
    expect(labels).toEqual(['Cheapest', 'Fastest', 'Most comfortable', 'Recommended'])
    const cheapest = res.routes.find((r) => r.labels.includes('Cheapest'))!
    for (const r of res.routes) expect(cheapest.fare).toBeLessThanOrEqual(r.fare)
  })

  it('off-peak there is no peak multiplier on road legs', () => {
    const res = plan(g, { ...at6pm, depart: toMin('13:00'), modes: ['cab'] })
    expect(res.routes.length).toBe(0) // a city cab cannot reach Warangal
    const city = plan(g, { from: 'kokapet', to: 'mgbs', depart: toMin('13:00'), modes: ['cab'] })
    expect(city.routes[0].legs[0].peakDelay).toBe(0)
  })
})

describe('no route', () => {
  it('filtering all modes returns the no-route message with suggestions', () => {
    const res = plan(g, { ...at6pm, modes: [] })
    expect(res.routes).toEqual([])
    expect(res.message).toMatch(/No transport modes are selected/)
  })

  it('names the blocking filter and suggests a mode', () => {
    const res = plan(g, { from: 'cbit', to: 'dsnr', depart: toMin('16:30'), modes: ['metro'] })
    expect(res.routes).toEqual([])
    expect(res.message).toMatch(/using only metro/)
    expect(res.suggestions.map((s) => s.text)).toContain('Try with auto added')
  })

  it('explains when the budget rules everything out', () => {
    const res = plan(g, { ...at6pm, modes: ALL, budget: 50 })
    expect(res.routes).toEqual([])
    expect(res.message).toMatch(/budget/)
  })
})

describe('respects limits', () => {
  it('honours max transfers and budget', () => {
    const res = plan(g, { ...at6pm, modes: ALL, maxTransfers: 1, budget: 400 })
    for (const r of res.routes) {
      expect(r.changes).toBeLessThanOrEqual(1)
      expect(r.fare).toBeLessThanOrEqual(400)
    }
    expect(res.routes.length).toBeGreaterThan(0)
  })

  it('college → home commute works', () => {
    const res = plan(g, { from: 'cbit', to: 'dsnr', depart: toMin('16:30'), modes: ALL })
    expect(res.routes.length).toBeGreaterThan(0)
  })
})

describe('group split', () => {
  it('travels together, then splits at Uppal', () => {
    const p = planGroup(g, {
      from: 'kokapet', depart: toMin('18:00'), modes: ALL,
      members: [
        { id: 'a', name: 'Asha', to: 'wgl' },
        { id: 'b', name: 'Ravi', to: 'hnk' },
        { id: 'c', name: 'Meera', to: 'uppal' },
      ],
    })!
    expect(p).toBeTruthy()
    expect(p.split).toBe('uppal')
    expect(p.shared).toBeTruthy()
    expect(p.members.find((m) => m.id === 'c')!.route).toBeNull()
    expect(p.members.find((m) => m.id === 'b')!.route!.to).toBe('hnk')
  })

  it('splits shared auto/cab fares across the group', () => {
    const solo = plan(g, { from: 'kokapet', to: 'raidurg', depart: toMin('18:00'), modes: ['cab'] }).routes[0]
    const p = planGroup(g, {
      from: 'kokapet', depart: toMin('18:00'), modes: ['cab', 'metro'],
      members: [{ id: 'a', name: 'A', to: 'uppal_m' }, { id: 'b', name: 'B', to: 'uppal_m' }],
    })!
    expect(p.split).toBe('uppal_m')
    const cabLeg = p.shared!.legs.find((l) => l.mode === 'cab')!
    expect(cabLeg.fare).toBe(Math.round(solo.legs[0].fare / 2))
  })
})

describe('own vehicle (park-and-ride)', () => {
  const own = (spec: Partial<GraphData['private']>) => buildGraph({ ...(data as unknown as GraphData), private: { ...(data as unknown as GraphData).private, ...spec } })
  const scooter = { ownscooter: { base: 20, baseKm: 0, perKm: 2.3, wait: 2, speed: 1.05, peakShare: 0.5, maxKm: 120, capacity: 2, own: true } }

  it('is only ever the first ride: you cannot pick your scooter up mid-journey', () => {
    const g2 = own(scooter)
    const res = plan(g2, { ...at6pm, modes: ['walk', 'ownscooter', 'metro', 'citybus', 'ibus', 'train'] })
    expect(res.routes.length).toBeGreaterThan(0)
    for (const r of res.routes) {
      const idx = r.legs.map((l, i) => (l.mode === 'ownscooter' ? i : -1)).filter((i) => i >= 0)
      expect(idx.every((i) => i === 0)).toBe(true)
    }
  })

  it('scooter → metro → bus beats taking only public transport from the door', () => {
    const g2 = own(scooter)
    const withOwn = plan(g2, { ...at6pm, modes: ['walk', 'ownscooter', 'metro', 'citybus', 'ibus'] }).routes.find((r) => r.labels.includes('Fastest'))!
    const without = plan(g2, { ...at6pm, modes: ['walk', 'metro', 'citybus', 'ibus'] }).routes.find((r) => r.labels.includes('Fastest'))
    expect(withOwn.legs[0].mode).toBe('ownscooter')
    if (without) expect(withOwn.totalMin).toBeLessThanOrEqual(without.totalMin)
  })
})

describe('meeting point for people starting in different places', () => {
  const members = [{ id: 'a', name: 'Asha', from: 'kokapet' }, { id: 'b', name: 'Ravi', from: 'lbnagar' }, { id: 'c', name: 'Meena', from: 'dsnr' }]
  const res = planMeet(g, { to: 'wgl', depart: toMin('18:00'), modes: ALL, members })!

  it('finds a plan and never does worse than everyone going separately', () => {
    expect(res).toBeTruthy()
    const alone = [res.best, ...res.alternatives].find((p) => p.at === 'wgl')
    if (alone) expect(res.best.score).toBeLessThanOrEqual(alone.score)
    expect(res.best.members).toHaveLength(3)
  })

  it('everyone reaches the meeting point before the shared leg leaves', () => {
    const b = res.best
    if (b.together) {
      for (const m of b.members) expect(m.route.arrive).toBeLessThanOrEqual(b.together.depart)
      expect(b.together.legs[b.together.legs.length - 1].to).toBe('wgl')
    }
  })

  it('early arrivers are told to leave later rather than wait', () => {
    for (const m of res.best.members) expect(m.leaveBy).toBeGreaterThanOrEqual(toMin('18:00'))
  })
})

describe('group variations a normal group would try', () => {
  const at = (id: string, name: string, to: string) => ({ id, name, to })

  it('everyone to the same place: one shared plan, nobody pays more than going alone', () => {
    const p = planGroup(g, { from: 'kokapet', depart: toMin('18:00'), modes: ALL, members: [at('a', 'Asha', 'wgl'), at('b', 'Ravi', 'wgl'), at('c', 'Meena', 'wgl')] })!
    expect(p).toBeTruthy()
    // the group plan values time like Recommended: compare money + time with each person's solo Recommended
    const solo = plan(g, { from: 'kokapet', to: 'wgl', depart: toMin('18:00'), modes: ALL }).routes.find((r) => r.labels.includes('Recommended'))!
    const groupArrive = Math.max(...p.members.map((m) => m.route?.arrive ?? p.shared?.arrive ?? 0))
    const score = (fare: number, arrive: number) => fare + 5 * (arrive - toMin('18:00'))
    expect(score(p.totalPerPerson, groupArrive)).toBeLessThanOrEqual(score(solo.fare, solo.arrive) + 30)
  })

  it('bigger groups never pay more per person for a shared cab ride', () => {
    const per = (n: number) => planGroup(g, { from: 'kokapet', depart: toMin('11:00'), modes: ['walk', 'cab'], members: Array.from({ length: n }, (_, i) => at(String(i), `P${i}`, 'ameerpet')) })!.totalPerPerson
    expect(per(2)).toBeLessThanOrEqual(per(1))
    expect(per(4)).toBeLessThanOrEqual(per(2))
  })

  it('meeting point: a member who starts at the meeting point gets no legs and waits for nobody', () => {
    const r = planMeet(g, { to: 'wgl', depart: toMin('18:00'), modes: ALL, members: [{ id: 'a', name: 'Asha', from: 'kokapet' }, { id: 'b', name: 'Ravi', from: 'uppal' }] })!
    expect(r).toBeTruthy()
    const atUppal = [r.best, ...r.alternatives].find((p) => p.at === 'uppal')
    if (atUppal) expect(atUppal.members.find((m) => m.id === 'b')!.route.legs).toHaveLength(0)
  })

  it('meeting point never returns a plan someone cannot reach', () => {
    const r = planMeet(g, { to: 'wgl', depart: toMin('07:00'), modes: ['walk', 'metro', 'ibus'], members: [{ id: 'a', name: 'Asha', from: 'lbnagar' }, { id: 'b', name: 'Ravi', from: 'dsnr' }] })
    if (r) for (const m of r.best.members) expect(m.route).toBeTruthy()
  })
})

describe('route sanity a normal person expects', () => {
  it('never chains two hired rides back to back (bike → walk → bike)', () => {
    for (const t of ['08:00', '12:00', '18:00', '22:00']) for (const r of plan(g, { ...at6pm, depart: toMin(t), modes: ALL }).routes) {
      const rides = r.legs.filter((l) => l.mode !== 'walk')
      for (let i = 1; i < rides.length; i++) {
        const road = ['auto', 'bike', 'cab']
        expect(road.includes(rides[i - 1].mode) && road.includes(rides[i].mode)).toBe(false)
      }
    }
  })

  it('Most comfortable is never less comfortable than Cheapest (fewer bus/bike minutes or changes)', () => {
    const res = plan(g, { ...at6pm, modes: ALL })
    const comfy = res.routes.find((r) => r.labels.includes('Most comfortable'))!, cheap = res.routes.find((r) => r.labels.includes('Cheapest'))!
    const hard = (r: typeof comfy) => r.legs.filter((l) => ['citybus', 'bike', 'walk'].includes(l.mode)).reduce((s, l) => s + l.minutes, 0) + 15 * r.changes
    expect(hard(comfy)).toBeLessThanOrEqual(hard(cheap))
  })

  it('a route never visits the same stop twice', () => {
    for (const r of plan(g, { ...at6pm, modes: ALL }).routes) {
      const stops = r.legs.flatMap((l, i) => (i === 0 ? [l.from, l.to] : [l.to]))
      expect(new Set(stops).size).toBe(stops.length)
    }
  })
})
