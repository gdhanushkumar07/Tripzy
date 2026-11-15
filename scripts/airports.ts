/**
 * Builds server/data/airports.json from OurAirports (public domain): every large/medium
 * airport with scheduled passenger service and an IATA code, worldwide.
 *   npm run airports
 */
import { writeFileSync } from 'node:fs'

const res = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv')
if (!res.ok) throw new Error(`OurAirports download failed: ${res.status}`)
const text = await res.text()

function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const [head, ...rows] = text.split(/\r?\n/).filter(Boolean)
const h = parseLine(head)
const col = (n: string) => h.indexOf(n)
const [T, N, LA, LO, C, M, S, I] = ['type', 'name', 'latitude_deg', 'longitude_deg', 'iso_country', 'municipality', 'scheduled_service', 'iata_code'].map(col)
// [iata, name, city, country, lat, lon, size(2 large / 1 medium)]
const out: [string, string, string, string, number, number, number][] = []
for (const line of rows) {
  const r = parseLine(line)
  if (r[S] !== 'yes' || !/^[A-Z]{3}$/.test(r[I] ?? '') || !['large_airport', 'medium_airport'].includes(r[T])) continue
  out.push([r[I], r[N], r[M], r[C], +(+r[LA]).toFixed(4), +(+r[LO]).toFixed(4), r[T] === 'large_airport' ? 2 : 1])
}
writeFileSync('server/data/airports.json', JSON.stringify(out))
console.log(`airports.json: ${out.length} airports`)
