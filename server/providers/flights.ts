/**
 * Flights between two airports on a date.
 *  1. SerpApi Google Flights (SERPAPI_KEY, 250 free searches/month): live prices and schedules
 *  2. Travelpayouts / Aviasales data API (TRAVELPAYOUTS_TOKEN): real recently-seen fares
 *  3. otherwise a labelled estimate from distance (block time and typical economy fare)
 * Every option carries prefilled booking links (date, passengers) that open the airline/OTA search.
 */
import type { Link } from '../fares'
import { cached, env, fetchJson, haversineKm, HOUR } from '../lib'
import type { Airport } from './airports'

export type Pax = { adults: number; children: number }
export type Flight = {
  from: string; to: string; airline: string; number?: string; depart?: string; arrive?: string; minutes: number; stops: number
  pricePerPerson: number; currency: 'INR'; source: string; estimate: boolean; links: Link[]
}

export function flightLinks(a: string, b: string, date: string, pax: Pax, domesticIndia: boolean): Link[] {
  const [y, m, d] = date.split('-')
  const total = pax.adults + pax.children
  const links: Link[] = [
    { label: 'Google Flights', url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${a} to ${b} on ${date} one way ${total} passengers`)}&curr=INR` },
    { label: 'Skyscanner', url: `https://www.skyscanner.co.in/transport/flights/${a.toLowerCase()}/${b.toLowerCase()}/${y.slice(2)}${m}${d}/?adultsv2=${pax.adults}${pax.children ? `&childrenv2=${Array(pax.children).fill(8).join('|')}` : ''}&cabinclass=economy` },
  ]
  if (domesticIndia) links.unshift({ label: 'MakeMyTrip', url: `https://www.makemytrip.com/flight/search?itinerary=${a}-${b}-${d}/${m}/${y}&tripType=O&paxType=A-${pax.adults}_C-${pax.children}_I-0&intl=false&cabinClass=E` })
  return links
}

function estimate(a: Airport, b: Airport, date: string, pax: Pax): Flight[] {
  const km = haversineKm(a, b)
  const domestic = a.country === b.country
  const nonstop = km < 2800 || (a.large && b.large)
  const minutes = Math.round(35 + (km / 760) * 60 + (nonstop ? 0 : 150))
  const perKm = a.country === 'IN' && domestic ? 3.1 : 5.2
  const fare = Math.round(((domestic ? 1900 : 4200) + perKm * km) / 50) * 50
  return [{
    from: a.iata, to: b.iata, airline: nonstop ? 'Nonstop flights (typical)' : 'One-stop flights (typical)', minutes, stops: nonstop ? 0 : 1, pricePerPerson: fare, currency: 'INR',
    source: 'Estimate from distance — add SERPAPI_KEY for live Google Flights prices', estimate: true, links: flightLinks(a.iata, b.iata, date, pax, a.country === 'IN' && domestic),
  }]
}

type SerpFlight = { flights: { departure_airport: { id: string; time: string }; arrival_airport: { id: string; time: string }; airline: string; flight_number?: string }[]; total_duration: number; price?: number }

async function serp(a: Airport, b: Airport, date: string, pax: Pax, key: string): Promise<Flight[]> {
  const u = `https://serpapi.com/search.json?engine=google_flights&departure_id=${a.iata}&arrival_id=${b.iata}&outbound_date=${date}&type=2&currency=INR&hl=en&gl=in&adults=${pax.adults}&children=${pax.children}&api_key=${key}`
  const j = await fetchJson<{ best_flights?: SerpFlight[]; other_flights?: SerpFlight[] }>(u, { timeoutMs: 20000 })
  const total = pax.adults + pax.children
  return [...(j.best_flights ?? []), ...(j.other_flights ?? [])].filter((f) => f.price).slice(0, 8).map((f) => {
    const first = f.flights[0], last = f.flights[f.flights.length - 1]
    return {
      from: a.iata, to: b.iata, airline: [...new Set(f.flights.map((x) => x.airline))].join(' + '), number: f.flights.map((x) => x.flight_number).filter(Boolean).join(', '),
      depart: first.departure_airport.time.replace(' ', 'T'), arrive: last.arrival_airport.time.replace(' ', 'T'), minutes: f.total_duration, stops: f.flights.length - 1,
      pricePerPerson: Math.round(f.price! / total), currency: 'INR' as const, source: 'Google Flights via SerpApi (live)', estimate: false,
      links: flightLinks(a.iata, b.iata, date, pax, a.country === 'IN' && b.country === 'IN'),
    }
  })
}

type TpFlight = { price: number; airline: string; flight_number: string | number; departure_at: string; duration?: number; duration_to?: number; transfers: number; link?: string }

async function travelpayouts(a: Airport, b: Airport, date: string, pax: Pax, token: string): Promise<Flight[]> {
  const u = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${a.iata}&destination=${b.iata}&departure_at=${date}&currency=inr&sorting=price&direct=false&limit=10&token=${token}`
  const j = await fetchJson<{ data?: TpFlight[] }>(u)
  const marker = env('TRAVELPAYOUTS_MARKER')
  return (j.data ?? []).slice(0, 6).map((f) => {
    const minutes = f.duration_to ?? f.duration ?? estimate(a, b, date, pax)[0].minutes
    const links = flightLinks(a.iata, b.iata, date, pax, a.country === 'IN' && b.country === 'IN')
    if (f.link) links.unshift({ label: 'Aviasales', url: `https://www.aviasales.com${f.link}${marker ? `&marker=${marker}` : ''}` })
    return {
      from: a.iata, to: b.iata, airline: String(f.airline), number: `${f.airline} ${f.flight_number}`, depart: f.departure_at,
      arrive: new Date(new Date(f.departure_at).getTime() + minutes * 60000).toISOString(), minutes, stops: f.transfers,
      pricePerPerson: f.price, currency: 'INR' as const, source: 'Aviasales fares seen in the last 48 h (Travelpayouts)', estimate: false, links,
    }
  })
}

export function flightsBetween(a: Airport, b: Airport, date: string, pax: Pax): Promise<Flight[]> {
  return cached(`fl1:${a.iata}-${b.iata}-${date}-${pax.adults}-${pax.children}`, 3 * HOUR, async () => {
    const sk = env('SERPAPI_KEY'), tp = env('TRAVELPAYOUTS_TOKEN')
    if (sk) { try { const r = await serp(a, b, date, pax, sk); if (r.length) return r } catch { /* next source */ } }
    if (tp) { try { const r = await travelpayouts(a, b, date, pax, tp); if (r.length) return r } catch { /* next source */ } }
    return estimate(a, b, date, pax)
  }, true)
}
