# Implementation status

Legend: ✅ working and verified in the browser or by tests · 🟡 partial · ⏳ not built

## Audit summary
- **Existing**: the Tripzy V1 engine (FastAPI + LangGraph, 7 tests) and a basic V1 React UI. The old UI is superseded by `platform/`, and `frontend/` is kept only for reference.
- **Reused**: TREK as the product shell (auth, trips, planner, budget, bookings, files, collab, journal, atlas, PWA). PlannerAgent's agent graph and SSE pattern were already in the engine. OpenTripPlanner was not used: the clone is a 2015 Java snapshot and there is no GTFS data for these cities.

## Critical path (all ✅)
1. Create trip from one sentence or voice, without an account ✅
2. Personalize: brief editing + 12-card Travel DNA ✅
3. Generate itinerary (9-agent pipeline streamed live) ✅
4. Map + real-road routes (OSRM) ✅
5. Feasibility + energy per day ✅
6. Save as a Trip Capsule = a real platform trip (places, timed assignments, budget, booking) ✅
7. Simulate a disruption (Live or Test Lab) ✅
8. Re-plan (Ripple Engine) ✅
9. Accept or reject ✅
10. Accepted changes persist in the engine and are re-synced into the platform trip ✅

## Modules
| Module | Status | Notes |
|---|---|---|
| Discover / trip creation | ✅ | Text + voice (Web Speech), examples, demo trip, editable brief, auth only at save |
| Travel DNA | ✅ | Swipe deck, trait and interest weights, group energy limiter, DNA page, learning history |
| Itinerary engine | ✅ | Hours, closures, best time, clustering by travel cost, meals/rests, costs, alternatives |
| Time-Truth | ✅ | 0–100 score, reasons, inline risk flags per stop |
| Energy engine | ✅ | Party-aware budget; "my father can't climb" actually removes stair-heavy stops |
| Shadow itinerary | ✅ | Rain / crowd / tired alternatives per stop, one-tap switch |
| Decision cards | ✅ | Stay area and meals (2–3 options, tradeoffs, Tripzy pick). No queue data is invented |
| Trip Capsule + sharing | ✅ | Platform trip, share links, collaborators, files, export (platform features) |
| Bookings | ✅ | Fixed anchors in the engine plus a platform reservation; ticket-text parsing |
| Trip Wallet | ✅ | Platform budget with categories, charts and settlements; Live quick-expense writes to both |
| Live Companion | ✅ | NOW/NEXT, leave-by, navigate, geolocation (opt-in), real or demo clock |
| Ripple Engine | ✅ | delay · late · rain · tired · extend · closed · skip · over_budget; auto-applies minor shifts |
| Test Lab | ✅ | 6 scenarios, pipeline status, before/after, accept/reject, history |
| Self-learning | ✅ | Reaction → DNA update → "apply to upcoming days" re-tunes and re-syncs |
| Memories | 🟡 | Platform Journey/photo book is available; no Tripzy-generated summary page yet |
| Group travel | 🟡 | Platform collaboration + traveller list; no merged multi-member DNA voting |
| Provider status panel | ⏳ | Sources are labelled inline instead |
| Engine auth | ⏳ | See README, "Known limitations" |

## Verification
- Engine: `pytest` 12/12 passing (brief parsing, closures/diet, edits, train-delay ripple, rain swap, tired + learning, ticket parsing, demo seed, links, resequence, skip, budget swap).
- Client: `tsc --noEmit` 0 errors; `vite build` passes.
- Browser walk-through: visitor plan → login → save → Intelligence page → Test Lab train delay → accept → the platform planner shows the re-timed Day 1 (11:10 start after the 2 h delay).
