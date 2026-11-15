import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const port = '18787'
const server = spawn(process.execPath, ['server-dist/index.mjs'], {
  cwd, env: { ...process.env, PORT: port, HOST: '127.0.0.1' }, stdio: 'ignore',
})
const origin = `http://127.0.0.1:${port}`
try {
  let ready = false
  for (let n = 0; n < 50; n++) {
    if (server.exitCode !== null) throw new Error('Workspace server exited before becoming ready')
    try { ready = (await fetch(`${origin}/travel/api/health`)).ok } catch { /* starting */ }
    if (ready) break
    await setTimeout(100)
  }
  assert.ok(ready, 'health endpoint must become ready')
  const page = await fetch(`${origin}/travel/tour/saved-trip`)
  const html = await page.text()
  assert.equal(page.status, 200)
  const asset = html.match(/src="(\/travel\/assets\/[^\"]+\.js)"/)
  assert.ok(asset, 'nested route must load namespaced assets')
  assert.equal((await fetch(`${origin}${asset[1]}`)).status, 200)
  for (const path of ['/travel/theme.js', '/travel/stories/jal-mahal.webp', '/travel/icon.svg', '/travel/showcase/intel.png', '/travel/showcase/live.png', '/travel/showcase/ready.png']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 200, path)
  }
  assert.equal((await fetch(`${origin}/travel/api/missing`)).status, 404)
  console.log('PASS: health, nested-route refresh, JS bundle, theme, photo, icon, API 404')
} finally {
  server.kill('SIGTERM')
}
