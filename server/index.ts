/**
 * Tripzy Node server: the API plus, in production, the built web app on one URL.
 * Run with `npm run dev` (starts it next to Vite) or `npx tsx server/index.ts` (Render, any VM).
 */
import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import app from './app'
import { env } from './lib'
import { loadFeeds } from './transit/gtfs'

// In production the same server also serves the built web app (one URL, no CORS).
const dist = resolve('dist')
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

const port = Number(env('PORT') ?? env('API_PORT') ?? 8787)
const host = env('HOST') ?? '127.0.0.1'
app.listen(port, host, () => {
  const keys = ['OLA_MAPS_API_KEY', 'GEOAPIFY_API_KEY', 'SERPAPI_KEY', 'LITEAPI_KEY', 'TRAVELPAYOUTS_TOKEN', 'GEMINI_API_KEY', 'TAVILY_API_KEY', 'OPENTRIPMAP_API_KEY', 'RAIL_API_KEY'].filter((k) => env(k))
  console.log(`Tripzy API on http://${host}:${port} · feeds: ${loadFeeds().map((f) => f.id).join(', ') || 'none (run npm run gtfs)'} · keys: ${keys.join(', ') || 'none (no-key mode)'}`)
})
