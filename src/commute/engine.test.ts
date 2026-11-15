import { describe, expect, it } from 'vitest'
import data from '../data/hyderabad-graph.json'
import type { Mode } from '../lib/types'
import { buildGraph, plan, planGroup, toMin, type GraphData, type Route } from './engine'

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

  it('returns up to three distinct, labelled routes', () => {
    const res = plan(g, { ...at6pm, modes: ALL })
    expect(res.routes.length).toBeGreaterThan(0)
    expect(res.routes.length).toBeLessThanOrEqual(3)
    expect(new Set(res.routes.map((r) => r.id)).size).toBe(res.routes.length)
    const labels = res.routes.flatMap((r) => r.labels).sort()
    expect(labels).toEqual(['Cheapest', 'Fastest', 'Fewest transfers'])
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
