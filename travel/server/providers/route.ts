/** Road routing: Ola Maps Directions when a key is set, else the public OSRM server. */
import { cached, DAY, env, fetchJson, HOUR, providerFailed, providerUp, type LatLon } from '../lib'

export type RoadLeg = { km: number; min: number; geometry?: [number, number][]; source: string }

const r5 = (x: number) => x.toFixed(5)

export function road(a: LatLon, b: LatLon, profile: 'driving' | 'walking' | 'cycling' = 'driving'): Promise<RoadLeg> {
  return cached(`road:${profile}:${r5(a.lat)},${r5(a.lon)}>${r5(b.lat)},${r5(b.lon)}`, 7 * DAY, async () => {
    if (profile === 'driving' && env('OLA_MAPS_API_KEY') && providerUp('ola')) {
      try {
        const u = `https://api.olamaps.io/routing/v1/directions/basic?origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&api_key=${env('OLA_MAPS_API_KEY')}`
        const j = await fetchJson<{ routes: { legs: { distance: number; duration: number }[]; overview_polyline?: string }[] }>(u, { method: 'POST', headers: { 'X-Request-Id': crypto.randomUUID() } })
        const leg = j.routes?.[0]?.legs?.[0]
        if (leg) return { km: leg.distance / 1000, min: leg.duration / 60, geometry: decodePolyline(j.routes[0].overview_polyline), source: 'Ola Maps' }
      } catch (e) { providerFailed('ola', e) /* fall back to OSRM */ }
    }
    const host = profile === 'driving' ? 'https://router.project-osrm.org/route/v1/driving' : `https://routing.openstreetmap.de/routed-${profile === 'walking' ? 'foot' : 'bike'}/route/v1/driving`
    const j = await fetchJson<{ routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }>(
      `${host}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson`)
    const r = j.routes?.[0]
    if (!r) throw new Error('no road route')
    return { km: r.distance / 1000, min: r.duration / 60, geometry: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]), source: 'OSRM (OpenStreetMap)' }
  }, true)
}

/** One OSRM table request (≤ 100 coordinates): rows = sources, columns = destinations. */
function tableChunk(src: LatLon[], dst: LatLon[]) {
  const pts = [...src, ...dst]
  const coords = pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
  const sources = src.map((_, i) => i).join(';')
  const destinations = dst.map((_, i) => src.length + i).join(';')
  return cached(`table:${coords}|${sources}|${destinations}`, 6 * HOUR, () =>
    fetchJson<{ durations: (number | null)[][]; distances: (number | null)[][] }>(
      `https://router.project-osrm.org/table/v1/driving/${coords}?sources=${sources}&destinations=${destinations}&annotations=duration,distance`, { timeoutMs: 25000 }))
}

/** Road distance/time matrix between many points (OSRM table, split into ≤ 90-point requests). */
export async function roadTable(points: LatLon[]): Promise<{ km: (number | null)[][]; min: (number | null)[][]; source: string }> {
  const n = points.length
  const size = 45
  const groups = Array.from({ length: Math.ceil(n / size) }, (_, i) => points.slice(i * size, (i + 1) * size))
  const km: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null))
  const min: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null))
  await Promise.all(groups.flatMap((ga, gi) => groups.map(async (gb, gj) => {
    const j = await tableChunk(ga, gb)
    ga.forEach((_, r) => gb.forEach((_, c) => {
      const d = j.distances[r]?.[c], t = j.durations[r]?.[c]
      km[gi * size + r][gj * size + c] = d == null ? null : d / 1000
      min[gi * size + r][gj * size + c] = t == null ? null : t / 60
    }))
  })))
  return { km, min, source: 'OSRM (OpenStreetMap)' }
}

function decodePolyline(s?: string): [number, number][] | undefined {
  if (!s) return undefined
  const out: [number, number][] = []
  let i = 0, lat = 0, lng = 0
  while (i < s.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, res = 0
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
      const d = res & 1 ? ~(res >> 1) : res >> 1
      if (which === 0) lat += d; else lng += d
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}
