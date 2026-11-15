/** Public GTFS feeds for Indian cities (mirrored by MobilityData, mobilitydatabase.org). */
export type FeedDef = {
  id: string; name: string; city: string; mode: 'metro' | 'citybus' | 'rail'
  url: string; attribution: string
  /** Distance slab fares (₹) when the feed publishes none: [maxKm, fare][] */
  fareSlab?: [number, number][]
  routeName?: (route: Record<string, string>, trip: Record<string, string>) => string
}

/** TGSRTC city ordinary fare stages (approx. 2025 chart, ₹). Labelled as an estimate in the UI. */
const CITY_BUS: [number, number][] = [[2, 10], [4, 15], [8, 20], [12, 25], [16, 30], [22, 35], [30, 40], [999, 50]]

export const FEEDS: FeedDef[] = [
  { id: 'hmrl', name: 'Hyderabad Metro Rail', city: 'Hyderabad', mode: 'metro', attribution: 'Hyderabad Metro Rail Ltd. GTFS',
    url: 'https://files.mobilitydatabase.org/mdb-2457/mdb-2457-202504152038/mdb-2457-202504152038.zip',
    routeName: (r) => ({ RED: 'Metro Red Line', GREEN: 'Metro Green Line', BLUE: 'Metro Blue Line' } as Record<string, string>)[r.route_id] ?? `Metro ${r.route_short_name}` },
  { id: 'tgsrtc', name: 'TGSRTC Hyderabad city buses', city: 'Hyderabad', mode: 'citybus', attribution: 'TGSRTC GTFS via Telangana Open Data / OpenCity',
    url: 'https://files.mobilitydatabase.org/mdb-3361/mdb-3361-202607201528/mdb-3361-202607201528.zip', fareSlab: CITY_BUS,
    routeName: (_r, t) => `City bus ${(t.trip_short_name || '').split('-')[0] || t.route_id}` },
  { id: 'bmtc', name: 'BMTC Bengaluru buses', city: 'Bengaluru', mode: 'citybus', attribution: 'BMTC GTFS (community, Vonter/bmtc-gtfs)',
    url: 'https://files.mobilitydatabase.org/mdb-2595/mdb-2595-202611100148/mdb-2595-202611100148.zip', fareSlab: CITY_BUS },
  { id: 'chennai', name: 'Chennai MTC + metro', city: 'Chennai', mode: 'citybus', attribution: 'Chennai unified GTFS (ungalsoththu/ChennaiGTFS)',
    url: 'https://files.mobilitydatabase.org/mdb-3360/mdb-3360-202610050048/mdb-3360-202610050048.zip', fareSlab: CITY_BUS },
  { id: 'best', name: 'Mumbai BEST buses', city: 'Mumbai', mode: 'citybus', attribution: 'Mumbai bus GTFS (croyla/mumbai-gtfs)',
    url: 'https://files.mobilitydatabase.org/mdb-3138/mdb-3138-202608200020/mdb-3138-202608200020.zip', fareSlab: [[2, 5], [5, 10], [10, 15], [15, 20], [999, 25]] },
  { id: 'pmpml', name: 'PMPML Pune buses', city: 'Pune', mode: 'citybus', attribution: 'PMPML GTFS (croyla/pmpml-gtfs)',
    url: 'https://files.mobilitydatabase.org/mdb-3137/mdb-3137-202610080025/mdb-3137-202610080025.zip', fareSlab: CITY_BUS },
  { id: 'amd', name: 'Ahmedabad Janmarg + AMTS', city: 'Ahmedabad', mode: 'citybus', attribution: 'Ahmedabad GTFS (croyla/amd-gtfs)',
    url: 'https://files.mobilitydatabase.org/mdb-3131/mdb-3131-202610010020/mdb-3131-202610010020.zip', fareSlab: CITY_BUS },
]
