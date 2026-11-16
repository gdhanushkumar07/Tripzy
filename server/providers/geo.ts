/** Geocoding worldwide (biased to where the user is): Ola Maps for India when its key works, else Photon (OSM), else Geoapify. */
import { cached, DAY, env, fetchJson, providerFailed, providerUp } from '../lib'

export type Place = { id: string; name: string; label: string; lat: number; lon: number; kind?: string; state?: string; city?: string; country?: string; source: string }

const inIndia = (p?: { lat: number; lon: number }) => !!p && p.lat > 6 && p.lat < 37.5 && p.lon > 68 && p.lon < 97.5

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }

async function photon(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const u = new URL('https://photon.komoot.io/api/')
  u.searchParams.set('q', q)
  u.searchParams.set('limit', '8')
  if (near) { u.searchParams.set('lat', String(near.lat)); u.searchParams.set('lon', String(near.lon)) }
  const j = await fetchJson<{ features: PhotonFeature[] }>(u.toString())
  return j.features
    .map((f) => {
      const p = f.properties
      const city = p.city || p.county || p.district
      return {
        id: `osm:${p.osm_type}${p.osm_id}`, name: p.name || city || q,
        label: [p.name, p.street, city, p.state, p.countrycode?.toUpperCase() === 'IN' ? undefined : p.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', '),
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: p.osm_value, state: p.state, city, country: p.country, source: 'OpenStreetMap (Photon)',
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

type GeoapifyResult = { features: { properties: { name?: string; formatted: string; lat: number; lon: number; state?: string; city?: string; country?: string; result_type?: string; place_id: string } }[] }

async function geoapify(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const bias = near ? `&bias=proximity:${near.lon},${near.lat}` : ''
  const j = await fetchJson<GeoapifyResult>(`https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(q)}${bias}&limit=8&apiKey=${env('GEOAPIFY_API_KEY')}`)
  return j.features.map(({ properties: p }) => ({
    id: `geo:${p.place_id}`, name: p.name ?? p.formatted.split(',')[0], label: p.formatted, lat: p.lat, lon: p.lon,
    kind: p.result_type, state: p.state, city: p.city, country: p.country, source: 'Geoapify (OpenStreetMap)',
  }))
}

const MAPS_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+)$/i
const coordsIn = (u: string): { lat: number; lon: number } | null => {
  const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? u.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i)
  if (!m) return null
  const lat = Number(m[1]), lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}
const nameIn = (u: string) => {
  const m = u.match(/\/place\/([^/@?]+)/) ?? u.match(/[?&](?:q|query)=([^&]+)/)
  const n = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''
  return n && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(n) ? n.slice(0, 100) : ''
}

/**
 * A Google Maps link pasted as a place (a hotel the traveller booked): coordinates and name are read
 * from the link itself; short links (maps.app.goo.gl) are expanded by reading their redirect only.
 */
export async function fromMapsLink(raw: string): Promise<Place[] | null> {
  let url: URL
  try { url = new URL(raw.trim()) } catch { return null }
  if (!/^https?:$/.test(url.protocol) || !MAPS_HOSTS.test(url.hostname)) return null
  let full = url.toString()
  if (/goo\.gl|g\.co/i.test(url.hostname)) {
    const res = await fetch(full, { redirect: 'manual', signal: AbortSignal.timeout(8000) }).catch(() => null)
    const loc = res?.headers.get('location')
    if (!loc) return []
    full = loc
  }
  const at = coordsIn(full), name = nameIn(full)
  if (at) return [{ id: `gmaps:${at.lat.toFixed(5)},${at.lon.toFixed(5)}`, name: name.split(',')[0] || 'Pinned place', label: name || `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}`, lat: at.lat, lon: at.lon, source: 'Google Maps link' }]
  return name ? geocode(name) : []
}

export async function geocode(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  if (/^https?:\/\//i.test(q.trim())) return (await fromMapsLink(q)) ?? []
  return geocodeText(q, near)
}

function geocodeText(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const term = q.trim().slice(0, 120)
  if (!term) return Promise.resolve([])
  const key = `geo2:${term.toLowerCase()}:${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`
  return cached(key, 30 * DAY, async () => {
    if (env('OLA_MAPS_API_KEY') && providerUp('ola') && (!near || inIndia(near))) {
      try { const r = await ola(term, near); if (r.length) return r } catch (e) { providerFailed('ola', e) /* fall back to OSM */ }
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
    return { id: `osm:${p.osm_type}${p.osm_id}`, name: p.name || p.city || 'Pinned location', label: [p.name, p.city, p.state].filter(Boolean).join(', '), lat, lon, state: p.state, city: p.city, country: p.country, source: 'OpenStreetMap (Photon)' }
  }, true)
}
