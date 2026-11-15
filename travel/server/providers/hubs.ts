/**
 * Railway junctions and bus terminals for intercity legs (Photon / OpenStreetMap, fast, no key).
 * Searches by the point's city name ("Hyderabad bus station", "Hyderabad junction") so only real
 * terminals are used, plus a probe along the way out of town (catches stands like Uppal).
 */
import { CITIES } from '../data/cities'
import { cached, DAY, fetchJson, haversineKm, type LatLon } from '../lib'

export type Hub = { id: string; name: string; lat: number; lon: number; kind: 'rail' | 'bus'; state?: string; city?: string; major?: boolean }
type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }

export function cityOf(p: LatLon): { name: string; state: string; lat: number; lon: number } | null {
  let best: (typeof CITIES)[number] | null = null, bd = 1e9
  for (const c of CITIES) { const d = haversineKm(p, { lat: c[2], lon: c[3] }); if (d < bd) { bd = d; best = c } }
  return best && bd <= 45 ? { name: best[0], state: best[1], lat: best[2], lon: best[3] } : null
}

function search(q: string, tag: string, near: LatLon, limit = 15): Promise<Feature[]> {
  const bbox = [near.lon - 0.45, near.lat - 0.4, near.lon + 0.45, near.lat + 0.4].map((x) => x.toFixed(3)).join(',')
  return cached(`photon-q:${tag}:${q}:${near.lat.toFixed(2)},${near.lon.toFixed(2)}`, 30 * DAY, async () => {
    const j = await fetchJson<{ features: Feature[] }>(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${near.lat}&lon=${near.lon}&bbox=${bbox}&osm_tag=${tag}&limit=${limit}`)
    return j.features
  }, true)
}
function nearby(p: LatLon, tag: string, radiusKm: number, limit: number): Promise<Feature[]> {
  return cached(`photon-rev:${tag}:${p.lat.toFixed(3)},${p.lon.toFixed(3)}:${radiusKm}`, 30 * DAY, async () => {
    const j = await fetchJson<{ features: Feature[] }>(`https://photon.komoot.io/reverse?lat=${p.lat}&lon=${p.lon}&osm_tag=${tag}&radius=${radiusKm}&limit=${limit}`)
    return j.features
  }, true)
}

const ll = (f: Feature) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })
const RAIL_MAJOR = /junction|\bjn\b|terminal|terminus|central|deccan|cantt|kacheguda|lingampall|nampally/i
const BUS_TERMINAL = /bus (station|stand|terminal|terminus|stn|complex)|mgbs|jbs|\bisbt\b/i
const NOT_TERMINAL = /\bstop\b|depot|quarters/i
/** Known intercity bus terminals in major cities (they always rank first when found). */
const KNOWN_TERMINAL = /mgbs|mahatma gandhi bus|jubilee bus|jublee bus|\bjbs\b|uppal|\bisbt\b|kempegowda|majestic|satellite bus|koyambedu|kilambakkam|cmbt|kashmere gate|anand vihar|sarai kale khan|swargate|shivajinagar|pune station bus|dadar|mumbai central|borivali|thane bus|esplanade|babughat|geeta mandir|sindhi camp|alambagh|charbagh|pandit deendayal|vijayawada.*bus|dwaraka bus|kottayam|thampanoor|vyttila|kesarbagh/i

/** Main railway stations for a point: junctions/terminals of its city, metro stations excluded. */
export async function railHubs(p: LatLon, excludeNear: LatLon[] = [], k = 3): Promise<Hub[]> {
  const city = cityOf(p)
  const queries = city ? [`${city.name} junction`, `${city.name} railway station`, `${city.name} station`] : []
  const found = (await Promise.all([...queries.map((q) => search(q, 'railway:station', city ?? p).catch(() => [])), nearby(p, 'railway:station', 15, 25).catch(() => [])])).flat()
  const seen = new Set<string>()
  return found
    .filter((f) => f.properties.name && !/metro/i.test(f.properties.name) && !seen.has(f.properties.osm_id) && seen.add(f.properties.osm_id))
    .filter((f) => !excludeNear.some((m) => haversineKm(m, ll(f)) < 0.35))
    .filter((f) => haversineKm(p, ll(f)) < 40)
    .map((f) => ({ f, score: haversineKm(p, ll(f)) - (RAIL_MAJOR.test(f.properties.name) || (city && f.properties.name.includes(city.name)) ? 20 : 0) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, k)
    .map(({ f }) => ({ id: `r${f.properties.osm_id}`, name: f.properties.name, ...ll(f), kind: 'rail' as const, state: f.properties.state, city: city?.name, major: RAIL_MAJOR.test(f.properties.name) || (!!city && f.properties.name.toLowerCase().startsWith(city.name.toLowerCase())) }))
}

/** Intercity bus terminals of a point's city, nearest to the route out of town first. */
export async function busHubs(p: LatLon, toward?: LatLon, k = 6): Promise<Hub[]> {
  const city = cityOf(p)
  const probes = [p]
  if (toward) {
    for (const km of [18, 36]) {
      const f = Math.min(1, km / Math.max(haversineKm(p, toward), 1))
      probes.push({ lat: p.lat + (toward.lat - p.lat) * f, lon: p.lon + (toward.lon - p.lon) * f })
    }
  }
  const found = (await Promise.all([
    city ? search(`${city.name} bus station`, 'amenity:bus_station', city, 20).catch(() => []) : Promise.resolve([]),
    ...probes.map((q) => nearby(q, 'amenity:bus_station', 10, 40).catch(() => [])),
  ])).flat()
  const seen = new Set<string>()
  const dist = (x: LatLon) => Math.min(...probes.map((q) => haversineKm(q, x)))
  return found
    .filter((f) => f.properties.name && BUS_TERMINAL.test(f.properties.name) && !NOT_TERMINAL.test(f.properties.name) && !seen.has(f.properties.osm_id) && seen.add(f.properties.osm_id))
    .filter((f) => haversineKm(p, ll(f)) < 45)
    .sort((a, b) => dist(ll(a)) - (KNOWN_TERMINAL.test(a.properties.name) ? 30 : 0) - (dist(ll(b)) - (KNOWN_TERMINAL.test(b.properties.name) ? 30 : 0)))
    .slice(0, k)
    .map((f) => ({ id: `b${f.properties.osm_id}`, name: f.properties.name.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' '), ...ll(f), kind: 'bus' as const, state: f.properties.state, city: city?.name }))
}
