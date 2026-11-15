import { afterAll, beforeAll, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { applyTravelWorkspace } from '../../../src/nest/platform/travel-workspace'

let source: Server
let gateway: Server
let origin: string
const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))

beforeAll(async () => {
  source = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ path: req.url, method: req.method, body, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null }))
    })
  })
  const port = await listen(source)
  const app = express()
  applyTravelWorkspace(app, port)
  app.get('/api/health', (_req, res) => res.json({ platform: true }))
  gateway = createServer(app)
  origin = `http://127.0.0.1:${await listen(gateway)}`
})
afterAll(async () => { await close(gateway); if (source.listening) await close(source) })

it('preserves travel request bodies and queries without forwarding platform credentials', async () => {
  const response = await fetch(`${origin}/travel/api/commute/plan?mode=metro`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session=private', authorization: 'Bearer private' }, body: '{"people":2}',
  })
  expect(await response.json()).toEqual({ path: '/travel/api/commute/plan?mode=metro', method: 'POST', body: '{"people":2}', cookie: null, authorization: null })
  expect(response.headers.get('content-security-policy')).toContain('https://*.googleapis.com')
})
it('does not intercept the existing platform API', async () => {
  const response = await fetch(`${origin}/api/health`)
  expect(await response.json()).toEqual({ platform: true })
  expect(response.headers.get('content-security-policy')).toBeNull()
})
it('returns an actionable 503 when the workspace is offline', async () => {
  await close(source)
  const response = await fetch(`${origin}/travel/api/health`)
  expect(response.status).toBe(503)
  expect((await response.json()).error).toContain('existing trips')
})
