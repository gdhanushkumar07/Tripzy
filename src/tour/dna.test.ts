import { describe, expect, it } from 'vitest'
import { generateBasic, type Place } from './generate'
import type { Merged } from './questions'

const P = (id: string, cat: string, tags: string[], more: Partial<Place> = {}): Place => ({
  id, city: 'x', name: id, lat: 17.38 + Number(id.length) * 0.001, lon: 78.48, cat, tags, hours: [['06:00', '23:59']], closed: [], dwell: 60,
  intensity: 2, cost: 0, best: [], desc: id, indoor: false, stairs: false, rating: 2, ...more,
})
const FOOD = [
  P('local-thali', 'food', ['food'], { meal: ['breakfast', 'lunch', 'dinner'], rating: 2.5 }),
  P('famous-biryani', 'food', ['food'], { meal: ['lunch', 'dinner'], rating: 6, must: true }),
  P('burger-chain', 'food', ['food'], { meal: ['lunch', 'dinner'], rating: 0.5 }),
  P('irani-cafe', 'cafe', ['food'], { meal: ['breakfast', 'snack'], rating: 2 }),
]
const base: Merged = { city: 'x', start: '2026-12-01', days: 1, party: 'solo', pace: 2, budget: 0, diet: 0, morning: 'early', effort: 'high', evening: 'early', food: 'sitdown', interests: ['history'], votes: {} }
const visits = (t: ReturnType<typeof generateBasic>, d = 0) => t.days[d].stops.filter((s) => s.kind === 'visit').map((s) => s.placeId)

describe('Travel DNA drives the plan', () => {
  it('puts places that match the answers ahead of famous places that do not', () => {
    const places = [P('old-fort', 'heritage', ['history']), P('big-temple', 'religious', ['spiritual'], { rating: 7 }), P('tomb', 'heritage', ['history', 'photography'])]
    const t = generateBasic({ ...base, pace: 1 }, 1, { places: [...places, ...FOOD] })
    expect(visits(t).slice(0, 2).sort()).toEqual(['old-fort', 'tomb'])
  })

  it('among matching places, the famous one comes first', () => {
    const places = [P('minor-ruin', 'heritage', ['history'], { rating: 1 }), P('world-famous-fort', 'heritage', ['history'], { rating: 7, must: true })]
    expect(visits(generateBasic(base, 1, { places: [...places, ...FOOD] }))[0]).toBe('world-famous-fort')
  })

  it('does not fill a day with one kind of place', () => {
    const temples = Array.from({ length: 6 }, (_, i) => P(`temple-${'x'.repeat(i)}`, 'religious', ['spiritual', 'history']))
    const t = generateBasic({ ...base, interests: ['spiritual', 'history', 'shopping'] }, 1, { places: [...temples, P('bazaar', 'market', ['shopping']), P('museum', 'museum', ['history']), ...FOOD] })
    expect(visits(t)).toContain('bazaar')
    expect(visits(t)).toContain('museum')
  })

  it('keeps night-only places for the evening and never plans bars for families', () => {
    const places = [P('club-lane', 'nightlife', ['nightlife'], { night: true, adult: true }), P('night-market', 'market', ['nightlife', 'shopping'], { night: true }), P('fort', 'heritage', ['history'])]
    const friends = generateBasic({ ...base, party: 'friends', evening: 'nightlife', interests: ['nightlife', 'history'] }, 1, { places: [...places, ...FOOD] })
    for (const s of friends.days[0].stops) if (s.placeId === 'club-lane' || s.placeId === 'night-market') expect(s.start).toBeGreaterThanOrEqual(17 * 60)
    const family = generateBasic({ ...base, party: 'kids', interests: ['nightlife', 'history'] }, 1, { places: [...places, ...FOOD] })
    expect(visits(family)).not.toContain('club-lane')
  })

  it('prefers signature food over chains', () => {
    const t = generateBasic({ ...base, interests: ['history'] }, 1, { places: [P('fort', 'heritage', ['history'], { dwell: 240 }), ...FOOD] })
    const meals = t.days[0].stops.filter((s) => s.kind === 'meal').map((s) => s.placeId)
    expect(meals).toContain('famous-biryani')
    expect(meals).not.toContain('burger-chain')
  })

  it('gives every group member something they picked', () => {
    const places = [P('fort', 'heritage', ['history'], { rating: 7 }), P('fort-2', 'heritage', ['history'], { rating: 6 }), P('fort-3', 'heritage', ['history'], { rating: 6 }), P('zoo', 'entertainment', ['kids']), P('mall', 'market', ['shopping'])]
    const votes = { history: ['Asha', 'Ravi'], kids: ['Meena'], shopping: ['Kiran'] }
    const t = generateBasic({ ...base, party: 'friends', interests: ['history', 'kids', 'shopping'], votes, pace: 2 }, 4, { places: [...places, ...FOOD] })
    const who = new Set(t.days[0].stops.flatMap((s) => s.who))
    for (const m of ['Asha', 'Ravi', 'Meena', 'Kiran']) expect(who).toContain(m)
  })

  it('plans more than five days and adds the ride back to the hotel', () => {
    const places = Array.from({ length: 30 }, (_, i) => P(`site-${'y'.repeat(i)}`, i % 2 ? 'heritage' : 'museum', ['history']))
    const t = generateBasic({ ...base, days: 8 }, 1, { places: [...places, ...FOOD], base: { name: 'My hotel', lat: 17.4, lon: 78.47 } })
    expect(t.days).toHaveLength(8)
    expect(t.days[0].stops[0].travel).not.toBeNull()
    expect(t.days[0].back).toBeTruthy()
  })
})
