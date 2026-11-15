/**
 * Tourist places and restaurants anywhere in India, live and keyless:
 *  - attractions: Wikipedia geosearch (notable places with coordinates, a description and a photo)
 *  - restaurants and cafés: Photon (OpenStreetMap)
 *  - opening hours + diet tags: OpenStreetMap Overpass, best effort with a short timeout
 *  - popularity: OpenTripMap rating when OPENTRIPMAP_API_KEY is set
 */
import { cached, DAY, env, fetchJson, haversineKm } from '../lib'

export type LivePlace = {
  id: string; name: string; lat: number; lon: number; cat: string; tags: string[]
  hours?: string; dwell: number; intensity: number; cost: number; indoor: boolean
  diet?: 'veg' | 'nonveg' | 'both'; meal?: string[]; rating?: number; wikidata?: string; wikipedia?: string; website?: string
  image?: string; desc?: string; source: string
}

type Kind = Pick<LivePlace, 'cat' | 'tags' | 'dwell' | 'intensity' | 'cost' | 'indoor'>
/** Wikipedia short descriptions → category, interests, visit length, effort, typical ticket. Order matters. */
const RULES: [RegExp, Kind][] = [
  [/\b(fort|fortress|citadel|castle)\b/i, { cat: 'heritage', tags: ['history', 'photography', 'adventure'], dwell: 120, intensity: 7, cost: 40, indoor: false }],
  [/\bpalace\b/i, { cat: 'heritage', tags: ['history', 'art', 'culture'], dwell: 90, intensity: 3, cost: 100, indoor: true }],
  [/\b(museum|gallery|planetarium|science centre|science center)\b/i, { cat: 'museum', tags: ['art', 'history', 'kids'], dwell: 90, intensity: 3, cost: 50, indoor: true }],
  [/\b(temple|mandir|gurdwara|church|cathedral|mosque|masjid|dargah|basilica|monastery|ashram|math|ghat|shrine|jain)\b/i, { cat: 'religious', tags: ['spiritual', 'culture', 'photography'], dwell: 45, intensity: 2, cost: 0, indoor: false }],
  [/\b(tomb|mausoleum|monument|memorial|stepwell|ruins|archaeological|minaret|gateway|arch|heritage|unesco|cave|caves|stupa|observatory|haveli|clock tower)\b/i, { cat: 'heritage', tags: ['history', 'photography'], dwell: 60, intensity: 4, cost: 25, indoor: false }],
  [/\b(lake|beach|waterfall|falls|garden|park|reserve|sanctuary|hill|hills|valley|dam|reservoir|forest|island|river front|riverfront|backwater)\b/i, { cat: 'nature', tags: ['nature', 'photography'], dwell: 75, intensity: 4, cost: 20, indoor: false }],
  [/\b(zoo|aquarium|amusement|theme park|water park|film city|snow)\b/i, { cat: 'entertainment', tags: ['kids', 'entertainment'], dwell: 180, intensity: 5, cost: 400, indoor: false }],
  [/\b(market|bazaar|bazar|mall|shopping|street)\b/i, { cat: 'market', tags: ['shopping', 'culture', 'food'], dwell: 75, intensity: 3, cost: 0, indoor: false }],
  [/\b(theatre|theater|auditorium|cultural centre|art centre)\b/i, { cat: 'show', tags: ['culture', 'entertainment', 'art'], dwell: 120, intensity: 1, cost: 200, indoor: true }],
  [/\b(viewpoint|tower|bridge|promenade)\b/i, { cat: 'viewpoint', tags: ['photography', 'nightlife'], dwell: 40, intensity: 2, cost: 0, indoor: false }],
]
/** Skip non-tourist articles (neighbourhoods, schools, hospitals, offices…). */
const NOT_TOURIST = /\b(neighbourhood|neighborhood|locality|suburb|village|town|city|district|mandal|taluk|tehsil|constituency|school|college|university|hospital|company|station|airport|road|highway|office|court|bank|hotel|apartment|stadium in|cricket ground|government|ministry|census|ward|metro station|bus station|railway|cricket|football|stadium|ground|club|cemetery)\b/i

type WikiPage = { pageid: number; title: string; description?: string; coordinates?: { lat: number; lon: number }[]; thumbnail?: { source: string }; pageprops?: { wikibase_item?: string } }

async function wikiAround(lat: number, lon: number): Promise<LivePlace[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=10000&ggslimit=100&prop=description|coordinates|pageimages|pageprops&piprop=thumbnail&pithumbsize=480&ppprop=wikibase_item&colimit=max&pilimit=max&format=json&origin=*`
  const j = await fetchJson<{ query?: { pages: Record<string, WikiPage> } }>(u)
  const out: LivePlace[] = []
  for (const p of Object.values(j.query?.pages ?? {})) {
    const c = p.coordinates?.[0]
    const d = p.description ?? ''
    if (!c || !d || NOT_TOURIST.test(d) && !RULES.slice(0, 5).some(([re]) => re.test(d))) continue
    const rule = RULES.find(([re]) => re.test(`${d} ${p.title}`))
    if (!rule) continue
    out.push({
      id: `wiki:${p.pageid}`, name: p.title.replace(/,.*$/, '').replace(/ \(.*\)$/, ''), lat: c.lat, lon: c.lon, ...rule[1],
      wikidata: p.pageprops?.wikibase_item, wikipedia: `en:${p.title}`, image: p.thumbnail?.source, desc: d, rating: 2, source: 'Wikipedia',
    })
  }
  return out
}

type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }
async function foodAround(lat: number, lon: number): Promise<LivePlace[]> {
  const take = async (tag: string) => (await fetchJson<{ features: Feature[] }>(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&osm_tag=${tag}&radius=6&limit=40`)).features
  const [rest, cafe] = await Promise.all([take('amenity:restaurant').catch(() => []), take('amenity:cafe').catch(() => [])])
  const veg = /veg|bhavan|udupi|sagar|saravana|annapurna|thali|jain|sweets/i
  return [...rest.map((f) => [f, false] as const), ...cafe.map((f) => [f, true] as const)]
    .filter(([f]) => f.properties.name && /^[\x20-\x7EÀ-ɏ]+$/.test(f.properties.name))
    .map(([f, isCafe]) => ({
      id: `osm:${f.properties.osm_type}${f.properties.osm_id}`, name: f.properties.name,
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], cat: isCafe ? 'cafe' : 'food', tags: ['food'],
      dwell: isCafe ? 35 : 55, intensity: 1, cost: isCafe ? 200 : 350, indoor: true,
      diet: (veg.test(f.properties.name) ? 'veg' : 'both') as LivePlace['diet'],
      meal: isCafe ? ['breakfast', 'snack'] : ['breakfast', 'lunch', 'dinner'], source: 'OpenStreetMap (Photon)',
    }))
}

/** opening_hours + diet tags from Overpass for named places near the centre — best effort, 12 s cap. */
async function overpassExtras(lat: number, lon: number, r: number): Promise<Map<string, Record<string, string>>> {
  const q = `[out:json][timeout:10];(nwr["opening_hours"]["name"](around:${r},${lat},${lon});nwr["diet:vegetarian"]["name"](around:${r},${lat},${lon}););out tags 400;`
  const j = await fetchJson<{ elements: { tags?: Record<string, string> }[] }>(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { timeoutMs: 12000 })
  const m = new Map<string, Record<string, string>>()
  for (const e of j.elements) if (e.tags?.name) m.set(e.tags.name.toLowerCase(), e.tags)
  return m
}

/** Attractions and restaurants within radiusKm of a centre (any Indian city or town). */
export function placesAround(lat: number, lon: number, radiusKm = 12): Promise<LivePlace[]> {
  return cached(`places3:${lat.toFixed(2)},${lon.toFixed(2)}:${radiusKm}`, 7 * DAY, async () => {
    // Wikipedia geosearch covers 10 km per call: probe the centre plus a ring for bigger trips
    const probes = [[lat, lon]]
    if (radiusKm > 11) for (const [dy, dx] of [[0.08, 0], [-0.08, 0], [0, 0.09], [0, -0.09]]) probes.push([lat + dy, lon + dx])
    const [wiki, food, extras] = await Promise.all([
      // one probe at a time with a retry: Wikipedia throttles bursts from one client
      (async () => {
        const out: LivePlace[] = []
        for (const [a, b] of probes) {
          const got = await wikiAround(a, b).catch(() => new Promise<LivePlace[]>((r) => setTimeout(() => wikiAround(a, b).then(r, () => r([])), 1200)))
          out.push(...got)
        }
        return out
      })(),
      foodAround(lat, lon).catch(() => []),
      overpassExtras(lat, lon, Math.round(radiusKm * 1000)).catch(() => new Map<string, Record<string, string>>()),
    ])
    const seen = new Set<string>()
    const all = [...wiki, ...food].filter((p) => !seen.has(p.id) && seen.add(p.id) && haversineKm({ lat, lon }, p) <= radiusKm)
    for (const p of all) {
      const t = extras.get(p.name.toLowerCase())
      if (t?.opening_hours) p.hours = t.opening_hours
      if (t?.['diet:vegetarian'] === 'only') p.diet = 'veg'
      if (t?.fee === 'no') p.cost = 0
    }
    if (!wiki.length && !food.length) throw Object.assign(new Error('Live place data is unreachable right now.'), { status: 503 })
    return all
  }, true)
}

/** Popularity from OpenTripMap (rate 1–7) near a centre, keyed by Wikidata id. */
export function popularity(lat: number, lon: number, radiusKm = 12): Promise<Map<string, number>> {
  const key = env('OPENTRIPMAP_API_KEY')
  if (!key) return Promise.resolve(new Map())
  return cached(`otm:${lat.toFixed(2)},${lon.toFixed(2)}`, 14 * DAY, async () => {
    const j = await fetchJson<{ features: { properties: { wikidata?: string; rate: string | number } }[] }>(
      `https://api.opentripmap.com/0.1/en/places/radius?radius=${radiusKm * 1000}&lon=${lon}&lat=${lat}&rate=2&limit=300&format=geojson&apikey=${key}`)
    return j.features.filter((f) => f.properties.wikidata).map((f) => [f.properties.wikidata!, Number(String(f.properties.rate).replace('h', ''))] as [string, number])
  }, true).then((pairs) => new Map(pairs))
}

/** One-line Wikipedia summary (en) for a place with a wikipedia tag like "en:Charminar". */
export function wikiSummary(tag?: string): Promise<string | null> {
  if (!tag) return Promise.resolve(null)
  const [lang, ...rest] = tag.includes(':') ? tag.split(':') : ['en', tag]
  const title = rest.join(':')
  return cached(`wiki:${tag}`, 30 * DAY, async () => {
    const j = await fetchJson<{ extract?: string }>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`).catch(() => null)
    const s = j?.extract?.split('. ')[0]
    return s ? `${s}.` : null
  }, true)
}
