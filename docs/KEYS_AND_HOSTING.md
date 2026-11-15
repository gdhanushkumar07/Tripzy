# Keys and keeping Tripzy online

All keys go in `.env` at the repo root (git-ignored). Restart `npm run dev` after editing it. Check what is active at http://localhost:5173/api/health.

## What is already set

| Key | Status | Used for |
|---|---|---|
| `GEMINI_API_KEY` | set | AI reading of live web news — needs `TAVILY_API_KEY` too |
| `GEOAPIFY_API_KEY` | set | Restaurants with vegetarian tags and opening hours; backup place search |
| `LITEAPI_KEY` | set (sandbox) | Hotel rates in “Where to stay” — sandbox prices are labelled as test prices |
| `TAVILY_API_KEY` | set | Live web/news checks for tour places (with Gemini) |
| `OLA_MAPS_API_KEY` | set but **answers 401** | Open https://maps.olakrutrim.com → your project → make sure the key is active and Places + Routing APIs are enabled |
| `TRAVELPAYOUTS_TOKEN` | empty | Real flight fares — paste the API token from Travelpayouts → Tools → API |
| `OIDC_*`, `VITE_AI_PLANNER_URL` | not used | Left over from the old app — safe to delete |

## Keys still needed (all free, no card unless noted)

### 1. Firebase project — real accounts, Google sign-in, cloud storage (most important)
1. Go to https://console.firebase.google.com → **Add project** (Google Analytics: off is fine).
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password** and **Google** (pick a support email, Save).
3. **Build → Firestore Database → Create database** → production mode → region `asia-south1` (Mumbai).
4. **Project settings (gear) → Your apps → `</>` Web** → register "Tripzy" → copy the config into `.env`:
   ```
   VITE_FIREBASE_API_KEY=<apiKey>
   VITE_FIREBASE_AUTH_DOMAIN=<authDomain>
   VITE_FIREBASE_PROJECT_ID=<projectId>
   VITE_FIREBASE_APP_ID=<appId>
   VITE_USE_EMULATORS=false
   ```
5. Deploy the security rules once:
   ```bash
   firebase deploy --only firestore:rules --project <projectId>
   ```
6. After hosting (below), add your public domain under **Authentication → Settings → Authorised domains**.

The Firebase web `apiKey` is not a secret (it identifies the project); access is protected by the Firestore rules.

### 2. Tavily — live web/news search (turns Gemini checks on)
https://app.tavily.com → sign up → copy the key → `TAVILY_API_KEY=` (1,000 searches/month free).

### 3. Ola Maps — traffic-aware road times across India (strongly recommended)
https://maps.olakrutrim.com → sign up → Dashboard → **Create project** → copy the API key → `OLA_MAPS_API_KEY=`.
100,000 free calls/month per API. Fixes the biggest accuracy gap: live traffic instead of estimated peak factors.

### 4. SerpApi — live flight and hotel prices (replaces OpenTripMap / indianrailapi)
https://serpapi.com/users/sign_up → sign up with Google or e-mail (no card) → Dashboard → **Your private API key** → `SERPAPI_KEY=`.
250 searches/month free; results are cached 3 h (flights) and 6 h (hotels) so a demo uses only a few. One key gives Google Flights and Google Hotels, and its dashboard shows every call and the remaining quota.

### 5. Travelpayouts — flight fares without per-search limits (optional)
https://www.travelpayouts.com → sign up → **Tools → API** → copy the token → `TRAVELPAYOUTS_TOKEN=` (and the Partner ID as `TRAVELPAYOUTS_MARKER=`). Real fares seen in the last 48 h; booking links earn commission.

Public transport worldwide (Transitous), airports (OurAirports), time zones and weather (Open-Meteo) need no key.
Trains in India stay a labelled estimate with prefilled ixigo/ConfirmTkt searches; a RapidAPI IRCTC key is the next step if you want live schedules.

## Keeping the server up

Tripzy is one Node server (`server/`) that also serves the built web app.

### For the demo: your laptop
```bash
npm run dev
```
Keep the terminal open; with emulators (`npm run emulators`) everything runs offline-capable on your machine.

### Online, free: Render (one URL for web + API)
1. Push the `main` branch to GitHub.
2. https://render.com → sign in with GitHub → **New → Blueprint** → choose the repo. It reads `render.yaml`.
3. Fill in the secret values it asks for (the same values as your `.env`; the Firebase ones are required).
4. Deploy. The build also downloads the metro/bus timetables. Your app is at `https://tripzy-xxxx.onrender.com`.
5. Add that domain to Firebase **Authorised domains** (step 1.6).

Render's free plan sleeps after 15 minutes without traffic (first request then takes ~50 s). To keep it awake, create a free monitor at https://uptimerobot.com that calls `https://<your-app>.onrender.com/api/health` every 10 minutes. Or use Render's Starter plan ($7/month) for an always-on server.

Alternatives with the same start command (`npx tsx server/index.ts`, env `HOST=0.0.0.0`): Railway, Fly.io, or any VM.
