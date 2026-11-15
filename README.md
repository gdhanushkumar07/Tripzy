# Tripzy — smarter travel, better experience

Accurate Hackathon 2026 · Problem Statement 2. One web app with two modules, each usable **solo or as a group** from the same screen:

1. **Daily Traveller** — door-to-door routes that mix the transport modes *you* are comfortable with, ranked three ways: Cheapest, Fastest, Fewest transfers.
2. **Tourist Planner** — 12 quick questions → a day-by-day itinerary with costs → edit it → it's saved.

## The problem, in one real trip

> *"The nearest bus stand is not always the fastest way out of the city."*

Kokapet (Hyderabad) to Warangal at the evening peak (18:00):

| Plan | How | What happens |
|---|---|---|
| **Greedy** (what most apps and people do) | Kokapet → **MGBS** bus stand (the nearest hub, ~21 km by road) → bus to Warangal | The bus then crawls **MGBS → Uppal** in peak traffic before it even leaves the city |
| **Tripzy** | Kokapet → **Raidurg metro** (~7 km) → metro to **Uppal** (~25 km, ~₹69, ~40 min) → bus to Warangal | Skips the worst stretch and boards the same bus line at Uppal |

Other apps plan in one mode and pick the nearest hub greedily, one leg at a time. Tripzy searches **whole door-to-door paths** across every mode you allow, with time-of-day traffic, so a hub only wins if the whole trip through it wins. With the sample data Tripzy shows 4 h 39 min against 5 h 53 min for the nearest-hub plan, and says why: *"Skips 50 min of peak traffic between MGBS and Uppal"*. It also flags the honest trade-off: *"Seat risk: bus starts at MGBS, it may be full when it reaches Uppal."*

## Features

- **The Tripzy look** — the original design is kept: ivory and forest theme with light/dark mode, Instrument Serif headings, the photo-led intro page at `/` for visitors (GSAP scroll chapters, including one on the Kokapet → Warangal story), the split-screen login, the glass navbar with the tab pill, and Wikimedia photography (credits at `/credits`).

- **Accounts** — register, log in, log out, password reset (Firebase Auth). The session survives refresh and browser restarts. Each user sees only their own data.
- **Dashboard** — welcome by name, two big module cards, saved routes and saved trips (one tap to reopen, delete with confirmation), "Continue where you left off" when a draft exists, and default preferences (modes, budget, max transfers).
- **Daily Traveller** (`/commute`) — form and results on one page. Mode chips (walk, auto, bike taxi, cab, city bus, metro, intercity bus, train) are preselected from your preferences. Optional budget and max transfers. Up to three distinct routes (one route can carry two labels). Each has legs, time, fare, distance, changes and a "Why this route" line. Tap a card for the leg-by-leg timeline and a Leaflet/OpenStreetMap map (no API key). "Save route" for one-tap reuse. If nothing is found, it says which mode filter blocks the route and offers "Try with auto added"-style buttons.
- **Tripzy AI** (`/ai`) — chat or speak ("Kokapet to Miyapur", "I have a scooty but don't want to drive in traffic", "I'm in a hurry").
  - Gemini calls Tripzy's own planners as tools (city routes, journeys, hotels, weather), so every fare and time comes from data.
  - Answers about the app and about you are grounded by retrieval (BM25 over the help knowledge base plus your saved routes, trips and preferences).
  - Multiple chats are saved to your account and sync across devices.
  - If the model is down or slow, a rule-based planner answers within seconds.
- **Four answers for every trip** — Recommended, Fastest, Cheapest and Most comfortable. A **Public transport** option is added whenever none of them uses a bus or the metro.
  - Metro fares are one ticket across line changes.
  - At the stop where you get off, "Other ways from here" lists the next bus, auto, bike taxi, cab and walking, with times and fares.
  - "Missed it? Replan from where I am now" works for city trips and long journeys.
- **Journeys anywhere** — when the trip is longer than 80 km or outside India, Daily Traveller becomes a door-to-door journey planner. It asks 2–3 questions (who travels, what matters most, luggage and own vehicle) and compares flights (with the airport cab, check-in buffer and bag wait), trains, intercity buses, your own car (fuel from your saved mileage, tolls), outstation cabs, and worldwide public transport from Transitous (rail, FlixBus, metro, ferries). Options are tagged **Fastest / Cheapest / Most comfortable / Best balanced**. Booking links open with the stations or airports, date and passengers filled in (ixigo/ConfirmTkt for IRCTC trains, MakeMyTrip/Google Flights/Skyscanner, Booking.com). "Replan from where I am now" uses your live location after a missed connection. Hotels with nightly prices come up for the destination. See [docs/GLOBAL_JOURNEYS.md](docs/GLOBAL_JOURNEYS.md).
- **Own vehicle and profile** — save your family, car/scooter mileage and priority once in the dashboard. Your scooter or car can be the first ride of a city route (scooter → metro → bus).
- **Meet up from different places** — in Group mode choose *Different starts, one destination*. Everyone sets where they start, and Tripzy picks the meeting point (a metro station, bus stand or railway station) where riding on together saves the most. If going separately is better, it says so. Each person gets their own leave time so nobody waits.
- **Group commute** — switch to Group and share the link. Members join, everyone leaves from the same origin and time, and each member picks their own destination (updates live). The engine picks the split point **S** that minimises the cost of travelling together from the origin to S, plus each member's cost from S onwards. Auto and cab fares on shared legs are split across the group. The plan shows the shared legs, a "✂ Split at Uppal Bus Stand" marker, then each member's own legs. Every member gets a notification when the plan is ready. The organiser can remove members.
- **Tourist Planner** (`/tour`) — one question per screen, large tap targets, "4 of 12" progress, Back and Next, a review screen where every answer can be edited, autosave, and resume at the first unanswered question after a refresh or a later visit.
- **Itinerary** (`/tour/:tripId`) — day-by-day stops with times, travel between stops, cost per stop, cost per day, and the trip total against your budget. You can remove (with Undo), swap for a suggested alternative, or move a stop up or down. Totals recalculate at once, and edits autosave.
- **Group tour** — the organiser answers the trip questions (destination, dates, days). Each member answers only the 9 personal ones through the invite link. When merging, the lowest budget, the slowest pace and the strictest diet win, and interests are ranked by votes. Stops carry a "Wanted by Asha, Ravi" tag. There is one shared itinerary, and it updates live for everyone.
- **Reliability** — offline banner; drafts are kept on the device and synced on reconnect; "Saving…", "Saved 12:04" and "Saved on this device — will sync when online" status; Retry on every failure; skeleton loaders; submit buttons that ignore double clicks; and an "unsaved changes" warning only while an edit hasn't been written yet.

## Architecture (in a few lines)

- **React 19 + TypeScript + Vite + Tailwind + react-router + GSAP + Leaflet**, plus a small **Node API server** (`server/`, Express) that keeps provider keys out of the browser, caches every upstream call and falls back to keyless sources. **Firebase Auth (email + Google) + Firestore** store users, drafts, routes, trips, groups and history. Firestore offline persistence is on.
- **Where algorithms are used and where AI is used** — see [docs/REALTIME_PLAN.md](docs/REALTIME_PLAN.md). In short: routing, fares, group splitting, opening hours, weather suitability, itinerary building and personalisation are deterministic algorithms; AI (Gemini) only reads fresh web search results (Tavily) to flag closures, festivals or crowds for a place on your date, with cited sources. AI never invents places, times or prices.
- `src/commute/engine.ts` — pure routing engine (tested). Time-dependent multi-label Dijkstra over whole door-to-door paths: state = (node, arrival time, current vehicle), Pareto labels on time, fare, changes and km on the current vehicle. Metro fares are priced boarding → alighting from the official fare table. Party size splits auto/cab fares per vehicle; `planGroup()` picks the split point and compares it with **one cab / SUV for everyone**.
- `server/plan/commute.ts` — builds that graph live for each query, anywhere in India: city railway junctions and bus terminals (OpenStreetMap via Photon), metro/bus stations from **GTFS timetables** with that day's real departures, one road-time matrix (OSRM or Ola Maps) between all points with a peak-hour calibration, trains (Indian Rail API when keyed, else a labelled estimate) and intercity buses (labelled estimates), plus booking links for Uber, Ola, Rapido, Namma Yatri, redBus, AbhiBus, the state RTC and IRCTC.
- `src/tour/generate.ts` — one itinerary algorithm for live and offline data. `server/plan/tour.ts` feeds it real places (Wikipedia + OpenStreetMap, OpenTripMap popularity when keyed), per-date opening hours (OSM `opening_hours`, or typical hours flagged), hourly weather, air quality and real sunrise/sunset (Open-Meteo), optional AI web checks, and your history weights.
- `src/lib/taste.ts` — personalisation: interest boosts and preferred modes from your own `users/{uid}/history` (kept, removed and swapped stops, saved routes), decaying over 60 days; each boost is shown with its reason.
- Shared mechanisms, each built once: `RequireAuth`, `useDraft(key)`, `request(fn)` (timeout, retries, de-duplication, plain-language errors), one status module, `LocationInput` (India-wide search) and `LiveMap` (numbered markers with popups).

```
server/                API: index.ts, providers/ (geo, route, weather, places, hubs, ai, rail), plan/ (commute, tour), transit/ (GTFS), fares.ts
scripts/gtfs-import.ts download + index public GTFS feeds (metro, city buses)
src/
  commute/             engine.ts (+ tests), CommutePage, RouteView
  tour/                questions.ts, generate.ts (+ tests), TourPage, TripPage
  lib/                 firebase, auth, api, history/taste, useDraft, request, status, db, useGroup
  pages/               HomePage (intro), LoginPage, Dashboard, JoinPage, CreditsPage
  ui/                  Tripzy UI kit, LiveMap, LocationInput, motion, photos, layouts
  data/                sample data for tests and the offline "Basic plan"
```

## Setup

Requirements: Node 22+, Java 11+ (for the Firebase emulators) and the Firebase CLI.

```bash
npm install
```

```bash
npm install -g firebase-tools
```

Download and index the public transit timetables (Hyderabad Metro + TGSRTC by default; add `bmtc chennai best pmpml amd` for more cities):

```bash
npm run gtfs -- hmrl tgsrtc
```

### Option A — fully local, no Firebase project needed

Run the Firebase emulators in one terminal:

```bash
npm run emulators
```

Run the web app and the API server together in a second terminal:

```bash
npm run dev
```

Open http://localhost:5173. Everything works without any API key using OpenStreetMap, Wikipedia, Open-Meteo and the GTFS timetables. In local mode "Continue with Google" shows the emulator's test-account screen.

### Option B — your Firebase project (needed for real Google sign-in)

1. Firebase console → create a project and a **Web app**. Enable **Authentication → Email/Password and Google**, create **Firestore**, and add your domain under Authentication → Settings → Authorised domains.
2. Copy the env file and fill in the web config and any provider keys:
   ```bash
   cp .env.example .env
   ```
3. Deploy the security rules:
   ```bash
   firebase deploy --only firestore:rules --project <your-project-id>
   ```
4. Start:
   ```bash
   npm run dev
   ```

### Environment variables (`.env`, never committed)

| Variable | Used by | Purpose (all free tiers) |
|---|---|---|
| `VITE_FIREBASE_*` | web | Firebase web config. Empty API key = emulators |
| `OLA_MAPS_API_KEY` | server | India geocoding/places and traffic-aware directions (else Photon + OSRM) |
| `GEMINI_API_KEY`, `TAVILY_API_KEY` | server | Live "good day to visit?" notices from web news, with sources |
| `OPENTRIPMAP_API_KEY` | server | Attraction popularity ratings |
| `RAIL_API_KEY` | server | Real trains between stations (else a labelled estimate) |

## Test

`npm test` runs the unit tests: the engine on a fixed Hyderabad graph (labels, metro one-ticket fares, no back-to-back hired rides, no revisited stops, park-and-ride, groups split/meet), the tour planner, and Tripzy AI's parser and retrieval.

`npm run scenarios` runs live checks on real roads and timetables. It covers Karmanghat → Kokapet with all modes, public transport only, a ₹120 budget and own scooter. It also covers Miyapur → HITEC City, LB Nagar → Ameerpet, Uppal → Raidurg, Secunderabad → Charminar, a family of 4, Gachibowli → Warangal, both group modes and Hyderabad → Bengaluru by car. It fails on answers a normal person would call wrong.

```bash
npm test
```

Engine, live-graph and planner unit tests (Vitest), including: Fastest via Raidurg metro and Uppal on the reference graph; MGBS when metro is deselected; no-route messages; metro fares by boarding → alighting; cab fares split per person; one cab for a group; opening intervals and rain on live trips; personalisation boosts and decay.

```bash
npm run lint
```

```bash
npm run build
```

## Data honesty

| Data | Kind |
|---|---|
| Road times, places, stations, weather, air quality, sunrise/sunset | Live |
| Metro and city-bus departures and metro fares | Official/public timetables (GTFS), date shown in the app |
| Auto/cab/bike-taxi fares, intercity bus times and fares, trains without a rail key | Estimates from published tariffs and distance, marked "est." |
| Ride-hailing and bus booking | Link-out: Uber, Ola, Rapido, Namma Yatri, redBus, AbhiBus, state RTCs and IRCTC publish no public price API |
| `src/data/` | Self-generated sample data for tests and the offline "Basic plan" |

## 5-minute demo script

1. **Intro + register (0:45).** Open http://localhost:5173 and scroll the intro page (chapter 04 tells the Kokapet → Warangal story). Press *Get started*. Show a wrong password first, which gives a clear message next to the form. Then go to *Register* → name, email, password → you land on the dashboard ("Welcome, <name>").
2. **Dashboard (0:30).** Two cards, empty saved lists, and preferences. Toggle a mode and press *Save preferences*; the commute form preselects these.
3. **Solo commute at 18:00 (1:15).** *Daily Traveller* → tap **"Kokapet → Warangal (evening peak)"**. Point at the blue note: the nearest-hub plan via MGBS takes 5 h 53 min. Open **Fastest**: bike taxi → Raidurg metro → Uppal → bus, 4 h 39 min, *"Skips 50 min of peak traffic between MGBS and Uppal"*, plus the seat-risk note and the map. Press **Save route**. Untick *Metro* and press *Find routes*: the Fastest now goes via MGBS. Untick everything except Metro for CBIT → Dilsukhnagar to show "No route found" → tap *Try with auto added*. Refresh the page: the same results come back.
4. **Group commute with a split (1:00).** Toggle **Group** and copy the invite link. Open it in a private window, register a second user, and pick *Hanamkonda*; a third user picks *Uppal Bus Stand*. The organiser picks *Warangal* and presses **Plan for the group**. Everyone gets "Group plan ready — split at Uppal Bus Stand" and sees the shared legs, the ✂ marker and their own onward legs. Remove a member to show the confirm dialog.
5. **Tourist questionnaire with a refresh (0:45).** *Tourist Planner* → answer 4 questions → **refresh**: it resumes at "5 of 12". Finish, review, edit one answer, then press **Create my plan**.
6. **Itinerary edit (0:30).** Move a stop up, remove one (then Undo), and swap one for a suggestion. The day total and trip total change at once, and the status shows "Saved hh:mm". Back on the dashboard, the trip is in *Saved trips*.
7. **Offline (0:30).** DevTools → Network → *Offline*. The banner appears. Change a mode chip on the commute form: the status shows "Saved on this device — will sync when online". Switch back online and it syncs ("Saved hh:mm").

Optional extras: set `VITE_AI_PLANNER_URL=http://127.0.0.1:9/plan` to show the AI-failure path (Retry / **Basic plan**). Stop the emulators mid-edit to show the Firestore-outage path (draft kept locally, Retry).

## Credits

Maps © OpenStreetMap contributors, via Leaflet. Earlier iterations of this repo were built on TREK (AGPL-3.0). That code was removed on branch `minimal` (see `AUDIT.md`).
