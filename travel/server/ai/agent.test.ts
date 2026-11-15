import { describe, expect, it } from 'vitest'
import { applyRouteChanges, modesFromWords, parseIntent } from './agent'
import { bm25, chunkMarkdown, retrieve } from './rag'

const route = (t: string) => { const r = parseIntent(t); if (r.kind !== 'route') throw new Error(`not a route: ${t}`); return r.args }

describe('Tripzy AI understands travel requests without the model', () => {
  it('"Take me from Kokapet to Miyapur."', () => {
    expect(route('Take me from Kokapet to Miyapur.')).toMatchObject({ from: 'Kokapet', to: 'Miyapur' })
  })
  it('"I have a scooty but don\'t want to drive in traffic. Karmanghat to Kokapet" avoids the scooter', () => {
    const a = route("I have a scooty but don't want to drive in traffic. Karmanghat to Kokapet")
    expect(a).toMatchObject({ from: 'Karmanghat', to: 'Kokapet', own_vehicle: 'none' })
    expect(a.avoid).toContain('scooter')
  })
  it('"I am in a hurry; show me the fastest option from Karmanghat to Kokapet" asks for the fastest', () => {
    expect(route('I am in a hurry; show me the fastest option from Karmanghat to Kokapet')).toMatchObject({ from: 'Karmanghat', to: 'Kokapet', priority: 'fastest' })
  })
  it('uses the scooter when they have one and are happy to ride', () => {
    expect(route('I have a scooty, take me to HITEC City')).toMatchObject({ to: 'HITEC City', own_vehicle: 'scooter' })
  })
  it('reads times, tomorrow, group size and public-transport-only', () => {
    const a = route('Gachibowli to Charminar at 6 pm tomorrow by metro for 3 people')
    expect(a.time).toBe('18:00')
    expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(a.only).toContain('metro')
    expect(a.people).toBe(3)
  })
  it('cheap and comfort wording', () => {
    expect(route('cheapest way from Uppal to Ameerpet').priority).toBe('cheapest')
    expect(route('Ameerpet to the airport with luggage and kids').priority).toBe('comfort')
  })
  it('hotels and weather are not routes', () => {
    expect(parseIntent('Find hotels in Varanasi')).toEqual({ kind: 'hotels', place: 'Varanasi' })
    expect(parseIntent('What is the weather in Goa?')).toEqual({ kind: 'weather', place: 'Goa' })
    expect(parseIntent('How does the group meeting point work?').kind).toBe('help')
  })
  it('maps everyday words to modes', () => {
    expect(modesFromWords(['scooter'])).toEqual(['ownscooter'])
    expect(modesFromWords(['bus', 'metro'])).toEqual(['citybus', 'metro'])
  })
})

describe('retrieval (RAG)', () => {
  it('finds the right help passage', () => {
    const top = retrieve('how does the meeting point for a group work', [], 2)
    expect(top[0].title).toMatch(/Group/i)
  })
  it('ranks the user\'s own saved data', () => {
    const memory = chunkMarkdown('## Saved route: Office\nKokapet to HITEC City every weekday at 9 by bike taxi\n## Saved trip: Goa\nThree days in Goa in December', 'mine')
    expect(bm25('my office route', memory, 1)[0].title).toMatch(/Office/)
  })
})

describe('Tripzy AI edits the current plan instead of starting over', () => {
  const state = { route: { from: 'Kokapet', to: 'Warangal', time: '07:00' } }
  const edit = (t: string) => { const r = parseIntent(t, state); if (r.kind !== 'edit') throw new Error(`not an edit: ${t} → ${r.kind}`); return r.changes }
  it('"make it cheaper" / "I am in a hurry"', () => {
    expect(edit('make it cheaper').priority).toBe('cheapest')
    expect(edit("I'm in a hurry now").priority).toBe('fastest')
  })
  it('"avoid buses", "use the metro", "heavy bags", "leave at 8 pm", "we are 4"', () => {
    expect(edit('avoid buses').remove_modes).toContain('buses')
    expect(edit('use the metro instead').add_modes).toContain('metro')
    expect(edit('I have heavy bags').luggage).toBe('heavy')
    expect(edit('leave at 8 pm').time).toBe('20:00')
    expect(edit('we are 4').people).toBe(4)
  })
  it('"I hate traffic and pollution" keeps the metro in', () => {
    expect(edit('I hate traffic and pollution').add_modes).toContain('metro')
  })
  it('merges changes into the request', () => {
    const next = applyRouteChanges({ to: 'Warangal', avoid: ['bus'] }, { priority: 'cheapest', add_modes: ['bus', 'metro'], time: '08:00' })
    expect(next).toMatchObject({ to: 'Warangal', priority: 'cheapest', time: '08:00' })
    expect(next.avoid).toEqual([])
    expect(next.extra).toEqual(['bus', 'metro'])
  })
  it('a brand-new "A to B" is a new trip, not an edit', () => {
    expect(parseIntent('Gachibowli to Charminar', state).kind).toBe('route')
  })
})

describe('Tripzy AI fills the Tourist Planner from chat', () => {
  it('"3 days in Jaipur from 2026-12-20 with kids, vegetarian, love history"', () => {
    const r = parseIntent('Plan 3 days in Jaipur from 2026-12-20 with kids, vegetarian, love history')
    expect(r).toMatchObject({ kind: 'tour', args: { destination: 'Jaipur', days: 3, start: '2026-12-20', party: 'kids', diet: 1, interests: ['history'] } })
  })
  it('follow-up on a tour: "make it relaxed, we are pure veg"', () => {
    const r = parseIntent('make it relaxed, we are pure veg', { tour: { destination: 'Jaipur', days: 3 } })
    expect(r).toMatchObject({ kind: 'tour', args: { pace: 1, diet: 2 } })
  })
  it('asking to change preferences opens the picker', () => {
    expect(parseIntent('change my preferences').kind).toBe('prefs')
  })
})
