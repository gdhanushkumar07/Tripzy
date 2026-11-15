/**
 * Transitous (https://transitous.org): free, community-run public-transport router built on
 * MOTIS over 2,000+ open GTFS feeds worldwide (metros, buses, regional & long-distance rail,
 * ferries, FlixBus…). Real schedules, with realtime delays wherever the operator publishes them.
 */
import { cached, fetchJson, MIN, type LatLon } from '../lib'

type TPlace = { name: string; lat: number; lon: number; departure?: string; arrival?: string; departureTimestampReason?: string; arrivalTimestampReason?: string }
type TLeg = {
  mode: string; from: TPlace; to: TPlace; duration: number; startTime: string; endTime: string; realTime: boolean; scheduled?: boolean
  distance?: number; headsign?: string; agencyName?: string; agencyUrl?: string; routeShortName?: string; routeLongName?: string; displayName?: string
  legGeometry?: { points: string; precision: number }
}
type TItin = { duration: number; startTime: string; endTime: string; transfers: number; legs: TLeg[] }

export type TransitLeg = {
  mode: string; name: string; from: string; to: string; fromLL: [number, number]; toLL: [number, number]
  depart: string; arrive: string; minutes: number; km: number; realtime: boolean; agency?: string; agencyUrl?: string; geometry?: [number, number][]
}
export type TransitItinerary = { minutes: number; depart: string; arrive: string; transfers: number; legs: TransitLeg[]; walkKm: number }

export function decodePolyline(s: string, precision = 6): [number, number][] {
  const f = 10 ** precision, out: [number, number][] = []
  let i = 0, lat = 0, lon = 0
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, res = 0, b: number
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
      const d = res & 1 ? ~(res >> 1) : res >> 1
      if (which === 0) lat += d; else lon += d
    }
    out.push([lat / f, lon / f])
  }
  return out
}

/** Public-transport itineraries between two points at a time (ISO). Returns [] where there is no coverage. */
export function transitPlan(a: LatLon, b: LatLon, timeIso: string, n = 5): Promise<TransitItinerary[]> {
  const key = `tr1:${a.lat.toFixed(3)},${a.lon.toFixed(3)}>${b.lat.toFixed(3)},${b.lon.toFixed(3)}@${timeIso.slice(0, 15)}`
  return cached(key, 10 * MIN, async () => {
    const u = `https://api.transitous.org/api/v5/plan?fromPlace=${a.lat},${a.lon}&toPlace=${b.lat},${b.lon}&time=${encodeURIComponent(timeIso)}&numItineraries=${n}`
    const j = await fetchJson<{ itineraries?: TItin[] }>(u, { timeoutMs: 15000 })
    return (j.itineraries ?? []).map((it) => {
      const legs = it.legs.map((l): TransitLeg => ({
        mode: l.mode, name: l.displayName || l.routeShortName || l.routeLongName || (l.mode === 'WALK' ? 'Walk' : l.mode),
        from: l.from.name, to: l.to.name, fromLL: [l.from.lat, l.from.lon], toLL: [l.to.lat, l.to.lon],
        depart: l.startTime, arrive: l.endTime, minutes: Math.round(l.duration / 60),
        km: +((l.distance ?? 0) / 1000).toFixed(1), realtime: l.realTime, agency: l.agencyName, agencyUrl: l.agencyUrl,
        geometry: l.legGeometry ? decodePolyline(l.legGeometry.points, l.legGeometry.precision) : undefined,
      }))
      return { minutes: Math.round(it.duration / 60), depart: it.startTime, arrive: it.endTime, transfers: it.transfers, legs, walkKm: +legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.km, 0).toFixed(1) }
    })
  })
}
