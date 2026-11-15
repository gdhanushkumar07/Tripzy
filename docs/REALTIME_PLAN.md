# Tripzy on real data — plan

Status legend: **Live** = fetched at request time · **Timetable** = official published schedule (GTFS), refreshed by script · **Estimate** = computed from published tariffs, labelled in the UI · **Link-out** = we open the operator's own app/site (no public API exists).

## 1. Where AI is used, and where algorithms are used

| Job | Algorithm or AI | Why |
|---|---|---|
| Geocoding anywhere in India, autocomplete | API (Ola Maps → Photon/Nominatim fallback) | Deterministic lookup |
| Road distance/time between points | API (Ola Directions → OSRM fallback) + peak-hour multiplier | Real road network |
| Door-to-door multi-modal route (cheapest / fastest / fewest changes) | **Algorithm**: time-dependent multi-label Dijkstra on a graph built per query from live road legs + GTFS transit legs + rail | Must be correct, explainable, testable |
| Group split point and "take one cab together?" | **Algorithm**: generalised cost (fare split by vehicles + value of time + comfort penalty per change, luggage/seniors) over candidate split nodes | Exact optimisation, no guessing |
| Fares for auto, cab, bike taxi, e-rickshaw | **Algorithm** on published state tariff tables (Estimate) | No public fare API exists |
| Weather, rain, heat, air quality per stop and hour | API (Open-Meteo forecast + air quality) — Live, no key | |
| Is a place open now / on that date | **Algorithm**: OSM `opening_hours` parser + weekly closures | Deterministic |
| Itinerary build (order, timing, meals, budget) | **Algorithm**: greedy composer scoring interest × weather × best-time × travel × history | Must respect hours and budget exactly |
| "Is it a good time to visit?" (festival crowds, temporary closure, news) | **AI** (Gemini) reading **live web search** results (Tavily) — optional, cited | Unstructured, changes daily |
| Personal explanation ("because you loved forts in Jaipur") | **Algorithm** for weights from history; **AI** only to phrase a summary (optional) | Weights must be transparent |
| Interest matching for places with no tags | **AI** classification (optional), else OSM tags | |

AI is never allowed to invent places, times or prices; it only reads search results and returns a verdict with sources.

## 2. Data sources

| Need | Source | Key? | Kind |
|---|---|---|---|
| Geocode, places search, India-wide | **Ola Maps** (100K free calls/month each API) | Yes (free) | Live |
| Fallback geocode | Photon (komoot) / Nominatim (OSM) | No | Live |
| Road routing | Ola Maps Directions → OSRM public server | Ola key / none | Live |
| Tourist places with hours | OpenStreetMap Overpass (`tourism`, `historic`, `opening_hours`) | No | Live |
| Place popularity, descriptions | OpenTripMap (rating, Wikidata) + Wikipedia summaries | OpenTripMap key (free) | Live |
| Weather 16 days, hourly | Open-Meteo | No | Live |
| Air quality | Open-Meteo Air Quality | No | Live |
| Metro, city buses | GTFS: Hyderabad Metro, TGSRTC, BMTC, Chennai MTC, Mumbai BEST, PMPML, Ahmedabad, Delhi (OTD Delhi, free signup) | Delhi only | Timetable |
| Trains between stations, running status | indianrailapi.com or RapidAPI "IRCTC" | Yes (free tier) | Live |
| Live web context for a place | Tavily Search API (1,000 free/month) | Yes (free) | Live |
| AI reasoning | Gemini API (AI Studio free tier) | Yes (free) | Live |
| Cab/auto/bike taxi booking | Ola, Uber, Rapido, Namma Yatri | — | Link-out + Estimate |
| Private and state buses | redBus, AbhiBus, TGSRTC Gamyam/TSRTC, APSRTC, KSRTC, MSRTC | — | Link-out |
| Directions per leg | Google Maps URLs (`/maps/dir/?api=1`) | No | Link-out |
| Sign-in and storage | Firebase Auth (Email + Google) + Firestore | Firebase project | Live |

## 3. Transport modes

walk · cycle · auto · shared auto · e-rickshaw · bike taxi · cab (mini / sedan / SUV-6) · city bus · AC city bus · metro · suburban rail (Mumbai local, MMTS, Chennai MRTS) · monorail · tram (Kolkata) · ferry / water metro · intercity bus (state / private) · train · flight (link-out only).

## 4. Group travel rule

For n travellers a cab costs `fare × ceil(n / seats)` shared, not `fare × n`. Each change of vehicle adds a comfort penalty (higher with seniors, kids or luggage). The engine always adds a **"one cab, door to door"** candidate for groups of 3+; it wins when it is cheaper per head, faster, or within 10% cost but saves two or more changes.

## 5. Personalisation

`users/{uid}/history` stores events: trip saved, stop removed / swapped / kept, route saved, modes chosen. From them: interest weights (kept +, removed −, decays over 90 days), preferred modes, typical daily budget and start time. These feed the planner score and preselect the commute form; every boost is shown ("Because you kept 3 forts").

## 6. Keys you need to create (all free)

1. Firebase project (Spark, free): enable Email/Password **and Google** sign-in, create Firestore. → `VITE_FIREBASE_*`
2. Ola Maps (maps.olakrutrim.com): API key → `OLA_MAPS_API_KEY`
3. Gemini (aistudio.google.com): API key → `GEMINI_API_KEY`
4. Tavily (tavily.com): API key → `TAVILY_API_KEY`
5. OpenTripMap (dev.opentripmap.org): API key → `OPENTRIPMAP_API_KEY`
6. Indian Rail API (indianrailapi.com) or RapidAPI IRCTC: key → `RAIL_API_KEY`
7. Optional: Delhi Open Transit Data (otd.delhi.gov.in) for Delhi Metro/DTC GTFS.

Everything works without 2–7 using the no-key fallbacks; each keyed source switches on when its key is present.
