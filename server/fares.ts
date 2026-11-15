/**
 * Fare estimates for road modes from published meter tariffs (state/city notifications)
 * and typical app pricing. No ride-hailing company offers a public price API, so these
 * are labelled "Estimate" in the UI and every leg links out to the operator's own app.
 */
export type RoadMode = 'auto' | 'shareauto' | 'erick' | 'bike' | 'cab' | 'suv' | 'cycle'

type Tariff = { base: number; baseKm: number; perKm: number; perMin?: number; seats: number; wait: number; speed: number; peakShare: number; maxKm: number }

/** National defaults (₹). Cab ≈ app "Mini", SUV ≈ 6-seater; shared auto/e-rickshaw are per seat. */
const DEFAULT: Record<RoadMode, Tariff> = {
  auto: { base: 30, baseKm: 1.5, perKm: 16, seats: 3, wait: 5, speed: 1.1, peakShare: 1, maxKm: 25 },
  shareauto: { base: 15, baseKm: 3, perKm: 4, seats: 1, wait: 8, speed: 1.2, peakShare: 1, maxKm: 12 },
  erick: { base: 10, baseKm: 2, perKm: 5, seats: 1, wait: 5, speed: 1.6, peakShare: 0.8, maxKm: 6 },
  bike: { base: 20, baseKm: 1, perKm: 8, seats: 1, wait: 4, speed: 0.9, peakShare: 0.7, maxKm: 20 },
  cab: { base: 60, baseKm: 0, perKm: 14, perMin: 1.5, seats: 4, wait: 7, speed: 1.0, peakShare: 1, maxKm: 600 },
  suv: { base: 90, baseKm: 0, perKm: 19, perMin: 2, seats: 6, wait: 9, speed: 1.0, peakShare: 1, maxKm: 600 },
  cycle: { base: 0, baseKm: 0, perKm: 0, seats: 1, wait: 0, speed: 3.2, peakShare: 0.1, maxKm: 15 },
}

/** City overrides for auto meters (government-notified, approx. 2025 values). */
const CITY_AUTO: Record<string, Partial<Tariff>> = {
  mumbai: { base: 26, baseKm: 1.5, perKm: 17.1 },
  delhi: { base: 30, baseKm: 1.5, perKm: 11 },
  bengaluru: { base: 30, baseKm: 2, perKm: 15 },
  bangalore: { base: 30, baseKm: 2, perKm: 15 },
  hyderabad: { base: 25, baseKm: 1.6, perKm: 14 },
  chennai: { base: 50, baseKm: 1.8, perKm: 18 },
  kolkata: { base: 30, baseKm: 2, perKm: 15 },
  pune: { base: 26, baseKm: 1.5, perKm: 17 },
}

export function tariffs(city?: string): Record<RoadMode, Tariff> {
  const c = (city ?? '').toLowerCase()
  const key = Object.keys(CITY_AUTO).find((k) => c.includes(k))
  return { ...DEFAULT, auto: { ...DEFAULT.auto, ...(key ? CITY_AUTO[key] : {}) } }
}

/** Fare for a whole ride (one vehicle), ₹. Night (23:00–05:00) +25 % for autos. */
export function rideFare(mode: RoadMode, km: number, min: number, t: Tariff, departMin: number): number {
  const night = departMin % 1440 >= 23 * 60 || departMin % 1440 < 5 * 60
  const f = t.base + Math.max(0, km - t.baseKm) * t.perKm + (t.perMin ?? 0) * min
  return Math.round(f * (night && mode === 'auto' ? 1.25 : 1))
}

// ---------------------------------------------------------------- booking links

export type Link = { label: string; url: string }

/** Retail fuel prices in India (₹ per litre / kg / kWh-equivalent per km for EVs), Nov 2026 averages. */
export const FUEL_PRICE = { petrol: 103, diesel: 90, cng: 88, ev: 9 } as const
/** Running cost of your own vehicle per km: fuel only (tolls and parking are added separately). */
export const ownPerKm = (kmpl: number, fuel: keyof typeof FUEL_PRICE) => (fuel === 'ev' ? 1.4 : FUEL_PRICE[fuel] / Math.max(5, kmpl))
type P = { lat: number; lon: number; name?: string }

export function rideLinks(mode: string, a: P, b: P): Link[] {
  const ll = (p: P) => `${p.lat},${p.lon}`
  const uber = `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${a.lat}&pickup[longitude]=${a.lon}&dropoff[latitude]=${b.lat}&dropoff[longitude]=${b.lon}`
  const ola = `https://book.olacabs.com/?pickup_lat=${a.lat}&pickup_lng=${a.lon}&drop_lat=${b.lat}&drop_lng=${b.lon}`
  const out: Link[] = []
  if (mode === 'cab' || mode === 'suv') out.push({ label: 'Uber', url: uber }, { label: 'Ola', url: ola }, { label: 'Rapido', url: 'https://www.rapido.bike/' }, { label: 'Namma Yatri', url: 'https://nammayatri.in/' })
  if (mode === 'auto') out.push({ label: 'Namma Yatri', url: 'https://nammayatri.in/' }, { label: 'Rapido', url: 'https://www.rapido.bike/' }, { label: 'Ola', url: ola }, { label: 'Uber', url: uber })
  if (mode === 'bike') out.push({ label: 'Rapido', url: 'https://www.rapido.bike/' }, { label: 'Uber Moto', url: uber }, { label: 'Ola Bike', url: ola })
  out.push({ label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&origin=${ll(a)}&destination=${ll(b)}&travelmode=${mode === 'walk' ? 'walking' : mode === 'cycle' ? 'bicycling' : ['bike', 'ownscooter'].includes(mode) ? 'two-wheeler' : ['metro', 'citybus', 'rail', 'train', 'ibus', 'ferry'].includes(mode) ? 'transit' : 'driving'}` })
  return out
}

const RTC: [RegExp, Link][] = [
  [/telangana/i, { label: 'TGSRTC', url: 'https://www.tgsrtcbus.in/' }],
  [/andhra/i, { label: 'APSRTC', url: 'https://www.apsrtconline.in/' }],
  [/karnataka/i, { label: 'KSRTC', url: 'https://ksrtc.in/' }],
  [/kerala/i, { label: 'KSRTC Kerala', url: 'https://onlineksrtcswift.com/' }],
  [/maharashtra/i, { label: 'MSRTC', url: 'https://npublic.msrtcors.com/' }],
  [/tamil/i, { label: 'TNSTC', url: 'https://www.tnstc.in/' }],
  [/gujarat/i, { label: 'GSRTC', url: 'https://gsrtc.in/' }],
  [/rajasthan/i, { label: 'RSRTC', url: 'https://rsrtconline.rajasthan.gov.in/' }],
  [/uttar pradesh/i, { label: 'UPSRTC', url: 'https://www.upsrtconline.co.in/' }],
]

export function busLinks(a: P & { state?: string }, b: P & { name?: string }): Link[] {
  const slug = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
  const links: Link[] = [
    { label: 'redBus', url: a.name && b.name ? `https://www.redbus.in/bus-tickets/${slug(a.name)}-to-${slug(b.name)}` : 'https://www.redbus.in/' },
    { label: 'AbhiBus', url: 'https://www.abhibus.com/' },
  ]
  const rtc = RTC.find(([re]) => re.test(a.state ?? ''))
  if (rtc) links.unshift(rtc[1])
  return links
}

export const trainLinks = (): Link[] => [
  { label: 'IRCTC', url: 'https://www.irctc.co.in/nget/train-search' },
  { label: 'NTES live status', url: 'https://enquiry.indianrail.gov.in/mntes/' },
]
