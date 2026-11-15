/** Geocoding and search anywhere in India: Ola Maps when a key is set, else Photon (OSM). */
import { cached, DAY, env, fetchJson } from '../lib'

export type Place = { id: string; name: string; label: string; lat: number; lon: number; kind?: string; state?: string; city?: string; source: string }

const INDIA_BBOX = '68.1,6.5,97.4,35.7' // lon,lat,lon,lat

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }

async function photon(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const u = new URL('https://photon.komoot.io/api/')
  u.searchParams.set('q', q)
  u.searchParams.set('limit', '8')
  u.searchParams.set('bbox', INDIA_BBOX)
  if (near) { u.searchParams.set('lat', String(near.lat)); u.searchParams.set('lon', String(near.lon)) }
  const j = await fetchJson<{ features: PhotonFeature[] }>(u.toString())
  return j.features
    .filter((f) => (f.properties.countrycode ?? 'IN').toUpperCase() === 'IN')
    .map((f) => {
      const p = f.properties
      const city = p.city || p.county || p.district
      return {
        id: `osm:${p.osm_type}${p.osm_id}`, name: p.name || city || q,
        label: [p.name, p.street, city, p.state].filter((x, i, a) => x && a.indexOf(x) === i).join(', '),
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: p.osm_value, state: p.state, city, source: 'OpenStreetMap (Photon)',
      }
    })
}

type OlaPrediction = { place_id: string; description: string; structured_formatting?: { main_text: string }; geometry?: { location: { lat: number; lng: number } }; types?: string[] }

async function ola(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const key = env('OLA_MAPS_API_KEY')!
  const u = new URL('https://api.olamaps.io/places/v1/autocomplete')
  u.searchParams.set('input', q)
  u.searchParams.set('api_key', key)
  if (near) u.searchParams.set('location', `${near.lat},${near.lon}`)
  const j = await fetchJson<{ predictions: OlaPrediction[] }>(u.toString(), { headers: { 'X-Request-Id': crypto.randomUUID() } })
  return (j.predictions ?? []).filter((p) => p.geometry).map((p) => ({
    id: `ola:${p.place_id}`, name: p.structured_formatting?.main_text ?? p.description.split(',')[0], label: p.description,
    lat: p.geometry!.location.lat, lon: p.geometry!.location.lng, kind: p.types?.[0], source: 'Ola Maps',
  }))
}

type GeoapifyResult = { features: { properties: { name?: string; formatted: string; lat: number; lon: number; state?: string; city?: string; result_type?: string; place_id: string } }[] }

async function geoapify(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const bias = near ? `&bias=proximity:${near.lon},${near.lat}` : ''
  const j = await fetchJson<GeoapifyResult>(`https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(q)}&filter=countrycode:in${bias}&limit=8&apiKey=${env('GEOAPIFY_API_KEY')}`)
  return j.features.map(({ properties: p }) => ({
    id: `geo:${p.place_id}`, name: p.name ?? p.formatted.split(',')[0], label: p.formatted, lat: p.lat, lon: p.lon,
    kind: p.result_type, state: p.state, city: p.city, source: 'Geoapify (OpenStreetMap)',
  }))
}

export function geocode(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const term = q.trim().slice(0, 120)
  if (!term) return Promise.resolve([])
  const key = `geo:${term.toLowerCase()}:${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`
  return cached(key, 30 * DAY, async () => {
    if (env('OLA_MAPS_API_KEY')) {
      try { const r = await ola(term, near); if (r.length) return r } catch { /* fall back to OSM */ }
    }
    try {
      const r = await photon(term, near)
      if (r.length || !env('GEOAPIFY_API_KEY')) return r
    } catch (e) {
      if (!env('GEOAPIFY_API_KEY')) throw e // the public Photon server throttles at times
    }
    return geoapify(term, near)
  }, true)
}

export function reverse(lat: number, lon: number): Promise<Place | null> {
  return cached(`rev:${lat.toFixed(4)},${lon.toFixed(4)}`, 30 * DAY, async () => {
    const j = await fetchJson<{ features: PhotonFeature[] }>(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`)
    const f = j.features[0]
    if (!f) return null
    const p = f.properties
    return { id: `osm:${p.osm_type}${p.osm_id}`, name: p.name || p.city || 'Pinned location', label: [p.name, p.city, p.state].filter(Boolean).join(', '), lat, lon, state: p.state, city: p.city, source: 'OpenStreetMap (Photon)' }
  }, true)
}
