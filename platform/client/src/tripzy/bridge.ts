/**
 * Bridge between a Tripzy Capsule (engine) and a platform trip (days, places,
 * timed assignments, budget lines, bookings). The platform remains the record
 * people edit and share; the engine keeps the intelligence and re-plans.
 */
import { assignmentsApi, budgetApi, categoriesApi, daysApi, placesApi, reservationsApi, tripsApi } from '../api/client'
import { engine } from './engine'
import type { Block, Capsule, Day } from './types'

type PlatformDay = { id: number; day_number: number; date: string; assignments: { id: number; place_id: number; order_index: number }[] }

const CATEGORY_FOR: Record<string, string> = {
  heritage: 'Attraction', museum: 'Attraction', religious: 'Attraction', show: 'Activity', entertainment: 'Activity',
  market: 'Shopping', nature: 'Nature', viewpoint: 'Attraction', food: 'Restaurant', cafe: 'Bar/Cafe',
}

async function categoryIds(): Promise<Record<string, number>> {
  const r = await categoriesApi.list()
  const list: { id: number; name: string }[] = r.categories ?? r
  return Object.fromEntries(list.map((c) => [c.name, c.id]))
}

const placeBlocks = (d: Day) => d.blocks.filter((b) => (b.kind === 'place' || b.kind === 'meal' || b.kind === 'rest') && b.place_id && b.lat)

async function ensurePlaces(
  tripId: number,
  blocks: Block[],
  known: Record<string, number>,
  cats: Record<string, number>,
): Promise<Record<string, number>> {
  const out = { ...known }
  const todo = new Map<string, Block>()
  for (const b of blocks) if (b.place_id && !out[b.place_id] && !todo.has(b.place_id)) todo.set(b.place_id, b)
  const items = [...todo.values()]
  for (let i = 0; i < items.length; i += 6) {
    await Promise.all(items.slice(i, i + 6).map(async (b) => {
      const cat = b.kind === 'meal' ? 'food' : b.kind === 'rest' ? 'cafe' : b.cat || 'heritage'
      const { place } = await placesApi.create(tripId, {
        name: b.name.replace(/^Recharge at /, ''),
        lat: b.lat ?? undefined,
        lng: b.lon ?? undefined,
        description: b.desc || undefined,
        price: b.cost ? Math.round(b.cost) : undefined,
        currency: 'INR',
        duration_minutes: b.dwell,
        category_id: cats[CATEGORY_FOR[cat] ?? 'Other'] ?? undefined,
        notes: b.why ? `Tripzy: ${b.why}` : undefined,
      } as never)
      out[b.place_id!] = place.id
    }))
  }
  return out
}

async function writeDay(tripId: number, pday: PlatformDay, day: Day, placeIds: Record<string, number>) {
  for (const b of placeBlocks(day)) {
    const r = await assignmentsApi.create(tripId, pday.id, { place_id: placeIds[b.place_id!] } as never)
    const a = r.assignment ?? r
    await assignmentsApi.updateTime(tripId, a.id, { place_time: b.start.slice(0, 5), end_time: b.end.slice(0, 5) })
    if (b.why) await assignmentsApi.updateNotes(tripId, a.id, { notes: b.why })
  }
}

/** Turn a freshly composed Capsule into a full platform trip. Returns the platform trip id. */
export async function materialize(c: Capsule, onProgress?: (msg: string) => void): Promise<number> {
  const say = onProgress ?? (() => undefined)
  say('Creating your trip')
  const { trip } = await tripsApi.create({
    title: `${c.city.name} · ${c.brief.days} day${c.brief.days > 1 ? 's' : ''}`,
    description: `Planned by Tripzy for ${c.travellers.map((t) => t.label).join(', ')}. ${c.dna_summary.join(' · ')}.`,
    start_date: c.days[0].date,
    end_date: c.days[c.days.length - 1].date,
    currency: 'INR',
  })
  const tripId: number = trip.id
  const cats = await categoryIds()
  const { days } = (await daysApi.list(tripId)) as { days: PlatformDay[] }
  const byDate = new Map(days.map((d) => [d.date, d]))

  say('Adding verified places')
  const placeIds = await ensurePlaces(tripId, c.days.flatMap(placeBlocks), {}, cats)

  for (const d of c.days) {
    const pd = byDate.get(d.date)
    if (!pd) continue
    say(`Scheduling Day ${d.index + 1}`)
    await writeDay(tripId, pd, d, placeIds)
  }

  say('Writing the budget')
  for (const d of c.days) {
    const sum = (k: Block['kind']) => d.blocks.filter((b) => b.kind === k).reduce((a, b) => a + (b.cost || 0), 0)
    const lines: [string, string, number][] = [
      [`Day ${d.index + 1} · Tickets & entry`, 'Activities', sum('place')],
      [`Day ${d.index + 1} · Food`, 'Food', sum('meal') + sum('rest')],
      [`Day ${d.index + 1} · Local transport`, 'Transport', sum('leg')],
    ]
    for (const [name, category, total] of lines) {
      if (total > 0) await budgetApi.create(tripId, { name, category, total_price: Math.round(total), currency: 'INR' })
    }
  }
  if (c.budget.stay_estimate) {
    await budgetApi.create(tripId, { name: `Stay · ${c.stay.name} (estimate)`, category: 'Accommodation', total_price: c.budget.stay_estimate, currency: 'INR' })
  }

  for (const bk of c.bookings) {
    const pd = byDate.get(bk.date)
    await reservationsApi.create(tripId, {
      title: `${bk.mode === 'train' ? 'Train' : bk.mode === 'flight' ? 'Flight' : 'Bus'} ${bk.number} · ${bk.kind}`,
      type: bk.mode,
      status: 'confirmed',
      reservation_time: `${bk.date}T${bk.time}`,
      location: c.city.stations.find((s) => s.id === bk.station_id)?.name ?? bk.station_id,
      confirmation_number: bk.pnr || null,
      day_id: pd?.id ?? null,
      notes: 'Fixed anchor for Tripzy re-planning',
    } as never)
  }

  say('Linking Tripzy intelligence')
  const reverse = Object.fromEntries(Object.entries(placeIds).map(([tz, pid]) => [String(pid), tz]))
  await engine.link(c.id, tripId, reverse)
  return tripId
}

/** After a re-plan is accepted, rewrite the affected days in the platform trip. */
export async function resyncDays(platformTripId: number, c: Capsule, dayIndexes: number[]) {
  const link = await engine.getLink(platformTripId)
  const known = Object.fromEntries(Object.entries(link.places).map(([pid, tz]) => [tz, Number(pid)]))
  const cats = await categoryIds()
  const { days } = (await daysApi.list(platformTripId)) as { days: PlatformDay[] }
  const byDate = new Map(days.map((d) => [d.date, d]))
  const targets = c.days.filter((d) => dayIndexes.includes(d.index))
  const placeIds = await ensurePlaces(platformTripId, targets.flatMap(placeBlocks), known, cats)
  for (const d of targets) {
    const pd = byDate.get(d.date)
    if (!pd) continue
    await assignmentsApi.clearDay(platformTripId, pd.id)
    await writeDay(platformTripId, pd, d, placeIds)
  }
  const reverse = Object.fromEntries(Object.entries(placeIds).map(([tz, pid]) => [String(pid), tz]))
  await engine.link(c.id, platformTripId, reverse)
}

/** Read a day's order as the traveller arranged it in the planner, as Tripzy place ids. */
export async function readPlannerDay(platformTripId: number, c: Capsule, dayIndex: number): Promise<string[]> {
  const link = await engine.getLink(platformTripId)
  const { days } = (await daysApi.list(platformTripId)) as { days: PlatformDay[] }
  const pd = days.find((d) => d.date === c.days[dayIndex].date)
  if (!pd) return []
  return [...pd.assignments]
    .sort((a, b) => a.order_index - b.order_index)
    .map((a) => link.places[String(a.place_id)])
    .filter((x): x is string => !!x)
}
