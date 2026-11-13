# Tripzy V1.0: Smarter Travel, Better Experience

Website + installable app (PWA). Tripzy **plans the trip, guards the travel, and tunes the experience**.
It follows the workflow in `../Tripzy_V1_End_to_End_Workflow.txt`.

## Run it

```bash
# backend (Python 3.12, uses uv)
cd backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000          # also serves the built web app

# frontend
cd ../frontend
npm install
npm run build        # -> served by the backend at http://127.0.0.1:8000
npm run dev          # or hot-reload dev server at http://localhost:5173 (proxies /api)

# tests
cd ../backend && .venv/bin/python -m pytest -q
```

Optional: `export ANTHROPIC_API_KEY=...` lets Claude (`claude-opus-5-5`) parse free-text trip briefs.
Without a key, a rule-based parser does the same job, so the demo never depends on an LLM.

## What's in V1 (mapped to the workflow)

| Phase | Feature | Where |
|---|---|---|
| P0 Hook | One sentence -> brief, no signup | `engines/brief.py`, `pages/Home.tsx` |
| P1 DNA | 12-card swipe deck -> Trip DNA; party-aware energy budget | `engines/dna.py`, `pages/Dna.tsx` |
| P3 Compose | Greedy time-window planner: DNA match, best time of day, real road times, crowd/rain/heat, energy | `engines/planner.py` |
| P3 Stay | Stay-area Decision Card (least travel per rupee) | `engines/trip.py::stay_options` |
| P3 Plan B | Shadow itinerary: rain / crowd / tired alternatives for every stop | `engines/shadow.py` |
| P4 Validate | Time-Truth feasibility score 0-100 with reasons; meal Decision Cards; chat edits | `engines/verify.py`, `/edit` |
| P5 Package | Bookings as fixed anchors (paste-ticket autofill), protected connections, offline Capsule | `/bookings`, PWA cache |
| P7 Live | NOW/NEXT, leave-by, Ripple Engine (delay/late/rain/tired/extend/closed) -> Diff Card | `engines/ripple.py`, `pages/Live.tsx` |
| P8 Learn | Reactions update DNA; real stay times feed collective learning; re-tune upcoming days | `dna.learn`, `store.py`, `/retune` |
| Budget | Planned vs spent burn-down, over-budget flag | `/expense` |

The agent pipeline is a **LangGraph** StateGraph that streams each agent's progress to the UI over SSE:
`understand -> profile -> weather -> discover -> stay -> schedule -> shadow -> verify -> package`.

## What we took from the open-source clones (`../gitclones`)

- **PlannerAgent** (SuperLuJC): the multi-agent LangGraph pipeline + SSE streamed progress UX and the
  FastAPI layout. Rewritten in English; Amap swapped for OpenStreetMap. Its LLM-writes-the-whole-plan
  approach was replaced by deterministic engines, so the LLM never invents times or places.
- **TREK** (mauriceboe): design patterns only (trip -> day -> stop model, per-leg transport mode, Leaflet
  map, Zustand, offline-first PWA). No TREK code was copied, so its AGPL license does not apply.
- **OSRM**: real road travel-time matrix per city (public OSRM server, cached to disk; straight-line
  fallback if offline). **OpenTripPlanner**: not used in V1. The clone is a 2015 Java snapshot. Train
  status is a labelled simulator, ready for an NTES/RailYatri partner API.

## Data honesty

- Places, hours and closures live in `backend/app/data/cities.py` (Hyderabad 27 places, Jaipur 19).
  They were compiled from public listings, carry a `verified_at` date, and must be re-verified before production.
- Weather is a live Open-Meteo forecast within 16 days, seasonal averages after that (labelled in the UI).
- Train delays are simulated (labelled). Ripple triggers in Live mode stand in for live feeds during demos.
