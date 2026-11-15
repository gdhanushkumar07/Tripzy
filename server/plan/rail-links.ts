/**
 * Prefilled train searches. IRCTC does not accept search parameters from other sites, so the
 * links open the authorised partners' search already filled with stations, date and class
 * (ixigo, ConfirmTkt — both book IRCTC e-tickets), plus IRCTC itself and NTES live status.
 */
import type { Link } from '../fares'
import { cityOf } from '../providers/hubs'

/** Main long-distance station of each major city (Indian Railways codes). */
const CODES: Record<string, string> = {
  Hyderabad: 'SC', Warangal: 'WL', Bengaluru: 'SBC', Mysuru: 'MYS', Mangaluru: 'MAQ', Hampi: 'HPT', Chennai: 'MAS', Coimbatore: 'CBE', Madurai: 'MDU',
  Mumbai: 'CSMT', Pune: 'PUNE', Nagpur: 'NGP', Nashik: 'NK', Delhi: 'NDLS', Gurugram: 'GGN', Noida: 'NDLS', Kolkata: 'HWH', Ahmedabad: 'ADI', Surat: 'ST',
  Vadodara: 'BRC', Jaipur: 'JP', Udaipur: 'UDZ', Jodhpur: 'JU', Lucknow: 'LKO', Agra: 'AGC', Varanasi: 'BSB', Kanpur: 'CNB', Indore: 'INDB', Bhopal: 'BPL',
  Patna: 'PNBE', Visakhapatnam: 'VSKP', Vijayawada: 'BZA', Tirupati: 'TPTY', Kochi: 'ERS', Thiruvananthapuram: 'TVC', Panaji: 'MAO', Chandigarh: 'CDG',
  Amritsar: 'ASR', Dehradun: 'DDN', Rishikesh: 'YNRK', Shimla: 'SML', Srinagar: 'SINA', Guwahati: 'GHY', Bhubaneswar: 'BBS', Puri: 'PURI', Raipur: 'R', Ranchi: 'RNC',
}
const NAME_CODES: [RegExp, string][] = [
  [/secunderabad/i, 'SC'], [/kacheguda/i, 'KCG'], [/nampally|hyderabad deccan/i, 'HYB'], [/lingampalli/i, 'LPI'], [/kazipet/i, 'KZJ'], [/new delhi/i, 'NDLS'],
  [/hazrat nizamuddin/i, 'NZM'], [/anand vihar/i, 'ANVT'], [/old delhi|delhi junction/i, 'DLI'], [/mumbai central/i, 'MMCT'], [/bandra/i, 'BDTS'], [/lokmanya tilak|ltt/i, 'LTT'],
  [/dadar/i, 'DR'], [/chhatrapati shivaji|cstm|csmt/i, 'CSMT'], [/yesvantpur|yeshwantpur/i, 'YPR'], [/krantivira|bengaluru city|bangalore city/i, 'SBC'], [/howrah/i, 'HWH'],
  [/sealdah/i, 'SDAH'], [/chennai central|puratchi/i, 'MAS'], [/chennai egmore/i, 'MS'], [/ernakulam/i, 'ERS'],
]

export function stationCode(name: string, p?: { lat: number; lon: number }): string | undefined {
  const byName = NAME_CODES.find(([re]) => re.test(name))?.[1]
  if (byName) return byName
  const c = p ? cityOf(p) : null
  return c ? CODES[c.name] : undefined
}

export function trainBookingLinks(fromName: string, toName: string, q: { date: string; party: { adults: number; children: number; seniors: number } }, fromLL?: [number, number], toLL?: [number, number]): Link[] {
  const a = stationCode(fromName, fromLL && { lat: fromLL[0], lon: fromLL[1] })
  const b = stationCode(toName, toLL && { lat: toLL[0], lon: toLL[1] })
  const [y, m, d] = q.date.split('-')
  const links: Link[] = []
  if (a && b) {
    const adults = q.party.adults + q.party.seniors
    links.push(
      { label: 'ixigo trains', url: `https://www.ixigo.com/search/result/train/${a}/${b}/${d}${m}${y}//1/0/0/0/ALL?adults=${adults}&children=${q.party.children}` },
      { label: 'ConfirmTkt', url: `https://www.confirmtkt.com/rbooking-d/trains/from/${a}/to/${b}/${d}-${m}-${y}` },
    )
  }
  links.push({ label: 'IRCTC', url: 'https://www.irctc.co.in/nget/train-search' }, { label: 'NTES live status', url: 'https://enquiry.indianrail.gov.in/mntes/' })
  return links
}
