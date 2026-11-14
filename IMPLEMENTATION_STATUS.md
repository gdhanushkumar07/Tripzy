# Implementation status

✅ = implemented and verified (browser walk-through and/or automated tests) · 🟡 = partial · ⏳ = not built

## Round 4: cinematic UI/UX transformation (14 Nov 2026)
Design system, motion and every main page redesigned; all features and data flows kept. Verified with Playwright in Chrome (desktop 1440, phones 390/375, tablet 768) and the test suites below.

**Design system** ✅ Warm ivory / deep ink / forest / sage / restrained orange tokens (light + dark) applied app-wide through the existing semantic tokens. Instrument Serif headings + Inter body (self-hosted @fontsource). New sun-over-horizon mark and serif wordmark. Editorial utilities (`tz-display`, `tz-h1..h3`, `tz-kicker`, `tz-chapter`), pill buttons, quieter cards.

**Motion** ✅ GSAP 3.13 + ScrollTrigger + `@gsap/react` (`tripzy/motion.ts`). Every animation is scoped with `useGSAP` and reverted on unmount. Reduced motion renders the final state; verified that 0 storytelling elements stay hidden. Found and fixed: the platform scrolls `<body>` on desktop, which ScrollTrigger cannot track, so Tripzy pages switch to document scrolling while mounted (`useDocumentScroll`) and restore it on exit (verified when navigating to the planner).

**Homepage** ✅ Eight-chapter scroll story:
1. Full-screen Amber Fort hero with image scale, line reveals and parallax.
2. Fragmented-planning collage that converges into a Trip Capsule (one desktop pin; stacked on mobile).
3. Capsule orbit with drawn spokes, plus real, freshly captured app screens.
4. Example day map with a scroll-drawn route, markers, feasibility gauge and energy.
5. Readiness with scroll-ticked checklist and a **live** ECB rate.
6. Companion conversation with typing indicator and an animated Diff Card.
7. Parallax memories collage with a drawn trail.
8. Full-bleed invitation with the natural-language input.

Example content is labelled as such. CTAs verified: "Plan your journey" → /plan, "Discover Tripzy" scrolls to the story, and the final input carries the sentence into the plan brief.

**Photography** ✅ 13 Wikimedia Commons photos of Hyderabad and Jaipur, self-hosted as WebP (960/1920 px, 3.9 MB total), with author and licence recorded in `tripzy/photos.ts` and listed on the new `/credits` page.

**Google sign-in** ✅ "Continue with Google" (Google G, official colours) is now the first action on the login and sign-up cards; the small link under the card was removed. Locally, the full redirect is verified. On the deployed site the backend is configured, but **Google rejects the callback with `redirect_uri_mismatch`**. Add `https://tripzy-five-ashen.vercel.app/api/auth/oidc/callback` to the OAuth client's authorised redirect URIs in Google Cloud Console.

**Dashboard** ✅ Personal journal:
- greeting with the real name
- the next journey as a large photo with countdown, live readiness %, travellers, train and the next step from the readiness checklist
- editorial "My journeys" list
- Travel DNA portrait with trait sliders and weighted interests
- three personalised picks
- recent moments

**Trip Intelligence** ✅ Full-bleed city hero, serif day navigation and the day at a glance. The timeline is one continuous journey line, with numbered stop markers, meal and rest markers, booking bands, quiet travel connectors, and inline Time-Truth flags, Plan B and meal decisions.

**Companion** ✅ Tripzy mark as avatar, a greeting with trip context, typing indicator, GSAP panel entrance, and a bottom sheet with grab handle on phones. The confirm → Diff Card → accept → sync flow is unchanged.

**Readiness, Money, Hotels, Memories** ✅ Four distinct compositions:
- **Readiness:** countdown and progress workspace, and a dark "suitcase".
- **Money:** big total, category bar, day-by-day bars and a converter.
- **Hotels:** photo comparison with distance from the stay area and a lowest-price tag.
- **Memories:** journal with lead photo, pull-quote story and masonry highlights.

**Fixes found along the way**
- **Ripple Engine:** "tired" / "stay longer" before the day's first stop inserted blocks out of time order. The engine now refuses them with a clear message (new test).
- **Demo seed:** `seed_demo.py --reset` rebuilds the demo trip.

**Mobile** ✅ No horizontal overflow on 13 routes at 390, 375 and 768 px (the Money tab overflowed at first and was fixed). No hover-only actions; safe-area padding on the Companion sheet.

**Tests:**
- Engine: 29/29.
- Client: `tsc` 0 errors; production `vite build` passes.
- Login page suites: 170/170. Three SSO tests were updated to the new button and still check the link, invite and remember flags and register mode.
- Server: `tsc` 0 errors.
- Browser acceptance: CTAs, reduced motion, scroll-mode cleanup, readiness tick persisting across reload, LiteAPI hotels (6), no uncaught page errors.

## Round 3: free-tier travel companion (14 Nov 2026)
Verified in a real browser as the demo user and/or with automated tests:
- **Companion** (floating "Ask Tripzy" panel) ✅ Answered "what's next", "will it rain" (Open-Meteo), and "find a pharmacy nearby" (two real pharmacies in Nampally via Geoapify). "We're running 30 min late" was auto-applied as a small change. "I'm tired" went confirm → Diff Card (feasibility 90 → 75) → accept → synced into platform Day 1 (Karachi Bakery rest stop added). An open question was answered by Gemini, grounded in the trip.
- **Readiness Centre** (`/trips/:id/ready`) ✅ Checklist auto-checks booking, documents and stay, and saves manual ticks. Packing list derived from weather, stops, party and bookings; "Add to packing list" wrote 11 items into the platform trip. City guide: 112 + city emergency numbers, official .gov.in links, review date and "confirm at source" disclaimer.
- **Money** ✅ Full-trip estimate by category (tickets/food/transport/stay), per-person split, by-day planned vs spent, live ECB rates (Frankfurter → open.er-api fallback), currency converter. Group splitting and settle-up use the platform budget (linked).
- **Hotels** ✅ LiteAPI sandbox: 6 real Hyderabad hotels with photos, ratings, room, refundability; labelled "test prices, not bookable".
- **Memories** ✅ Stats, highlights with photos, adaptations, learnings; Gemini trip story written from trip facts only (~30 s).
- **Ticket photos (OCR)** ✅ Local Tesseract 5.5.4. A rendered e-ticket image gave PNR, train number, date, time and station.
- **Google sign-in** 🟡 Credentials configured; redirect verified (PKCE + state + nonce), and Google accepts the client and callback. The last step needs a real Google account.
- **Flights** 🟡 Adapter built (`/api/tripzy/flights`); Travelpayouts key not provided, so it reports "not configured".
- **Group voting** ⏳ Not built. Collaboration uses the platform's members and budget split.
- **Phone width** ✅ All four Readiness tabs at 390 px, no horizontal overflow.
- **Cleanup / deploy** ✅ Old `frontend/` (first prototype), Helm charts, Unraid/Sonar/MinIO files and TREK's CI workflows removed. Lockfile fixed, frontend-only `vercel.json`, websocket origin configurable (`VITE_WS_ORIGIN`). See DEPLOY.md. The exact Vercel install + build commands pass from a clean checkout.

## Verified end-to-end journey (round 2) (fresh browser session, 14 Nov 2026)
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
| Documents | ✅ | Ticket upload → trip files (access-controlled) + PDF/text parsing + photo OCR (Tesseract) |
| Provider health | ✅ | `/status`: OSRM, Open-Meteo, Wikipedia, Frankfurter, Gemini, Geoapify, LiteAPI, Travelpayouts, Tesseract, matrix cache, places catalogue, Claude (optional), train feed (simulated) |
| Demo environment | ✅ | Separate non-admin `demo@tripzy.app`, seeded by `backend/scripts/seed_demo.py`; trips titled `[Demo]`, excluded from stats |
| Test Lab | ✅ | 6 scenarios; events labelled simulated |
| Group DNA merging | ⏳ | Platform collaboration only |
| Memories summary | ✅ | Tripzy recap + optional Gemini story; photos/journal in platform Journey |
| Places API | ✅ | Curated verified catalogue (2 cities) for planning + live Geoapify search for nearby essentials |
| Currency conversion | ✅ | Live ECB rates in Money tab and Companion |

## Tests
- Engine: **28/28** pytest (flow, platform bridge, security/isolation, trust boundary, date parsing, readiness, companion intents + confirmation, finance, recap, OCR path).
- Client: `tsc --noEmit` 0 errors; `vite build` OK. Server: `tsc --noEmit` 0 errors; boots with the route-guard ratchet passing.
