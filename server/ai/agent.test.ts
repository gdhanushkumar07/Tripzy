import { describe, expect, it } from 'vitest'
import { modesFromWords, parseIntent } from './agent'
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
