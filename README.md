# Tripzy: Your journey. Intelligently orchestrated.

Tripzy plans the **trip**, protects the **travel**, and keeps improving the **experience**.
It is built from two parts that work as one product:

| Part | Folder | What it does |
|---|---|---|
| **Tripzy Platform** | `platform/` | Product shell. Built on TREK (open source, AGPL-3.0): accounts, My Trips, map planner with drag-and-drop days, budget/wallet, bookings, files, collaboration and sharing, Journey (memories), Atlas (explore map), PWA, light/dark. Rebranded for Tripzy, with the Tripzy modules added. |
| **Tripzy Intelligence** | `backend/` | FastAPI + LangGraph engine. Handles Travel DNA, the itinerary composer, Time-Truth feasibility, the energy budget, Shadow Itinerary (Plan B), decision cards, the Ripple Engine (live re-planning) and self-learning. Planning is deterministic: the LLM never invents places, times or prices. |

The two halves are joined by `platform/client/src/tripzy/bridge.ts`:
- A Tripzy plan is written into a real platform trip: places, day assignments with times, budget lines and the train/flight booking.
- Every accepted re-plan re-syncs the affected days in that trip.
- Edits made in the planner can be sent back for re-checking ("Re-check Day N edits").

## Run it

```bash
# one-time
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt && cd ..
cd platform && npm install && cp server/.env.example.tripzy server/.env   # then set ENCRYPTION_KEY
cd ..

./start.sh            # engine :8000 + platform API :3001 + web :5173
```

Open **http://localhost:5173**. Visitors land on **Plan with AI** and need no account to plan.
Demo login: **demo@tripzy.app / Tripzy@2026**. The account is seeded on first run from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

Tests: `cd backend && .venv/bin/python -m pytest -q` (12 end-to-end API tests).
Client checks: `cd platform/client && npx tsc --noEmit -p . && npx vite build`.

## Navigation

| Tab | Route | Purpose |
|---|---|---|
| My Trips | `/dashboard` | All trips (platform) |
| Plan with AI | `/plan` | One sentence or voice, editable brief, 12-card Travel DNA swipe, live agent pipeline, preview, then save as a real trip (sign-in is asked for only at save) |
| Trip Intelligence | `/trips/:id/intel` | Feasibility score and energy per day, timeline with photos and "why", inline risk flags, Plan B, meal decision cards, stay decision card, real-road map, Time-Truth checks, bookings as fixed anchors, chat edits ("my father can't climb"), re-check of planner edits |
| Planner | `/trips/:id` | The platform map planner. Header buttons jump to Tripzy Intelligence or Live |
| Live | `/live` → `/trips/:id/live` | NOW / NEXT, leave-by countdown, Navigate, opt-in geolocation. Running late, tired, stay longer, skip, closed, rain, train delay and budget exceeded all go to the Ripple Diff Card, where you accept or keep the original. Also stop reactions (learning) and the Trip Wallet |
| Travel DNA | `/dna` | Traits and interest weights (start of trip vs now), group energy limiter, learning history, "apply learning to upcoming days" |
| Explore Map | `/atlas` | Platform atlas |
| Memories | `/journey` | Platform journal and photo book |
| Test Lab | `/lab` | Six one-click scenarios against a real trip: train +2 h, heavy rain, tired, closure, +1 h stay, budget exceeded. Shows the processing pipeline, before/after timelines, accept/reject (accept persists and syncs), and event history |

## How the engine thinks (all deterministic, all testable)

- **Composer**: picks the next stop greedily. The score combines DNA match, best-time window, real OSRM road time, wait time, crowd peaks, rain, heat and energy. Meals and rests are inserted by clock and energy. An evening "golden hour" bonus slot is used when a place's best window is at dusk.
- **Time-Truth**: checks opening hours, weekly closures, fixed show slots, tight connections, energy, time in transit and late finishes. The result is a 0–100 score with stated reasons.
- **Energy**: intensity × duration, ×1.5 for stairs with seniors and ×1.3 for midday heat on outdoor stops. The weakest traveller sets the group's daily budget.
- **Ripple Engine**: re-times the rest of the day with the same simulator. Hotel downtime absorbs delays first. Low-value stops are trimmed to keep meals on time, moved to a later day if they fit there, and dropped only as a last resort. Fixed bookings never move unless the booking itself is delayed.
- **Learning**: reactions nudge interest weights and pace with transparent rules. This is not a trained ML model, and the app says so. Real dwell times are pooled into collective stay-time estimates.

## Data honesty

- **Places**: a curated, verified catalogue (Hyderabad 27, Jaipur 19) with hours, closures, best times and costs. Each place carries a `verified_at` date. Re-verify before production.
- **Photos**: Wikipedia/Wikimedia page images, fetched live with attribution.
- **Weather**: Open-Meteo forecast within 16 days, otherwise labelled "seasonal average".
- **Routes**: OSRM public server (cached). Self-host OSRM for production.
- **Train status**: no free Indian Railways API exists, so this is a deterministic **simulated** feed, labelled in the UI. All Test Lab and Live demo-clock events are labelled as simulated.

## Known limitations

- The `/engine` route reaches the engine through the Vite dev proxy. In production, put a reverse proxy in front (`/engine` → `:8000`, rewriting the prefix to `/api`).
- The engine API has no auth of its own yet. Capsules are addressed by unguessable ids. Next step: verify the platform session on the engine.
- Two cities in V1. Group voting and veto tokens are not built; the group is handled through the traveller list and energy limiter, and through the platform's collaboration features.
- Place OCR from uploaded tickets uses the platform's booking import (needs the optional KItinerary extractor). Tripzy's own parser reads pasted ticket text.

## Credits and licences

- Platform: **TREK** by mauriceboe (AGPL-3.0). Its licence and notices are kept in `platform/LICENSE` and `platform/NOTICE.md`. The modified source is this repository.
- Agent-graph and streaming pattern adapted from **PlannerAgent** (SuperLuJC).
- Routing: **OSRM**. Maps: **OpenStreetMap / CARTO**. Weather: **Open-Meteo**.
