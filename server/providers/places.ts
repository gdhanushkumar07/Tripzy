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
/**
 * Wikipedia short descriptions → category, interests, visit length, effort, typical ticket. Order matters:
 * family attractions before nature (a "zoological park" is not a nature walk), beaches before lakes.
 * Tags are kept narrow on purpose: a temple is spiritual, not "culture and photography", so a traveller who
 * picked culture is not handed a day of temples. Extra tags come from the description (see extraTags).
 */
const RULES: [RegExp, Kind][] = [
  [/\b(zoo|zoological|aquarium|amusement|theme park|water park|film city|snow park|safari park)\b/i, { cat: 'entertainment', tags: ['kids', 'entertainment'], dwell: 180, intensity: 4, cost: 300, indoor: false }],
  [/\b(fort|fortress|citadel|castle)\b/i, { cat: 'heritage', tags: ['history', 'photography'], dwell: 120, intensity: 6, cost: 40, indoor: false }],
  [/\bpalace\b/i, { cat: 'heritage', tags: ['history', 'art', 'culture'], dwell: 90, intensity: 3, cost: 100, indoor: true }],
  [/\b(museum|gallery|planetarium|science centre|science center)\b/i, { cat: 'museum', tags: ['art', 'history'], dwell: 90, intensity: 2, cost: 50, indoor: true }],
  [/\b(temple|mandir|gurdwara|church|cathedral|mosque|masjid|dargah|basilica|monastery|ashram|math|ghat|shrine|jain)\b/i, { cat: 'religious', tags: ['spiritual'], dwell: 45, intensity: 2, cost: 0, indoor: false }],
  [/\b(tomb|tombs|mausoleum|monument|memorial|stepwell|ruins|archaeological|minaret|gateway|arch|heritage|unesco|cave|caves|stupa|observatory|haveli|clock tower)\b/i, { cat: 'heritage', tags: ['history', 'photography'], dwell: 60, intensity: 3, cost: 25, indoor: false }],
  [/\b(beach|seashore|sea shore|coast)\b/i, { cat: 'beach', tags: ['beach', 'nature', 'photography'], dwell: 120, intensity: 2, cost: 0, indoor: false }],
  [/\b(lake|waterfall|falls|garden|gardens|park|reserve|sanctuary|national park|hill|hills|valley|dam|reservoir|forest|island|river front|riverfront|backwater)\b/i, { cat: 'nature', tags: ['nature', 'photography'], dwell: 75, intensity: 3, cost: 20, indoor: false }],
  [/\b(market|bazaar|bazar|mall|shopping)\b/i, { cat: 'market', tags: ['shopping', 'culture'], dwell: 75, intensity: 2, cost: 0, indoor: false }],
  [/\b(theatre|theater|auditorium|cultural centre|art centre|crafts village)\b/i, { cat: 'show', tags: ['culture', 'entertainment', 'art'], dwell: 120, intensity: 1, cost: 200, indoor: true }],
  [/\b(viewpoint|tower|bridge|promenade)\b/i, { cat: 'viewpoint', tags: ['photography'], dwell: 40, intensity: 2, cost: 0, indoor: false }],
]
/** Tags implied by words in the description, on top of the category's own. */
function extraTags(text: string, k: Kind): string[] {
  const t: string[] = []
  if (k.cat === 'religious' && /\b(century|ancient|historic|heritage|dynasty|built in|unesco|medieval|mughal|qutb|chola|chalukya|vijayanagara)\b/i.test(text)) t.push('history')
  if (k.cat === 'religious' && /\b(architecture|carv|marble|famous|iconic|landmark)\b/i.test(text)) t.push('photography')
  if (k.cat === 'museum' && /\b(science|children|planetarium|toy|doll|railway|dinosaur|space)\b/i.test(text)) t.push('kids')
  if (k.cat === 'heritage' && /\b(hill fort|hilltop|trek|steps|climb)\b/i.test(text)) t.push('adventure')
  if (k.cat === 'nature' && /\b(lake|reservoir|river front|riverfront|promenade)\b/i.test(text)) t.push('nightlife')
  if (k.cat === 'nature' && /\b(trek|waterfall|falls|national park|sanctuary|hills?)\b/i.test(text)) t.push('adventure')
  if (k.cat === 'nature' && /\b(park|garden|gardens)\b/i.test(text)) t.push('kids')
  if (k.cat === 'viewpoint' && /\b(promenade|waterfront|necklace|sea face|lake)\b/i.test(text)) t.push('nightlife')
  if (k.cat === 'market' && /\b(street food|food street|khau galli|eat street)\b/i.test(text)) t.push('food')
  if (k.cat === 'market' && /\b(night market|night bazaar)\b/i.test(text)) t.push('nightlife')
  return t
}
/** Skip non-tourist articles (neighbourhoods, schools, hospitals, offices…). */
const NOT_TOURIST = /\b(neighbourhood|neighborhood|locality|suburb|village|town|city|district|mandal|taluk|tehsil|constituency|school|college|university|institute|engineering|polytechnic|academy|hospital|company|station|airport|road|highway|office|court|bank|hotel|apartment|stadium in|cricket ground|government|ministry|census|ward|metro station|bus station|railway|cricket|football|stadium|ground|club|cemetery)\b/i

const INSTITUTION = /\b(college|university|institute of|institute|school|polytechnic|engineering|hospital|medical sciences)\b/i
type WikiPage = { pageid: number; title: string; description?: string; coordinates?: { lat: number; lon: number }[]; thumbnail?: { source: string }; pageprops?: { wikibase_item?: string } }

async function wikiAround(lat: number, lon: number): Promise<LivePlace[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=10000&ggslimit=100&prop=description|coordinates|pageimages|pageprops&piprop=thumbnail&pithumbsize=480&ppprop=wikibase_item&colimit=max&pilimit=max&format=json&origin=*`
  const j = await fetchJson<{ query?: { pages: Record<string, WikiPage> } }>(u)
  const out: LivePlace[] = []
  for (const p of Object.values(j.query?.pages ?? {})) {
    const c = p.coordinates?.[0]
    const d = p.description ?? ''
    if (!c || !d || NOT_TOURIST.test(d) && !RULES.slice(0, 7).some(([re]) => re.test(d))) continue
    // colleges, schools and hospitals are never sights, even when the article mentions a museum or a heritage building
    if (INSTITUTION.test(`${p.title} ${d}`)) continue
    const text = `${d} ${p.title}`
    const rule = RULES.find(([re]) => re.test(text))
    if (!rule) continue
    const tags = [...new Set([...rule[1].tags, ...extraTags(text, rule[1])])]
    out.push({
      id: `wiki:${p.pageid}`, name: p.title.replace(/,.*$/, '').replace(/ \(.*\)$/, ''), lat: c.lat, lon: c.lon, ...rule[1], tags,
      wikidata: p.pageprops?.wikibase_item, wikipedia: `en:${p.title}`, image: p.thumbnail?.source, desc: d, rating: 2, source: 'Wikipedia',
    })
  }
  return out
}

type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }
type GeoFeature = { properties: { name?: string; lat: number; lon: number; place_id: string; categories: string[]; opening_hours?: string; catering?: { diet?: { vegetarian?: boolean; vegan?: boolean } }; datasource?: { raw?: Record<string, string> } } }

/** Names that are not a meal stop: pan shops, juice and chips counters, sweet shops, ice cream, bakeries. */
const NOT_A_MEAL = /\b(pan|paan|beeda|chips|juice|juices|ice ?cream|gelato|bakery|bakers|bake house|sweets?|mithai|confectioner|cool ?drinks?|soda|tea stall|chai point|tea point|kiosk|stall|wines?|bar & wines|liquor|chicken centre|mutton shop|meat shop|pharmacy|general store|kirana|canteen)\b/i
/** Chains a traveller can eat at anywhere; kept as a fallback, never picked over local food. */
const CHAIN = /\b(mcdonald'?s|kfc|domino'?s|pizza hut|subway|burger king|starbucks|cafe coffee day|ccd|baskin|haldiram'?s|wow! momo|faasos|behrouz|barbeque nation|taco bell|dunkin|chai point|chaayos|theobroma|wendy'?s|la pino'?z|biryani by kilo)\b/i
const LATIN = /^[\x20-\x7EÀ-ɏ’]+$/
/**
 * A rough quality score for a food place (0–7, the same scale as attraction fame): local sit-down
 * restaurants above fast food, chains last. Places that are not meals (pan, juice, sweets) are dropped.
 */
function foodPlace(name: string, kind: 'restaurant' | 'cafe' | 'fast'): { rating: number; meal: string[] } | null {
  if (!LATIN.test(name) || name.length < 3) return null
  if (NOT_A_MEAL.test(name)) return kind === 'cafe' && !/\b(pan|paan|wines?|liquor|meat|chicken centre|pharmacy|kirana)\b/i.test(name) ? { rating: 1, meal: ['snack'] } : null
  if (CHAIN.test(name)) return { rating: 0.5, meal: kind === 'cafe' ? ['breakfast', 'snack'] : ['lunch', 'dinner'] }
  if (kind === 'cafe') return { rating: 2, meal: ['breakfast', 'snack'] }
  if (kind === 'fast') return { rating: 1.2, meal: ['breakfast', 'lunch', 'dinner'] }
  return { rating: 2.5, meal: ['breakfast', 'lunch', 'dinner'] }
}

/** Restaurants + cafés with diet tags and opening hours (Geoapify Places, free 3,000 credits/day). */
async function geoapifyFood(lat: number, lon: number, key: string): Promise<LivePlace[]> {
  const j = await fetchJson<{ features: GeoFeature[] }>(`https://api.geoapify.com/v2/places?categories=catering.restaurant,catering.cafe,catering.fast_food&filter=circle:${lon},${lat},6000&bias=proximity:${lon},${lat}&limit=120&apiKey=${key}`)
  const pureVeg = /veg|bhavan|udupi|sagar|saravana|annapurna|thali|jain|sweets/i
  return j.features.filter((f) => f.properties.name).flatMap(({ properties: p }) => {
    const cafe = p.categories.includes('catering.cafe')
    const fast = p.categories.includes('catering.fast_food')
    const q = foodPlace(p.name!, cafe ? 'cafe' : fast ? 'fast' : 'restaurant')
    if (!q) return []
    const raw = p.datasource?.raw ?? {}
    const diet: LivePlace['diet'] = raw['diet:vegetarian'] === 'only' || (pureVeg.test(p.name!) && raw['diet:meat'] !== 'yes') ? 'veg' : 'both'
    return [{
      id: `geo:${p.place_id}`, name: p.name!, lat: p.lat, lon: p.lon, cat: cafe ? 'cafe' : 'food', tags: ['food'],
      dwell: cafe ? 35 : 55, intensity: 1, cost: cafe ? 200 : fast ? 150 : 350, indoor: true, diet,
      meal: q.meal, rating: q.rating, hours: p.opening_hours, source: 'Geoapify (OpenStreetMap)',
    }]
  })
}

async function foodAround(lat: number, lon: number): Promise<LivePlace[]> {
  const gkey = env('GEOAPIFY_API_KEY')
  if (gkey) {
    const got = await geoapifyFood(lat, lon, gkey).catch(() => [])
    if (got.length >= 5) return got
  }
  const take = async (tag: string) => (await fetchJson<{ features: Feature[] }>(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&osm_tag=${tag}&radius=6&limit=40`)).features
  const [rest, cafe] = await Promise.all([take('amenity:restaurant').catch(() => []), take('amenity:cafe').catch(() => [])])
  const veg = /veg|bhavan|udupi|sagar|saravana|annapurna|thali|jain|sweets/i
  return [...rest.map((f) => [f, false] as const), ...cafe.map((f) => [f, true] as const)].flatMap(([f, isCafe]) => {
    const q = typeof f.properties.name === 'string' ? foodPlace(f.properties.name, isCafe ? 'cafe' : 'restaurant') : null
    if (!q) return []
    return [{
      id: `osm:${f.properties.osm_type}${f.properties.osm_id}`, name: f.properties.name,
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], cat: isCafe ? 'cafe' : 'food', tags: ['food'],
      dwell: isCafe ? 35 : 55, intensity: 1, cost: isCafe ? 200 : 350, indoor: true,
      diet: (veg.test(f.properties.name) ? 'veg' : 'both') as LivePlace['diet'],
      meal: q.meal, rating: q.rating, source: 'OpenStreetMap (Photon)',
    }]
  })
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
  return cached(`places7:${lat.toFixed(2)},${lon.toFixed(2)}:${radiusKm}`, 7 * DAY, async () => {
    // Wikipedia geosearch covers 10 km per call: probe the centre plus a ring for bigger trips
    const probes = [[lat, lon]]
    if (radiusKm > 11) for (const [dy, dx] of [[0.08, 0], [-0.08, 0], [0, 0.09], [0, -0.09]]) probes.push([lat + dy, lon + dx])
    // long trips: a second ring for day trips further out
    if (radiusKm > 24) for (const [dy, dx] of [[0.18, 0.1], [0.18, -0.1], [-0.18, 0.1], [-0.18, -0.1], [0, 0.22], [0, -0.22]]) probes.push([lat + dy, lon + dx])
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
    const all = [...wiki, ...food].filter((p) => typeof p.name === 'string' && !seen.has(p.id) && seen.add(p.id) && haversineKm({ lat, lon }, p) <= radiusKm)
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

/**
 * Fame of places from Wikidata: the number of Wikipedia language editions with an article on the place.
 * Charminar or the Taj Mahal have dozens; a neighbourhood temple has one. Returned on a 0–7 scale.
 */
export async function fame(ids: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(ids.filter((x) => /^Q\d+$/.test(x)))]
  const out = new Map<string, number>()
  const chunks: string[][] = []
  for (let i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50))
  await Promise.all(chunks.slice(0, 8).map(async (ids) => {
    const got = await cached(`fame:${ids.join(',')}`, 30 * DAY, async () => {
      const j = await fetchJson<{ entities?: Record<string, { sitelinks?: Record<string, unknown> }> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=sitelinks&format=json&origin=*`, { timeoutMs: 8000 })
      return Object.entries(j.entities ?? {}).map(([id, e]) => [id, Object.keys(e.sitelinks ?? {}).filter((k) => k.endsWith('wiki') && k !== 'commonswiki').length] as [string, number])
    }, true).catch(() => [] as [string, number][])
    for (const [id, n] of got) out.set(id, Math.min(7, Math.round(Math.log2(1 + n) * 1.35 * 10) / 10))
  }))
  return out
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
