/**
 * Places to stay near a point for given dates and guests.
 *  1. SerpApi Google Hotels (SERPAPI_KEY): live nightly prices across OTAs
 *  2. LiteAPI (LITEAPI_KEY): bookable rates; a sandbox key returns test prices, labelled so
 *  3. Geoapify (GEOAPIFY_API_KEY): hotels/guest houses from OpenStreetMap, no price
 * Each hotel carries prefilled booking searches (dates, guests) on Booking.com and Google Hotels.
 */
import type { Link } from '../fares'
import { cached, env, fetchJson, haversineKm, HOUR, type LatLon } from '../lib'

export type HotelQuery = LatLon & { city?: string; checkin: string; checkout: string; adults: number; children: number }
export type Hotel = {
  id: string; name: string; lat: number; lon: number; km: number; stars?: number; rating?: number; reviews?: number; photo?: string; address?: string
  pricePerNight?: number; total?: number; board?: string; refundable?: boolean; source: string; estimate: boolean; links: Link[]
}

const nights = (q: HotelQuery) => Math.max(1, Math.round((new Date(q.checkout).getTime() - new Date(q.checkin).getTime()) / 864e5))

export function hotelLinks(name: string, q: HotelQuery): Link[] {
  const ss = encodeURIComponent([name, q.city].filter(Boolean).join(', '))
  return [
    { label: 'Booking.com', url: `https://www.booking.com/searchresults.html?ss=${ss}&checkin=${q.checkin}&checkout=${q.checkout}&group_adults=${q.adults}&group_children=${q.children}&no_rooms=${Math.max(1, Math.ceil(q.adults / 2))}` },
    { label: 'Google Hotels', url: `https://www.google.com/travel/search?q=${ss}&checkin=${q.checkin}&checkout=${q.checkout}&adults=${q.adults}` },
  ]
}

type LiteRate = { name?: string; boardName?: string; retailRate: { total: { amount: number }[] }; cancellationPolicies?: { refundableTag?: string } }
type LiteHotel = { id: string; name: string; main_photo?: string; address?: string; latitude: number; longitude: number; rating?: number; stars?: number; review_count?: number }

async function lite(q: HotelQuery, key: string): Promise<Hotel[]> {
  const body = {
    latitude: q.lat, longitude: q.lon, radius: 6000, checkin: q.checkin, checkout: q.checkout, currency: 'INR', guestNationality: 'IN',
    occupancies: [{ adults: q.adults, ...(q.children ? { children: Array(q.children).fill(8) } : {}) }], limit: 20, includeHotelData: true, timeout: 8,
  }
  const j = await fetchJson<{ sandbox?: boolean; data?: { hotelId: string; roomTypes: { rates: LiteRate[] }[] }[]; hotels?: LiteHotel[] }>('https://api.liteapi.travel/v3.0/hotels/rates', {
    method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 15000,
  })
  const info = new Map((j.hotels ?? []).map((h) => [h.id, h]))
  const n = nights(q)
  return (j.data ?? []).flatMap((d) => {
    const h = info.get(d.hotelId)
    if (!h) return []
    const rates = d.roomTypes.flatMap((r) => r.rates).filter((r) => r.retailRate?.total?.[0])
    if (!rates.length) return []
    const best = rates.reduce((a, b) => (a.retailRate.total[0].amount <= b.retailRate.total[0].amount ? a : b))
    const total = Math.round(best.retailRate.total[0].amount)
    return [{
      id: `lite:${h.id}`, name: h.name, lat: h.latitude, lon: h.longitude, km: +haversineKm(q, { lat: h.latitude, lon: h.longitude }).toFixed(1),
      stars: h.stars, rating: h.rating, reviews: h.review_count, photo: h.main_photo, address: h.address,
      pricePerNight: Math.round(total / n), total, board: best.boardName, refundable: best.cancellationPolicies?.refundableTag === 'RFN',
      source: j.sandbox ? 'LiteAPI sandbox — test prices; switch to a live key for real rates' : 'LiteAPI (live rates)', estimate: !!j.sandbox, links: hotelLinks(h.name, q),
    }]
  })
}

type SerpHotel = { name: string; gps_coordinates?: { latitude: number; longitude: number }; rate_per_night?: { extracted_lowest?: number }; total_rate?: { extracted_lowest?: number }; overall_rating?: number; reviews?: number; hotel_class?: string; images?: { thumbnail: string }[]; link?: string }

async function serp(q: HotelQuery, key: string): Promise<Hotel[]> {
  const u = `https://serpapi.com/search.json?engine=google_hotels&q=${encodeURIComponent(`hotels in ${q.city ?? `${q.lat},${q.lon}`}`)}&check_in_date=${q.checkin}&check_out_date=${q.checkout}&adults=${q.adults}&children=${q.children}&currency=INR&gl=in&hl=en&api_key=${key}`
  const j = await fetchJson<{ properties?: SerpHotel[] }>(u, { timeoutMs: 20000 })
  return (j.properties ?? []).filter((p) => p.gps_coordinates).slice(0, 20).map((p, i) => {
    const ll = { lat: p.gps_coordinates!.latitude, lon: p.gps_coordinates!.longitude }
    const links = hotelLinks(p.name, q)
    if (p.link) links.unshift({ label: 'Hotel site', url: p.link })
    return {
      id: `serp:${i}:${p.name}`, name: p.name, ...ll, km: +haversineKm(q, ll).toFixed(1), stars: parseInt(p.hotel_class ?? '') || undefined, rating: p.overall_rating, reviews: p.reviews,
      photo: p.images?.[0]?.thumbnail, pricePerNight: p.rate_per_night?.extracted_lowest, total: p.total_rate?.extracted_lowest, source: 'Google Hotels via SerpApi (live)', estimate: false, links,
    }
  })
}

type GeoFeature = { properties: { name?: string; lat: number; lon: number; place_id: string; categories: string[]; address_line2?: string; datasource?: { raw?: Record<string, string> } } }

async function osm(q: HotelQuery, key: string): Promise<Hotel[]> {
  const j = await fetchJson<{ features: GeoFeature[] }>(`https://api.geoapify.com/v2/places?categories=accommodation.hotel,accommodation.guest_house,accommodation.hostel&filter=circle:${q.lon},${q.lat},6000&bias=proximity:${q.lon},${q.lat}&limit=30&apiKey=${key}`)
  return j.features.filter((f) => f.properties.name).map(({ properties: p }) => ({
    id: `geo:${p.place_id}`, name: p.name!, lat: p.lat, lon: p.lon, km: +haversineKm(q, p).toFixed(1), address: p.address_line2,
    stars: parseInt(p.datasource?.raw?.stars ?? '') || undefined, source: 'OpenStreetMap via Geoapify — open the booking link for prices', estimate: true, links: hotelLinks(p.name!, q),
  }))
}

export function hotelsNear(q: HotelQuery): Promise<{ hotels: Hotel[]; sources: string[] }> {
  return cached(`ht1:${q.lat.toFixed(3)},${q.lon.toFixed(3)}:${q.checkin}:${q.checkout}:${q.adults}:${q.children}`, 6 * HOUR, async () => {
    const tries: [string | undefined, (k: string) => Promise<Hotel[]>][] = [[env('SERPAPI_KEY'), (k) => serp(q, k)], [env('LITEAPI_KEY'), (k) => lite(q, k)], [env('GEOAPIFY_API_KEY'), (k) => osm(q, k)]]
    for (const [k, fn] of tries) {
      if (!k) continue
      try {
        const r = await fn(k)
        if (r.length) return { hotels: r.sort((a, b) => (a.pricePerNight ?? 1e9) - (b.pricePerNight ?? 1e9) || a.km - b.km).slice(0, 12), sources: [r[0].source] }
      } catch { /* next source */ }
    }
    return { hotels: [], sources: [] }
  }, true)
}
