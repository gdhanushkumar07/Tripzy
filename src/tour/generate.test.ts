import { describe, expect, it } from 'vitest'
import { dayTotal, generateBasic, moveStop, placeById, removeStop, swapStop, alternatives, tripTotal } from './generate'
import { mergeAnswers, type Answers } from './questions'

const solo: Answers = {
  city: 'hyderabad', start: '2026-12-18', days: 2, party: 'solo', budget: 2000, pace: 2, diet: 1,
  interests: ['history', 'food', 'photography'], morning: 'early', effort: 'high', evening: 'nightlife', food: 'street',
}
const merged = (a: Answers) => mergeAnswers(a, [{ name: 'Me', answers: a }])

describe('basic plan', () => {
  it('builds a day-by-day itinerary with costs within budget', () => {
    const t = generateBasic(merged(solo))
    expect(t.days).toHaveLength(2)
    for (const d of t.days) {
      expect(d.stops.length).toBeGreaterThan(1)
      expect(dayTotal(d)).toBeLessThanOrEqual(2000)
      for (let i = 1; i < d.stops.length; i++) expect(d.stops[i].start).toBeGreaterThanOrEqual(d.stops[i - 1].end)
    }
    expect(tripTotal(t)).toBeGreaterThan(0)
  })

  it('respects vegetarian diet and weekly closures', () => {
    const t = generateBasic(merged(solo))
    const meals = t.days.flatMap((d) => d.stops.filter((s) => s.kind === 'meal'))
    expect(meals.length).toBeGreaterThan(0)
    for (const m of meals) expect(placeById(m.placeId)!.diet).not.toBe('nonveg')
    // 2026-12-18 is a Friday (weekday 4): Salar Jung / Chowmahalla are shut on Fridays
    for (const s of t.days[0].stops) expect(placeById(s.placeId)!.closed).not.toContain(4)
  })

  it('edits recalculate times and totals at once', () => {
    const t = generateBasic(merged(solo))
    const before = dayTotal(t.days[0])
    const removed = removeStop(t, 0, 0)
    expect(removed.days[0].stops).toHaveLength(t.days[0].stops.length - 1)
    expect(dayTotal(removed.days[0])).not.toBe(before)
    const moved = moveStop(t, 0, 0, 1)
    expect(moved.days[0].stops[0].placeId).toBe(t.days[0].stops[1].placeId)
    const alts = alternatives(t, 0, 0)
    if (alts.length) expect(swapStop(t, 0, 0, alts[0]).days[0].stops[0].placeId).toBe(alts[0].id)
  })
})

describe('group merge', () => {
  it('lowest budget, slowest pace, strictest diet, interests by votes', () => {
    const m = mergeAnswers({ city: 'jaipur', start: '2026-12-18', days: 1 }, [
      { name: 'Asha', answers: { budget: 4000, pace: 3, diet: 0, interests: ['history', 'shopping'] } },
      { name: 'Ravi', answers: { budget: 800, pace: 1, diet: 2, interests: ['history', 'nature'] } },
    ])
    expect(m.budget).toBe(800)
    expect(m.pace).toBe(1)
    expect(m.diet).toBe(2)
    expect(m.interests![0]).toBe('history')
    expect(m.votes.history).toEqual(['Asha', 'Ravi'])
    const t = generateBasic(m, 2)
    expect(t.days[0].stops.some((s) => s.who.length > 0)).toBe(true)
  })
})
