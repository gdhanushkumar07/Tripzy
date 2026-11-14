# Implementation status

✅ = implemented and verified (browser walk-through and/or automated tests) · 🟡 = partial · ⏳ = not built

## Verified end-to-end journey (fresh browser session, 14 Nov 2026)
1. Public homepage at `/` → typed "Jaipur, 2 days with friends…" in the hero ✅
2. Anonymous plan: brief, Travel DNA swipes, 9-agent pipeline, preview with real photos ✅
3. "Sign in to save" → **registered a new account** (Priya) → returned to the draft ✅
4. Saved → real platform trip; the anonymous draft was claimed by Priya's account ✅
5. Dashboard redirected the new user to **onboarding** (7 steps) → saved to the backend ✅
6. Second trip planned from the **saved Travel DNA** (veg, no stairs, couple prefilled, no swipes needed) ✅
7. **Uploaded a ticket file**: stored in the trip's private documents, 7 booking fields extracted ✅
8. Live Companion → simulated train delay +2 h → Diff Card → accepted ✅
9. Accepted re-plan persisted in the engine **and** re-synced into the platform trip (Day 1 now starts 11:10) ✅
10. "Loved it" feedback → trip DNA **and** profile learning history updated ✅
11. Logged an expense → written to the trip's budget ✅
12. Logged out → `/api/tripzy/me/*` returns 401 → logged back in → Priya's own trips, DNA and activity ✅
13. Isolation: as Priya, the demo user's capsule, link and platform trip all return 404 ✅
14. Phone width (390 px): homepage, dashboard, intel, live, DNA, lab, plan and status have no horizontal overflow ✅

## Architecture changes in this round
- **Trust boundary**: the browser never talks to the engine. `/api/tripzy/*` is a NestJS proxy (`server/src/nest/tripzy`) that resolves the session and forwards a keyed user id. The engine (loopback only) rejects requests without `TRIPZY_ENGINE_KEY` and enforces ownership of every capsule, link and profile.
- **Profiles**: per-user Travel DNA (`/api/tripzy/me/profile`) built from onboarding. Composition starts from it, and feedback updates it.
- **OIDC hardening**: a nonce was added to TREK's auth-code + PKCE + state flow and is verified against the ID token.

## Modules
| Area | Status | Notes |
|---|---|---|
| Public homepage | ✅ | Nav, hero with in-page trip input, how it works, 8 differentiators, **real screenshots**, about, footer, privacy, terms, status |
| Email auth | ✅ | Register (`/signup`), login, forgot password, logout (TREK auth: bcrypt, sessions, MFA, rate limits) |
| Google sign-in | 🟡 | Full OIDC integration (code + PKCE + state + nonce). Needs Google credentials; see README. Not tested live without credentials |
| Onboarding | ✅ | 7 steps, skippable, persisted, drives future plans, shown once |
| Dashboard | ✅ | Real greeting, upcoming journey, readiness, quick actions, real stats (demo excluded), activity, DNA discovery, alerts. TREK's currency, timezone and generic widgets removed |
| Itinerary intelligence | ✅ | As before: Time-Truth, energy, Plan B, decision cards, Ripple, learning |
| Documents | ✅ | Ticket upload → trip files (access-controlled) + PDF/text parsing. Photos of tickets need OCR ⏳ |
| Provider health | ✅ | `/status`: OSRM, Open-Meteo, Wikipedia, matrix cache, places catalogue, Claude, train feed (simulated) |
| Demo environment | ✅ | Separate non-admin `demo@tripzy.app`, seeded by `backend/scripts/seed_demo.py`; trips titled `[Demo]`, excluded from stats |
| Test Lab | ✅ | 6 scenarios; events labelled simulated |
| Group DNA merging | ⏳ | Platform collaboration only |
| Memories summary | 🟡 | Platform Journey/journal; no Tripzy-generated recap yet |
| Places API | 🟡 | Curated verified catalogue (2 cities) + Wikipedia photos. No live Places provider is configured (needs a keyed provider) |
| Currency conversion | — | Removed from the dashboard rather than shown with stale rates |

## Tests
- Engine: **18/18** pytest (flow, platform bridge, security/isolation, trust boundary, date parsing).
- Client: `tsc --noEmit` 0 errors; `vite build` OK. Server: `tsc --noEmit` 0 errors; boots with the route-guard ratchet passing.
