import { describe, expect, it } from 'vitest'
import type { Mode } from '../lib/types'
import { buildGraph, plan, planGroup, toMin, type GraphData } from './engine'

/** A tiny graph like the ones the live planner builds: two places, a metro line with an official fare table, roads. */
function g(): ReturnType<typeof buildGraph> {
  const data: GraphData = {
    peakWindows: [['08:00', '11:00'], ['17:00', '21:00']],
    private: {
      auto: { base: 30, baseKm: 1.5, perKm: 16, wait: 5, speed: 1.1, peakShare: 1, maxKm: 25, capacity: 3 },
      cab: { base: 60, perKm: 14, perMin: 1.5, wait: 7, speed: 1, peakShare: 1, maxKm: 600, capacity: 4 },
      suv: { base: 90, perKm: 19, perMin: 2, wait: 9, speed: 1, peakShare: 1, maxKm: 600, capacity: 6 },
    },
    walk: { kmh: 4.5, maxKm: 2 },
    nodes: [
      { id: 'O', name: 'Home', kind: 'place', lat: 0, lon: 0 }, { id: 'A', name: 'A Metro', kind: 'metro', lat: 0, lon: 0.01 },
      { id: 'B', name: 'B Metro', kind: 'metro', lat: 0, lon: 0.05 }, { id: 'C', name: 'C Metro', kind: 'metro', lat: 0, lon: 0.1 },
      { id: 'D', name: 'Office', kind: 'place', lat: 0, lon: 0.11 }, { id: 'E', name: 'Mall', kind: 'place', lat: 0.01, lon: 0.1 },
    ],
    roads: [
      { a: 'O', b: 'A', km: 1, min: 4, peak: 1 }, { a: 'C', b: 'D', km: 1, min: 4, peak: 1 },
      { a: 'O', b: 'D', km: 14, min: 30, peak: 1.5 }, { a: 'O', b: 'E', km: 13, min: 28, peak: 1.5 }, { a: 'D', b: 'E', km: 2, min: 6, peak: 1.5 },
    ],
    transfers: [],
    lines: [{
      id: 'm', mode: 'metro', name: 'Metro', headway: 6, stops: ['A', 'B', 'C'], segments: [{ km: 4, min: 8, fare: 0 }, { km: 5, min: 9, fare: 0 }],
      // official fares by boarding → alighting, not additive per segment
      fareAt: [[0, 20, 30], [20, 0, 20], [30, 20, 0]],
    }],
  }
  return buildGraph(data)
}
const modes: Mode[] = ['walk', 'auto', 'cab', 'suv', 'metro']

describe('live-graph engine', () => {
  it('prices a metro ride by boarding and alighting stations', () => {
    const r = plan(g(), { from: 'O', to: 'D', depart: toMin('13:00'), modes: ['walk', 'metro'] }).routes[0]
    const metro = r.legs.find((l) => l.mode === 'metro')!
    expect(metro.fare).toBe(30)
  })

  it('splits a cab between the travellers', () => {
    const one = plan(g(), { from: 'O', to: 'D', depart: toMin('13:00'), modes: ['cab'] }).routes[0]
    const four = plan(g(), { from: 'O', to: 'D', depart: toMin('13:00'), modes: ['cab'], people: 4 }).routes[0]
    expect(four.fare).toBe(Math.round(one.fare / 4))
  })

  it('with four people one cab beats two autos per person', () => {
    const res = plan(g(), { from: 'O', to: 'D', depart: toMin('13:00'), modes: ['walk', 'auto', 'cab'], people: 4 })
    const cheapest = res.routes.find((r) => r.labels.includes('Cheapest'))!
    expect(cheapest.legs.some((l) => l.mode === 'cab')).toBe(true)
    expect(cheapest.why).toMatch(/split 4 ways/)
  })

  it('offers one cab for a group going to nearby places', () => {
    const p = planGroup(g(), {
      from: 'O', depart: toMin('18:00'), modes,
      members: [{ id: '1', name: 'A', to: 'D' }, { id: '2', name: 'B', to: 'E' }, { id: '3', name: 'C', to: 'D' }, { id: '4', name: 'D', to: 'E' }],
    })!
    expect(p.together).toBeTruthy()
    expect(p.together!.mode).toBe('cab')
    expect(p.together!.stops).toHaveLength(4)
    expect(typeof p.together!.recommended).toBe('boolean')
    expect(p.together!.why.length).toBeGreaterThan(0)
  })
})
