# Tripzy reconciliation — 15 November 2026

## Result and limits

The original platform and Python intelligence engine are retained. All 127 files
from the remote snapshot are imported into `travel/`, with namespace, navigation,
configuration and deployment adaptations. The combined application offers the
original experience plus a connected Firebase travel workspace at `/travel/`.
This is an additive source integration, **not a completed acceptance certification**.
Accounts and saved data remain separate; no data migration or single sign-on has
been implemented. Live account/provider and browser workflows still require verification.

## Git safety

- Previous local HEAD: `8769b3bd8fbc52d06e9c47651fa86d9638e5bae1`.
- Imported remote: `origin/main`, `cf326f6a75f71a5b85c3557af089cf538b483418`.
- Remote: `https://github.com/gdhanushkumar07/Tripzy.git`.
- Comparison: 0 local-only and 14 upstream-only commits. Fetch succeeded; those
  upstream commits were already present in the local remote-tracking reference.
- Original branch: `main`, tracking `official/main` (a different repository),
  ahead of that tracking branch by two commits. Neither remote was changed.
- Work branch: `integration/preserve-platform-20261115`.
- Backup branch: `backup/reconcile-20261115-1715`.
- Additional backup: `../tripzy-recovery-20261115/history.bundle` and
  `local-state.tar.gz`. The archive includes ignored local configuration/data;
  it is private (0600 inside a 0700 directory). Do not upload it.
- Initially no tracked changes, non-ignored untracked files, or stashes.
- No original tracked files deleted. No reset, clean, stash, merge commit, commit,
  push, or history rewrite. Changes are deliberately uncommitted.
- Strategy: import the remote tree separately rather than accepting its removal
  of the platform and engine. There were no textual merge conflicts; architecture,
  route namespace, authentication and deployment conflicts were reconciled explicitly.
- `RECONCILIATION.json` lists every imported file and its destination.

## Feature reconciliation

“Preserved” and “imported” describe source inclusion, not a successful live workflow.

| Feature | Local implementation | Remote implementation | Decision |
|---|---|---|---|
| Editorial homepage, photos, fonts, theme | Existing platform | New intro and story | Preserve both; fix namespaced photos/assets |
| Accounts, login, Google OAuth, sessions | Existing platform auth | Firebase Auth | Retain both; explain separate sign-in; no identity guessing |
| Onboarding and Travel DNA | Platform pages + Python DNA engine | 12-question tourist questionnaire | Preserve DNA; import questionnaire and draft resume |
| Dashboard, My Trips, settings, profiles | Platform + existing database | Firebase routes/trips/preferences | Preserve old data; import new dashboard without schema migration |
| AI brief and personalized planning | Platform + Python planner | Tourist generation and tool-driven AI chat | Preserve engine; import remote planner/chat |
| Day schedules, editing, save/update | Existing trip planning | Autosaved tour stops, reorder/swap/undo | Retain both models and workflows |
| Routing and transport | Existing routing engine | Multilabel routing, metro fares, own vehicle, four ranked choices | Import all remote algorithms and APIs |
| Global journeys | Existing booking/transport tools | Flights/trains/buses, Transitous, door-to-door transfers | Import journey planner and booking links |
| Group travel | Platform collaboration | Split journeys, multiple starts/meeting point, live group tours | Import group logic; fix invite URL prefix |
| Budget and currency | Engine finance and platform budgets | Journey/tour costs, FX endpoint | Preserve existing; namespace remote API |
| Live Companion and replanning | Companion, alerts, nearby, ripple | Replan from current location and missed connections | Preserve engine; import remote commute replanning |
| Feasibility, shadows, backup plans, readiness | Python modules + readiness page | Smaller remote scope | Preserve entire local implementation |
| Weather, opening hours, air quality | Existing weather providers | Live tour/weather checks | Keep both provider paths |
| Explore Map | Platform Atlas | Leaflet route/journey maps | Preserve Atlas; import route maps |
| Memories and journals | Platform Journey | Not equivalent | Preserve platform |
| Documents, tickets, OCR | Platform uploads + Python parsing | Not equivalent | Preserve platform and upload rewrites |
| Hotels | Existing engine | Destination hotels and booking providers | Keep both |
| Notifications | Existing platform | Group plan notifications/status | Preserve/import respectively |
| Offline behavior and PWA | Existing service worker | Firebase cache and local drafts | Preserve PWA; exclude `/travel` from platform SPA fallback |
| Enabled add-ons | Desktop filter hid most enabled add-ons | Minimal remote scope | Restore desktop access to enabled add-ons |
| Test Lab | Already development-only `/lab` | Absent | Keep internal utility; exclude lab add-ons from desktop/mobile navigation |
| Data export/deletion, AI history/taste | Different platform workflows | Firebase user data tools, retrieval and history | Import; retain user-scoped collections |

## Implementation changes

- `travel/`: upstream source and lockfile, retained together so its React/Firebase/
  Express dependencies do not alter platform workspace dependency resolution.
- `Navbar.tsx`, `BottomNav.tsx`, `PublicLayout.tsx`: travel entry links; full-document
  navigation between bundles; original add-on access restored.
- `platform/client/vite.config.js`: development `/travel` proxy and service-worker
  navigation exclusion. Travel Vite uses port 5174 with strict port checking.
- `platform/server/src/nest/platform/travel-workspace.ts` and `bootstrap.ts`:
  streaming loopback gateway on `/travel`, mounted before platform routes/body
  parsing. Existing `/api` remains untouched. Platform cookies/Authorization are
  not forwarded; the travel service has its own public planning API and IP limit.
  Travel-specific CSP permits Firebase; platform CSP is unchanged. Downstream
  errors return an actionable 503. Firebase auth data goes directly to Firebase.
- Travel router, API wrapper, group invites, pictures, theme and standalone server
  consistently use `/travel/`. The standalone API is `/travel/api/*`.
- Travel reads the existing ignored `api-keys.env`, without copying or overwriting
  it. Existing process environment wins; local `.env` loads first. Only Vite public
  variables are exposed to the browser. Missing production Firebase configuration
  shows an honest setup screen rather than automatically using local emulators.
- `travel/firestore.rules`: removed the broad recursive user write grant that
  bypassed draft/route/trip validation. Only chats/history receive the generic
  owner-only grant. These rules have **not** been deployed or emulator-tested.
- `start.sh`: launches platform, engine and travel workspace together.
- `Dockerfile` and engine entrypoint: build/copy/start the travel service privately
  on port 8787. Container build/start has not been executed here.
- Platform Vercel rewrites forward `/travel/*` to the configured Render host.
  Travel's standalone Vercel/Render configurations also use the namespace.
- No existing database schema or dependency version changed. Remote dependencies
  were installed from its lockfile. Added scripts only; no dependency upgrades.

## Local use and deployment

From `tripzy/`, run `./start.sh`; open `http://localhost:5173` and choose
**Daily Traveller**. Direct workspace development is `http://localhost:5174/travel/`.
Its menu links back to existing trips, DNA and memories.

`api-keys.env` already contains the required Firebase variable names. Remote
Firebase service enablement, allowed domains and rule deployment are not verified.
Production builds require `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` **at build time** (Docker ARGs).
Do not pass private provider keys as Vite variables. Provider keys remain runtime
server environment values. Use Node 24.15+; installed Firebase packages warn that
the local Node 24.11.1 is below their 24.12 minimum.

The existing Render hostname in `platform/client/vercel.json` is preserved; it must
be running the new backend image before the production travel link can work. No
production deployment or DNS/auth callback change was made. Firebase authorized
domains must include the final frontend domain. For a custom Firebase auth domain,
verify the travel CSP's frame/connect sources match it before deployment.

GTFS indexes are not bundled upstream. Run `cd travel && npm run gtfs -- hmrl tgsrtc`
for metro/bus timetable data before packaging, and refresh feeds deliberately.
The Docker build copies available `server/data` indexes. Without them, do not claim
that timetable-based routes were verified; provider estimates remain estimates.
External hotels, rail, AI, weather and Transitous availability are not guaranteed by
a successful local build. No credentials were invented.

## Actual workflow verification

| Requested workflow | End-to-end status | Evidence / limitation |
|---|---|---|
| Registration | NOT TESTED | No browser/account creation |
| Existing-user login | NOT TESTED | No real account login |
| Google OAuth | NOT TESTED | Provider/domain settings unverified |
| Onboarding | NOT TESTED | Source preserved; no browser completion |
| All Travel DNA questions | NOT TESTED | Existing engine tests pass; UI not exercised |
| Travel DNA persistence | NOT TESTED | No real user persistence round trip |
| AI trip generation | NOT TESTED | Deterministic planner tests pass; no live model run |
| Saving trips | NOT TESTED | No live account database write |
| Editing itinerary | NOT TESTED | Planner tests pass; browser persistence unverified |
| Route/timing calculations | PASS (unit scope) | Remote deterministic routing tests; not live road accuracy |
| Budget calculations | PASS (unit scope) | Existing/remote calculation tests; not real booking prices |
| Live Companion | PASS (engine test scope) | Python companion suite; browser not tested |
| Dynamic replanning | PASS (engine test scope) | Existing engine suite; live providers not tested |
| Weather information | NOT TESTED live | Provider code retained/imported |
| Explore Map | NOT TESTED | No map rendering/browser access |
| Memories | NOT TESTED | Existing source retained |
| Documents/ticket upload | NOT TESTED | No uploaded document |
| OCR | NOT TESTED live | Parsing tests are not a real OCR round trip |
| Hotels | NOT TESTED live | Provider keys/availability unverified |
| Logout/session handling | NOT TESTED | Separate auth stores; no browser cycle |

Responsive visual checks at 1440, 1024, 768, 390 and 375px: **NOT TESTED**.
There is no browser tool in this session. HTTP asset checks cannot certify layout,
photo rendering, overflow, modal behavior or OAuth popups.

## Verification results

Final automated results are recorded below. Full regression failures must be
resolved before claiming all acceptance criteria pass. No deployment, commit or
push is implied by this report.

| Check | Result |
|---|---|
| Remote planner/AI suite | PASS: 59 tests in 5 files |
| New HTTP boundary suite | PASS: 3 tests, run with loopback permission |
| Python engine | PASS: 29 tests |
| Desktop/mobile navigation | PASS: 69 tests |
| Shared library | Initial run: 2,775 passed, 2 locale tests timed out; both affected suites passed on rerun (10 tests, 60-second limit) |
| Travel frontend/API production build and TypeScript | PASS |
| Platform shared/server/client production build | PASS; final client rebuild pending final results below |
| Platform client/server TypeScript | PASS |
| Travel lint | PASS |
| Changed platform server lint | PASS |
| Changed platform client lint | PASS with 18 warnings (including ignored Vite config); zero errors |
| Full platform lint | INCOMPLETE: shared lint passed; server lint exhausted Node heap, so the chained client lint did not run |
| Built travel HTTP smoke | PASS: health, nested refresh, JS, theme, photo, icon, unknown API returns 404 |
| Shell syntax and git diff whitespace | PASS |
| Private key/token value scan of changed/new source | PASS; ignored configuration left untouched |
| Docker image, hosted Vercel/Render, Firebase rules deployment | NOT TESTED / NOT DEPLOYED |

The 3 HTTP tests originally ran with the remote suite (62 total), then moved to
the platform server suite so Express type declarations remain within their own
workspace. They passed again there. Local loopback tests initially hit sandbox
EPERM; the successful reruns used approved loopback access.

## Remaining acceptance work

1. Establish the desired account relationship if a single login/shared trip list
   is required. The current integration deliberately retains both databases.
2. Exercise real Firebase email/Google authentication, offline persistence, group
   invitations, Firestore authorization and deployed rule behavior.
3. Run the listed browser workflows and all five responsive viewport checks.
4. Verify GTFS imports, actual route accuracy, provider availability, hotels,
   weather, live AI calls and real ticket OCR. No mock feature replacements were added.
5. Resolve full-suite failures and rerun the large regression/lint commands with
   sufficient memory and supported Node version. Targeted passes do not override
   unrelated regression failures.
6. Build/run the Docker image with Firebase build arguments, then validate the
   actual frontend host's `/travel` rewrites, CSP, Google callback/domain settings,
   backend availability, and existing trip/upload paths before deployment.
7. Review the uncommitted integration before any commit or push. None was made.
