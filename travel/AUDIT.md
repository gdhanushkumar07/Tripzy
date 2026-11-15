# Phase 0 audit (branch `minimal`)

Snapshot commit before any change: `8baa61d`.

## What was in the repo

14,161 tracked files in three parts. None of it used Firebase on the web; auth was TREK's own Express + SQLite server.

### 1. `platform/` — TREK (open-source trip planner, AGPL) rebranded as Tripzy (≈13,900 files)
| Area | What it does |
|---|---|
| `client/` React 19 + Vite + Tailwind + react-router 7 | The web UI (6,700 files incl. ~2,000 tests) |
| `client/android`, `client/ios`, `client/fastlane` | Capacitor native shells, store metadata, widgets |
| `client/e2e` | Playwright help-video and screenshot fixtures |
| `server/` Express + SQLite (3,900 files) | Accounts, trips, bookings, files, budget, collab, websockets, MCP, OAuth server, admin, plugins |
| `shared/` (3,150 files) | Shared zod schemas and i18n for client/server |
| `plugin-sdk/`, `wiki/`, `docs/`, `scripts/` | Plugin SDK, wiki, CI lint scripts |

Platform routes: `/` home, `/login`, `/register`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/oauth/consent`, `/native-handoff`, `/dashboard` (My Trips), `/trips/:id` (map planner), `/trips/:id/files`, `/shared/:token`, `/join/:token`, `/collections`, `/collections/:id`, `/atlas`, `/journey`, `/journey/:id`, `/public/journey/:token`, `/vacay`, `/notifications`, `/settings`, `/admin`, `/plugins/:id`, `/help`, `/help/:slug`, `/credits`, `/privacy`, `/terms`, `/status`.

Tripzy routes added on top (`client/src/pages/tripzy`, `client/src/tripzy`):
| Route / file | What it does |
|---|---|
| `/plan` PlanPage | One-sentence brief → editable brief → 12 Travel DNA either/or cards → 9-"agent" pipeline animation → preview → save as TREK trip |
| `/onboarding` OnboardingPage | Same 12 DNA cards again as onboarding |
| `/dna` DnaPage | DNA traits, learning history |
| `/trips/:id/intel` TripIntelPage | Feasibility score, energy, timeline, Plan B, decision cards, chat edits |
| `/trips/:id/live`, `/live` LivePage | NOW/NEXT, leave-by countdown, ripple re-plans |
| `/trips/:id/ready` TripReadyPage | Checklist, packing, city guide, hotels, currency, trip story |
| `/lab` LabPage | Six simulated disruption scenarios |
| `/` HomePage, InfoPages, PublicLayout | Marketing homepage, about pages |
| DashboardHome | Tripzy dashboard tiles over TREK's My Trips |
| Companion.tsx | Floating chat ("Ask Tripzy"), Gemini for open questions |
| DnaQuestion.tsx, useDnaCards.ts | One question per screen + progress bar |
| IntelTimeline.tsx, RouteMap.tsx, DiffSheet.tsx | Itinerary timeline, map, before/after diff |
| engine.ts, bridge.ts, types.ts | HTTP client for the Python engine; writes plans into TREK trips |
| ui.tsx, motion.ts, photos.ts, GoogleContinue.tsx | UI kit, GSAP animation, Wikipedia photos, Google sign-in |

### 2. `backend/` — FastAPI + LangGraph "Tripzy Intelligence" (Python, 40 files)
| File | What it does |
|---|---|
| `data/cities.py` | **The dummy dataset**: 2 cities, 46 places with hours, cost, tags, diet, best time |
| `engines/dna.py` | 12 DNA cards and their scoring |
| `engines/planner.py` | Greedy day composer (meals, rests, energy, opening hours) |
| `engines/brief.py` | Parses a free-text sentence into a brief |
| `engines/routing.py` | OSRM matrix + peak traffic factor |
| `engines/verify.py`, `shadow.py`, `ripple.py`, `live.py`, `readiness.py`, `companion.py`, `providers.py`, `weather.py`, `trip.py` | Time-Truth, Plan B, live re-planning, simulated train feed, readiness, chat, Gemini/hotel/flight/FX providers, weather, capsule store |
| `main.py`, `graph.py`, `store.py` | API (874 lines), agent graph, JSON store |
| `tests/`, `scripts/` | 29 API tests, seed + smoke scripts |

### 3. Root
`Dockerfile`, `DEPLOY.md`, `IMPLEMENTATION_STATUS.md`, `start.sh`, `start.ps1`, `.dockerignore`, `README.md` — run/deploy glue for the two stacks above.

### Daily Traveller
Not present anywhere.

## KEEP / MERGE / CUT

Rule: keep only what is on the target screen list or directly improves what a user sees or does there.

| Item | Verdict | Why / where it goes |
|---|---|---|
| React + TypeScript + Vite + Tailwind + react-router + Leaflet (stack of `platform/client`) | **KEEP** | Same stack, same versions, now one small app at the repo root |
| `backend/app/data/cities.py` places (46 places, 2 cities) | **KEEP → MERGE** | Moved to `src/data/places.json`, labelled "Sample data" |
| 12-question flow (DnaQuestion + useDnaCards + `dna.py` CARDS) | **MERGE** | One questionnaire at `/tour`: 3 trip questions + 9 personal ones. The DNA-card content becomes pace/interest/crowd/morning questions |
| PlanPage brief + OnboardingPage DNA + DnaPage | **MERGE** | Three places asked the same questions; now only `/tour` |
| `planner.py` (greedy composer, opening hours, meals) | **MERGE** | Ported as the rule-based "Basic plan" generator `src/tour/generate.ts` |
| TripIntelPage + IntelTimeline + RouteMap | **MERGE** | One itinerary page `/tour/:tripId` (day list, cost, edits) |
| DashboardHome + TREK `/dashboard` | **MERGE** | One dashboard `/` |
| TREK login/register/signup/forgot/reset pages | **MERGE** | One `/login` page on Firebase Auth |
| TREK `/join/:token` | **MERGE** | `/join/:code` for commute and tour groups |
| Gemini call (companion) | **MERGE** | Optional AI planner endpoint behind `request()`, with Retry / Basic plan |
| `ui.tsx` toasts, status, loaders | **MERGE** | One `Status` module (banner, save status, toasts, skeletons, confirm), styled with the original tokens |
| Companion chat, DiffSheet, Live, Lab, Ripple, Shadow/Plan B, Readiness, packing, hotels, flights, FX, OCR, weather, trip story, train feed | **CUT** | Not on the target screens |
| Marketing HomePage (intro page), PublicLayout, motion.ts (GSAP), photos.ts + `public/stories` photos, ui.tsx kit, theme tokens and fonts, credits page | **KEEP** (restored in a follow-up) | This is the product's UI. First pass wrongly cut it; it is back in `src/ui/`, `src/pages/HomePage.tsx`, `src/index.css` |
| InfoPages status/privacy/terms | **CUT** | Pointed at the removed engine; only `/credits` is kept (photo licences need it) |
| TREK features: atlas, journey, collections, vacay, files, budget, bookings, packing, todo, roadtrip, tours, ferratas, notifications, admin, plugins, help, settings, OAuth server, MCP, websockets, PDF, studio | **CUT** | Outside scope |
| `platform/server` (Express + SQLite) and `platform/shared` | **CUT** | Replaced by Firebase Auth + Firestore as required |
| `platform/client/android`, `ios`, `fastlane`, Capacitor | **CUT** | Web app only |
| `platform/client/e2e`, ~2,000 TREK unit tests, wiki, docs, plugin-sdk, CI scripts | **CUT** | Test/document code that was cut |
| `backend/` FastAPI, LangGraph, OSRM cache, tests, scripts | **CUT** | Engine logic needed is ported to TypeScript; no Python server needed |
| Dockerfile, DEPLOY.md, IMPLEMENTATION_STATUS.md, start.sh, start.ps1, .dockerignore | **CUT** | Described the cut stacks; replaced by README steps |
| 60+ dependencies (mapbox, maplibre, gsap, dexie, zustand, axios, capacitor, 35 font packages, markdown, …) | **CUT** | Not used by the new screens |

## What gets built
- Daily Traveller: graph JSON, time-dependent multi-objective search, group split, `/commute` page.
- Shared: auth guard, `useDraft`, `request()`, status component, Firestore offline persistence, security rules.
- Dashboard, `/join/:code`, one header.
