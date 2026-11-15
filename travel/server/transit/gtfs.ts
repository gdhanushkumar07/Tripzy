/** Query the imported GTFS indexes: nearby stations, the patterns that serve them, departures. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { haversineKm, type LatLon } from '../lib'

export type Feed = {
  id: string; name: string; city: string; mode: 'metro' | 'citybus' | 'rail'; attribution: string; builtAt: string
  stations: [string, string, number, number, string][]
  patterns: { route: string; name: string; color?: string; stops: number[]; times: number[]; deps: Record<string, number[]> }[]
  fares?: Record<string, number>
  fareSlab?: [number, number][]
  // derived
  byStation?: Map<number, number[]>
  bbox?: [number, number, number, number]
}

const DIR = 'server/data/gtfs'
let feeds: Feed[] | null = null

export function loadFeeds(): Feed[] {
  if (feeds) return feeds
  feeds = []
  if (!existsSync(DIR)) return feeds
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const feed = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Feed
    feed.byStation = new Map()
    feed.patterns.forEach((p, pi) => p.stops.forEach((s) => { const l = feed.byStation!.get(s) ?? []; if (!l.includes(pi)) l.push(pi); feed.byStation!.set(s, l) }))
    const lats = feed.stations.map((s) => s[2]), lons = feed.stations.map((s) => s[3])
    feed.bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)]
    feeds.push(feed)
  }
  return feeds
}

export const feedsNear = (p: LatLon, padDeg = 0.15) =>
  loadFeeds().filter((f) => f.bbox && p.lat >= f.bbox[0] - padDeg && p.lat <= f.bbox[2] + padDeg && p.lon >= f.bbox[1] - padDeg && p.lon <= f.bbox[3] + padDeg)

export function nearestStations(feed: Feed, p: LatLon, maxKm: number, k: number) {
  return feed.stations
    .map((s, i) => ({ i, km: haversineKm(p, { lat: s[2], lon: s[3] }) }))
    .filter((x) => x.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, k)
}

export const dayType = (date: Date) => (date.getDay() === 0 ? 'su' : date.getDay() === 6 ? 'sa' : 'wk')

/** Fare between two stations: published zone fare, else distance slab. */
export function fareBetween(feed: Feed, a: number, b: number): number {
  const za = feed.stations[a][4] || feed.stations[a][0], zb = feed.stations[b][4] || feed.stations[b][0]
  const pub = feed.fares?.[`${za}|${zb}`] ?? feed.fares?.[`${zb}|${za}`]
  if (pub !== undefined) return pub
  const km = haversineKm({ lat: feed.stations[a][2], lon: feed.stations[a][3] }, { lat: feed.stations[b][2], lon: feed.stations[b][3] }) * 1.3
  return (feed.fareSlab ?? [[999, 20]]).find(([max]) => km <= max)?.[1] ?? 20
}
