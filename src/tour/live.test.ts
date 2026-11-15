import { describe, expect, it } from 'vitest'
import { profileFrom, type HistoryEvent } from '../lib/taste'
import { generateBasic, retime, type DayWx, type Place } from './generate'
import { mergeAnswers, type Answers } from './questions'

const base = (id: string, over: Partial<Place>): Place => ({
  id, city: 'x', name: id, lat: 10 + Math.random() * 0.01, lon: 76 + Math.random() * 0.01, cat: 'heritage', tags: ['history'],
  hours: [], closed: [], dwell: 60, intensity: 3, cost: 50, best: [], desc: id, indoor: false, stairs: false, ...over,
})
const day = '2026-12-01'
const wx = (rainFrom: number): DayWx => ({
  temp: Array(24).fill(28), feels: Array(24).fill(30), rain: Array.from({ length: 24 }, (_, h) => (h >= rainFrom ? 90 : 0)),
  code: Array.from({ length: 24 }, (_, h) => (h >= rainFrom ? 63 : 1)), aqi: Array(24).fill(60), uv: Array(24).fill(5), sunrise: 6 * 60 + 20, sunset: 17 * 60 + 50, max: 30, rainMax: 90,
})
const answers: Answers = { city: 'x', start: day, days: 1, party: 'solo', budget: 0, pace: 2, diet: 0, interests: ['history', 'art'], morning: 'early', effort: 'high', evening: 'nightlife', food: 'sitdown' }

describe('live tour planning', () => {
  it('respects real opening intervals for the date', () => {
    const fort = base('fort', { open: { [day]: [14 * 60, 17 * 60] } })
    const t = generateBasic(mergeAnswers(answers, [{ name: 'me', answers }]), 1, { places: [fort, base('m', { cat: 'museum', tags: ['art'], indoor: true })] })
    const s = t.days[0].stops.find((x) => x.placeId === 'fort')!
    expect(s.start).toBeGreaterThanOrEqual(14 * 60)
  })

  it('moves outdoor stops away from heavy rain and prefers indoor ones then', () => {
    const outdoor = base('outdoor', { tags: ['history', 'art'] })
    const museum = base('museum', { cat: 'museum', tags: ['art'], indoor: true })
    const t = generateBasic(mergeAnswers(answers, [{ name: 'me', answers }]), 1, { places: [outdoor, museum], weather: { [day]: wx(0) } })
    expect(t.days[0].stops[0].placeId).toBe('museum')
    expect(t.days[0].stops.find((s) => s.placeId === 'outdoor')?.notes?.join(' ') ?? 'skipped').toMatch(/rain|skipped/)
  })

  it('keeps weather notes after an edit', () => {
    const t = generateBasic(mergeAnswers(answers, [{ name: 'me', answers }]), 1, { places: [base('a', {}), base('b', {})], weather: { [day]: wx(12) } })
    const r = retime(t, 0)
    expect(r.days[0].stops.every((s) => s.wx)).toBe(true)
  })
})

describe('personalisation from history', () => {
  it('boosts what you keep and lowers what you remove, with reasons', () => {
    const now = Date.now()
    const ev: HistoryEvent[] = [
      { type: 'trip_created', at: now, city: 'Jaipur', interests: ['history', 'food'], days: 2 },
      { type: 'stop_swapped', at: now, from: ['shopping'], to: ['history'], toName: 'Amber Fort' },
      { type: 'stop_removed', at: now, name: 'Mall', tags: ['shopping'] },
      { type: 'route_saved', at: now, modes: ['metro', 'auto'], from: 'a', to: 'b' },
    ]
    const p = profileFrom(ev, now)
    expect(p.boost.history).toBeGreaterThan(0)
    expect(p.boost.shopping).toBeLessThan(0)
    expect(p.boostWhy.history).toMatch(/Because you chose history/)
    expect(p.modes[0]).toBe('metro')
    expect(p.cities).toContain('Jaipur')
  })

  it('forgets old behaviour over time', () => {
    const now = Date.now()
    const old = profileFrom([{ type: 'stop_removed', at: now - 365 * 86400000, name: 'x', tags: ['art'] }], now)
    expect(old.boost.art ?? 0).toBe(0)
  })
})
