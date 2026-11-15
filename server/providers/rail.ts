/**
 * Trains between stations (Indian Railways) via indianrailapi.com when RAIL_API_KEY is set.
 * No free official API exists; without a key the planner shows a train link-out with a
 * road-distance-based estimate, clearly labelled.
 */
import { cached, env, fetchJson, HOUR } from '../lib'

export type Train = { number: string; name: string; depart: string; arrive: string; minutes: number; days: string; from: string; to: string }

export function trainsBetween(fromCode: string, toCode: string): Promise<Train[]> {
  const key = env('RAIL_API_KEY')
  if (!key) return Promise.resolve([])
  return cached(`rail:${fromCode}>${toCode}`, 12 * HOUR, async () => {
    const j = await fetchJson<{ Trains?: { TrainNo: string; TrainName: string; DepartureTime: string; ArrivalTime: string; TravelTime: string; Source: string; Destination: string; RunningDays?: string }[] }>(
      `https://indianrailapi.com/api/v2/TrainBetweenStation/apikey/${key}/From/${fromCode}/To/${toCode}`)
    return (j.Trains ?? []).map((t) => {
      const [h, m] = t.TravelTime.split(':').map(Number)
      return { number: t.TrainNo, name: t.TrainName, depart: t.DepartureTime, arrive: t.ArrivalTime, minutes: h * 60 + (m || 0), days: t.RunningDays ?? 'Daily', from: fromCode, to: toCode }
    })
  })
}

/** Station code from a station name via the same API (e.g. "Secunderabad Junction" → "SC"). */
function stationCode(name: string): Promise<string | null> {
  const key = env('RAIL_API_KEY')
  if (!key) return Promise.resolve(null)
  const q = name.replace(/\b(railway station|station|junction|jn)\b/gi, '').trim()
  return cached(`stcode:${q}`, 30 * 24 * HOUR, async () => {
    const j = await fetchJson<{ Station?: { StationCode: string; StationName: string }[] }>(`https://indianrailapi.com/api/v2/AutoCompleteStation/apikey/${key}/StationCodeOrName/${encodeURIComponent(q)}`)
    return j.Station?.[0]?.StationCode ?? null
  })
}

export async function trainsBetweenNames(a: string, b: string): Promise<Train[]> {
  if (!env('RAIL_API_KEY')) return []
  const [ca, cb] = await Promise.all([stationCode(a), stationCode(b)])
  return ca && cb ? trainsBetween(ca, cb) : []
}
