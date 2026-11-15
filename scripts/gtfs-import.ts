/**
 * Downloads official/public GTFS feeds for Indian cities and builds a compact
 * index the API server uses for metro and city-bus legs:
 *   stations, stop patterns with typical running times, first-stop departures
 *   per day type (weekday / Saturday / Sunday), and fares where published.
 *
 *   npm run gtfs            # all feeds
 *   npm run gtfs -- hmrl    # one feed
 *
 * Sources are mirrored by MobilityData (mobilitydatabase.org). Licences belong
 * to the publishers; the index is generated locally and not committed.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { FEEDS, type FeedDef } from '../server/transit/feeds'

const CACHE = '.gtfs-cache'
const OUT = 'server/data/gtfs'

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const head = rows.shift()!.map((h) => h.trim()) // trim() also strips a UTF-8 BOM
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const secs = (t: string) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0) }

async function load(feed: FeedDef): Promise<Record<string, Uint8Array>> {
  mkdirSync(CACHE, { recursive: true })
  const file = join(CACHE, `${feed.id}.zip`)
  if (!existsSync(file)) {
    console.log(`  downloading ${feed.url}`)
    const res = await fetch(feed.url)
    if (!res.ok) throw new Error(`download failed ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return unzipSync(new Uint8Array(readFileSync(file)))
}

async function build(feed: FeedDef) {
  console.log(`> ${feed.id} (${feed.name})`)
  const z = await load(feed)
  const csv = (n: string) => (z[n] ? parseCsv(strFromU8(z[n])) : [])
  const stopsRaw = csv('stops.txt')
  const routes = new Map(csv('routes.txt').map((r) => [r.route_id, r]))
  const calendars = new Map(csv('calendar.txt').map((c) => [c.service_id, c]))
  const trips = new Map(csv('trips.txt').map((t) => [t.trip_id, t]))

  // station-level stops: platforms collapse into their parent station
  const parentOf = new Map<string, string>()
  const stations = new Map<string, { name: string; lat: number; lon: number }>()
  for (const s of stopsRaw) {
    const parent = s.parent_station && s.location_type !== '1' ? s.parent_station : ''
    parentOf.set(s.stop_id, parent || s.stop_id)
    if (!parent) stations.set(s.stop_id, { name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) })
  }
  const stationIds = [...stations.keys()]
  const idx = new Map(stationIds.map((id, i) => [id, i]))

  // group stop_times per trip
  console.log('  reading stop_times…')
  const byTrip = new Map<string, { seq: number; stop: number; t: number }[]>()
  for (const st of csv('stop_times.txt')) {
    const station = parentOf.get(st.stop_id) ?? st.stop_id
    const i = idx.get(station)
    if (i === undefined) continue
    const t = secs(st.departure_time || st.arrival_time)
    const list = byTrip.get(st.trip_id) ?? []
    list.push({ seq: Number(st.stop_sequence), stop: i, t })
    byTrip.set(st.trip_id, list)
  }

  const dayTypes = (serviceId: string) => {
    const c = calendars.get(serviceId)
    if (!c) return ['wk', 'sa', 'su']
    const out: string[] = []
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].some((d) => c[d] === '1')) out.push('wk')
    if (c.saturday === '1') out.push('sa')
    if (c.sunday === '1') out.push('su')
    return out
  }

  type Pattern = { route: string; name: string; color?: string; stops: number[]; times: number[]; deps: Record<string, number[]> }
  const patterns = new Map<string, Pattern>()
  for (const [tripId, list] of byTrip) {
    const trip = trips.get(tripId)
    if (!trip || list.length < 2) continue
    list.sort((a, b) => a.seq - b.seq)
    const stops = list.map((x) => x.stop)
    const key = `${trip.route_id}|${stops.join(',')}`
    let p = patterns.get(key)
    if (!p) {
      const r = routes.get(trip.route_id)
      const name = feed.routeName?.(r ?? {}, trip) ?? (r?.route_short_name || r?.route_long_name || trip.route_id)
      p = { route: trip.route_id, name, color: r?.route_color ? `#${r.route_color}` : undefined, stops, times: list.map((x) => x.t - list[0].t), deps: {} }
      patterns.set(key, p)
    }
    for (const d of dayTypes(trip.service_id)) (p.deps[d] ??= []).push(list[0].t)
  }
  for (const p of patterns.values()) for (const d of Object.keys(p.deps)) p.deps[d].sort((a, b) => a - b)

  // published zone fares (metro): station-pair → price
  const fareAttr = new Map(csv('fare_attributes.txt').map((f) => [f.fare_id, Number(f.price)]))
  const zoneOf = new Map<string, string>()
  for (const s of stopsRaw) if (s.zone_id) zoneOf.set(parentOf.get(s.stop_id) ?? s.stop_id, s.zone_id)
  const fares: Record<string, number> = {}
  for (const r of csv('fare_rules.txt')) {
    const price = fareAttr.get(r.fare_id)
    if (price !== undefined && r.origin_id && r.destination_id) fares[`${r.origin_id}|${r.destination_id}`] = price
  }

  const out = {
    id: feed.id, name: feed.name, city: feed.city, mode: feed.mode, attribution: feed.attribution,
    builtAt: new Date().toISOString(),
    stations: stationIds.map((id) => { const s = stations.get(id)!; return [id, s.name, +s.lat.toFixed(6), +s.lon.toFixed(6), zoneOf.get(id) ?? id] }),
    patterns: [...patterns.values()],
    fares: Object.keys(fares).length ? fares : undefined,
    fareSlab: feed.fareSlab,
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `${feed.id}.json`), JSON.stringify(out))
  console.log(`  ${stationIds.length} stations, ${patterns.size} patterns, ${Object.keys(fares).length} fare pairs`)
}

const only = process.argv.slice(2)
for (const f of FEEDS.filter((f) => !only.length || only.includes(f.id))) {
  try { await build(f) } catch (e) { console.error(`  ${f.id} failed: ${(e as Error).message}`) }
}
