/** Airports with scheduled passenger service worldwide (OurAirports, public domain). */
import { readFileSync } from 'node:fs'
import { haversineKm, type LatLon } from '../lib'

export type Airport = { iata: string; name: string; city: string; country: string; lat: number; lon: number; large: boolean }
type Row = [string, string, string, string, number, number, number]

let all: Airport[] | null = null
function load(): Airport[] {
  if (!all) {
    const rows = JSON.parse(readFileSync('server/data/airports.json', 'utf8')) as Row[]
    all = rows.map(([iata, name, city, country, lat, lon, size]) => ({ iata, name, city, country, lat, lon, large: size === 2 }))
  }
  return all
}

/** Up to k airports within maxKm, large ones preferred when nearly as close (more flights). */
export function nearestAirports(p: LatLon, k = 2, maxKm = 160): (Airport & { km: number })[] {
  return load()
    .map((a) => ({ ...a, km: haversineKm(p, a) }))
    .filter((a) => a.km <= maxKm)
    .sort((a, b) => (a.km - (a.large ? 25 : 0)) - (b.km - (b.large ? 25 : 0)))
    .slice(0, k)
}

export const airportByIata = (code: string) => load().find((a) => a.iata === code.toUpperCase())
