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
- **Group commute** — switch to Group and share the link. Members join, everyone leaves from the same origin and time, and each member picks their own destination (updates live). The engine picks the split point **S** that minimises the cost of travelling together from the origin to S, plus each member's cost from S onwards. Auto and cab fares on shared legs are split across the group. The plan shows the shared legs, a "✂ Split at Uppal Bus Stand" marker, then each member's own legs. Every member gets a notification when the plan is ready. The organiser can remove members.
- **Tourist Planner** (`/tour`) — one question per screen, large tap targets, "4 of 12" progress, Back and Next, a review screen where every answer can be edited, autosave, and resume at the first unanswered question after a refresh or a later visit.
- **Itinerary** (`/tour/:tripId`) — day-by-day stops with times, travel between stops, cost per stop, cost per day, and the trip total against your budget. You can remove (with Undo), swap for a suggested alternative, or move a stop up or down. Totals recalculate at once, and edits autosave.
- **Group tour** — the organiser answers the trip questions (destination, dates, days). Each member answers only the 9 personal ones through the invite link. When merging, the lowest budget, the slowest pace and the strictest diet win, and interests are ranked by votes. Stops carry a "Wanted by Asha, Ravi" tag. There is one shared itinerary, and it updates live for everyone.
- **Reliability** — offline banner; drafts are kept on the device and synced on reconnect; "Saving…", "Saved 12:04" and "Saved on this device — will sync when online" status; Retry on every failure; skeleton loaders; submit buttons that ignore double clicks; and an "unsaved changes" warning only while an edit hasn't been written yet.

## Architecture (in a few lines)

- **React 19 + TypeScript + Vite + Tailwind + react-router + GSAP + lucide icons**, one small app at the repo root, with **Firebase Auth + Firestore** as the only backend. Firestore offline persistence is on.
- `src/commute/engine.ts` — pure routing engine, no UI. The graph is one JSON file. Unselected modes are removed, then a time-dependent, label-setting Dijkstra runs. A state is (node, arrival time, current vehicle), and the Pareto labels cover time, fare, changes and the distance on the current vehicle. Road legs get a peak multiplier from 08:00–11:00 and 17:00–21:00; metro and train legs don't. The search runs once for each objective, and `planGroup()` picks the split node.
- `src/tour/generate.ts` — pure rule-based planner ("Basic plan"), ported from the old Python engine. It respects opening hours, weekly closures, fixed show slots, meals, diet, effort and budget. `questions.ts` holds the 12 questions and the group merge.
- Shared mechanisms, each built once: `RequireAuth` (`lib/auth.tsx`), `useDraft(key)` (`lib/useDraft.ts`), `request(fn)` (`lib/request.ts`: timeout, 2 retries with backoff, de-duplication, plain-language errors), and one status module (`lib/status.tsx`: banner, save status, toasts, skeletons, confirm dialog, `useAction` for submit buttons).
- Data model: `users/{uid}` (name, prefs), `users/{uid}/drafts/{commute|tour}`, `users/{uid}/routes/{id}`, `users/{uid}/trips/{id}`, and `groups/{code}` (type, ownerUid, memberUids, members, settings, result). Rules are in `firestore.rules`.

```
src/
  App.tsx              routes + shared header
  lib/                 firebase, auth guard, useDraft, request, status, db, validate, useGroup
  commute/             engine.ts (+ tests), CommutePage, RouteView, RouteMap
  tour/                questions.ts, generate.ts (+ tests), TourPage, TripPage
  pages/               HomePage (intro), LoginPage, Dashboard, JoinPage, CreditsPage
  ui/                  original Tripzy UI kit, motion (GSAP), photos, public layout, app shell
  data/                hyderabad-graph.json, places.json   ← sample data
```

## Setup

Requirements: Node 22+, Java 11+ (for the Firebase emulators) and the Firebase CLI.

```bash
npm install
```

```bash
npm install -g firebase-tools
```

### Option A — fully local, no Firebase project needed (recommended for judging)

With no keys in `.env`, the app talks to the **Firebase emulators** (Auth + Firestore) on your machine. Run them in one terminal:

```bash
npm run emulators
```

Run the app in a second terminal:

```bash
npm run dev
```

Open http://localhost:5173 and register any email (for example `you@tripzy.test`). Emulator accounts and data reset when the emulators stop. Password-reset links appear in the emulator UI at http://localhost:4000 (Auth tab) instead of being emailed.

### Option B — your Firebase project

1. In the Firebase console, create a web app and enable **Authentication → Email/Password** and **Firestore**.
2. Copy the env file and fill in the web config:
   ```bash
   cp .env.example .env
   ```
3. Deploy the security rules:
   ```bash
   firebase deploy --only firestore:rules --project <your-project-id>
   ```
4. Start the app:
   ```bash
   npm run dev
   ```

### Environment variables (`.env`, never committed)

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Firebase web config. Leave the API key empty to use the emulators |
| `VITE_USE_EMULATORS` | `true` forces emulators even when keys are set |
| `VITE_AI_PLANNER_URL` | Optional AI itinerary endpoint (POST answers → trip JSON). Empty = rule-based planner only. The app works fully without it |

## Test

```bash
npm test
```

This runs the engine and planner unit tests (Vitest). Among other things it checks that:
- at 18:00 the **Fastest** Kokapet → Warangal route goes via Raidurg metro and Uppal, not MGBS, and explains the skipped MGBS → Uppal traffic;
- with metro deselected, the Fastest route goes via MGBS;
- with every mode filtered out, it returns the no-route message;
- limits, seat-risk notes, the group split at Uppal, and shared cab fares split across the group;
- the planner's budget, diet, closures and edits, and the group merge rules.

```bash
npm run lint
```

```bash
npm run build
```

## Sample data

Everything in `src/data/` is **self-generated sample data, and the UI labels it that way**:
- `hyderabad-graph.json` — 17 places and hubs (Kokapet, CBIT, Raidurg, Ameerpet, Parade Ground, Uppal, MGBS, Dilsukhnagar, LB Nagar, Secunderabad station, Warangal bus and rail, Hanamkonda), with road links, peak factors, metro, city-bus, intercity-bus and train lines, fares and headways. The figures are rounded estimates seeded from the example above. Keep the same shape to swap in real data (GTFS, OSM distances, fare tables).
- `places.json` — 45 curated places in Hyderabad and Jaipur with hours, closures, dwell time, cost, tags and diet. Re-verify before real use.

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
