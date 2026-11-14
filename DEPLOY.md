# Deploying Tripzy (free)

Tripzy has three parts:

| Part | What it is | Where it can run |
|---|---|---|
| Web app | Static React build (`platform/client/dist`) | **Vercel** (free) |
| Platform API | NestJS + SQLite on disk, websockets, file uploads | A machine with a persistent disk |
| Intelligence engine | FastAPI, JSON files on disk | Same machine as the API (it only listens on 127.0.0.1) |

The API and the engine **cannot run on Vercel**. Vercel functions have no persistent disk (SQLite and the trip files would be wiped) and no websocket support. So Vercel hosts the frontend, and every `/api/*` request is forwarded to wherever the backend runs.

## 1. Frontend on Vercel

`vercel.json` at the repo root already holds the right install/build/output settings.

1. In Vercel: **Add New → Project →** import the GitHub repo.
2. **Root Directory: leave it as the repo root** (`./`). (If you already set it to `platform`, that works too: `platform/vercel.json` has the same settings with paths adjusted.)
3. Framework preset: **Other**. Don't override the build, install or output commands; `vercel.json` sets them.
4. Environment variable (optional but recommended): `VITE_WS_ORIGIN=wss://<your-backend-host>`. This enables live collaboration sync, because Vercel can't proxy websockets.
5. In `vercel.json`, replace every `YOUR-BACKEND-HOST` with your backend's host name (step 2), commit and push.

What was breaking the Vercel build before:
- `platform/package-lock.json` was out of sync with `package.json`, so a clean `npm ci` failed before anything was built (fixed).
- The old config tried to run the API and engine as Vercel services, which can't work (see above).

## 2. Backend: free options

**A. Your laptop + Cloudflare Tunnel (free, no account, data stays on your machine). Best for a hackathon demo.**

```bash
./start.sh                                          # engine + API (+ local web)
cloudflared tunnel --url http://localhost:3001     # prints https://<random>.trycloudflare.com
```

Put that host in `vercel.json` (and in `VITE_WS_ORIGIN`), then push. The quick-tunnel URL changes each time you restart `cloudflared`. A fixed URL needs a free Cloudflare account and a named tunnel.

**B. A free VM** (e.g. Oracle Cloud Always Free). Run `./start.sh` behind any reverse proxy with HTTPS. The disk is persistent, so data survives restarts.

## 3. Backend settings for a Vercel frontend

In `platform/server/.env` on the backend:

```
APP_URL=https://<your-app>.vercel.app            # used for links and the Google sign-in callback
ALLOWED_ORIGINS=https://<your-app>.vercel.app,http://localhost:5173
COOKIE_SECURE=true
```

Google sign-in: in Google Cloud Console → Credentials → your OAuth client, add a second **Authorised redirect URI**:
`https://<your-app>.vercel.app/api/auth/oidc/callback` (keep the localhost one for development).

## 4. Check it

- `https://<your-app>.vercel.app/status` lists every provider and shows whether the backend is reachable.
- Sign in, open a trip and ask the Companion "What's next?".

## 5. The Tripzy engine on Render (required)

The platform service (`platform/Dockerfile`) does **not** contain the Python engine. Without the engine, every `/api/tripzy/*` call returns 502. The Travel DNA questions, recommendations, readiness, money, hotels, the Companion and trip planning then all fail. Deploy it as its own service:

1. Render → **New → Web Service** → this repository.
   - **Root Directory:** `backend`
   - **Runtime:** Docker (uses `backend/Dockerfile`)
   - **Instance:** Free
2. Environment variables on the **engine** service:
   - `TRIPZY_ENGINE_KEY` = a long random string (the container refuses to start without it)
   - optional free keys: `GEMINI_API_KEY`, `GEOAPIFY_API_KEY`, `LITEAPI_KEY`
3. Environment variables on the **platform** service (the existing `tripzy-y6bi` one):
   - `TRIPZY_ENGINE_URL` = the engine's URL, e.g. `https://tripzy-engine.onrender.com` (no trailing slash)
   - `TRIPZY_ENGINE_KEY` = the same value as on the engine
4. Redeploy the platform service. Check that `https://<platform>/api/tripzy/dna/cards` returns 12 questions (not 502).

Note: Render's free disk is temporary, so trips stored by the engine are lost when it restarts or redeploys. Accounts and platform trips live in the platform service.
