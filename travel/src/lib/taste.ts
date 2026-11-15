/** Pure personalisation algorithm (no Firebase): history events → interest boosts, modes, reasons. */
import type { Mode } from './types'

export type HistoryEvent =
  | { type: 'trip_created'; at: number; city: string; interests: string[]; days: number; budget?: number }
  | { type: 'stop_removed'; at: number; city?: string; name: string; tags: string[] }
  | { type: 'stop_swapped'; at: number; city?: string; from: string[]; to: string[]; toName: string }
  | { type: 'route_saved'; at: number; modes: Mode[]; from: string; to: string }
  | { type: 'commute_search'; at: number; modes: Mode[]; people: number }

export type TasteProfile = {
  boost: Record<string, number>; boostWhy: Record<string, string>
  modes: Mode[]; cities: string[]; summary: string[]; events: number
}

const DAY = 86_400_000
const decay = (at: number, now: number) => 0.5 ** ((now - at) / (60 * DAY))

export function profileFrom(events: HistoryEvent[], now = Date.now()): TasteProfile {
  const score: Record<string, number> = {}
  const kept: Record<string, number> = {}, dropped: Record<string, number> = {}
  const modeScore: Partial<Record<Mode, number>> = {}
  const cities: string[] = []
  for (const e of events) {
    const w = decay(e.at, now)
    if (e.type === 'trip_created') {
      if (e.city && !cities.includes(e.city)) cities.push(e.city)
      for (const t of e.interests) { score[t] = (score[t] ?? 0) + 0.04 * w; kept[t] = (kept[t] ?? 0) + 1 }
    } else if (e.type === 'stop_removed') {
      for (const t of e.tags) { score[t] = (score[t] ?? 0) - 0.08 * w; dropped[t] = (dropped[t] ?? 0) + 1 }
    } else if (e.type === 'stop_swapped') {
      for (const t of e.from) { score[t] = (score[t] ?? 0) - 0.05 * w; dropped[t] = (dropped[t] ?? 0) + 1 }
      for (const t of e.to) { score[t] = (score[t] ?? 0) + 0.08 * w; kept[t] = (kept[t] ?? 0) + 1 }
    } else if (e.type === 'route_saved' || e.type === 'commute_search') {
      for (const m of e.modes) modeScore[m] = (modeScore[m] ?? 0) + (e.type === 'route_saved' ? 2 : 1) * w
    }
  }
  const boost: Record<string, number> = {}, boostWhy: Record<string, string> = {}
  for (const [t, v] of Object.entries(score)) {
    const b = Math.max(-0.4, Math.min(0.4, v))
    if (Math.abs(b) < 0.03) continue
    boost[t] = +b.toFixed(3)
    boostWhy[t] = b > 0
      ? `Because you chose ${t} ${kept[t] ?? 1} time${(kept[t] ?? 1) > 1 ? 's' : ''} in past plans`
      : `Shown less: you removed ${t} stops ${dropped[t] ?? 1} time${(dropped[t] ?? 1) > 1 ? 's' : ''}`
  }
  const modes = (Object.entries(modeScore) as [Mode, number][]).sort((a, b) => b[1] - a[1]).map(([m]) => m)
  const top = Object.entries(boost).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t)
  const low = Object.entries(boost).filter(([, v]) => v < 0).map(([t]) => t)
  const summary = [
    top.length ? `You lean towards ${top.join(', ')}` : '',
    low.length ? `less ${low.slice(0, 2).join(' and ')}` : '',
    cities.length ? `Planned before: ${cities.slice(-4).join(', ')}` : '',
    modes.length ? `Usually travels by ${modes.slice(0, 3).join(', ')}` : '',
  ].filter(Boolean)
  return { boost, boostWhy, modes, cities, summary, events: events.length }
}
