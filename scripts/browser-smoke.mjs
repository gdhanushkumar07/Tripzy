// Public-page regression checks against real built assets. No user data or mocked APIs.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(`${root}platform/client/package.json`)
const { chromium } = require('@playwright/test')
const output = process.env.SMOKE_OUTPUT || '/tmp/tripzy-browser-smoke'
await mkdir(output, { recursive: true })
const children = []
const launch = (args, cwd, env = {}) => {
  const child = spawn(process.execPath, args, { cwd: root + cwd, env: { ...process.env, ...env }, stdio: 'ignore' })
  children.push(child)
  return child
}
let browser
const results = []
try {
  launch(['server-dist/index.mjs'], 'travel', { PORT: '18787', HOST: '127.0.0.1' })
  launch(['../node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '15173', '--strictPort'], 'platform/client')
  for (const port of [18787, 15173]) {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/`)).ok } catch { /* starting */ }
      if (ready) break
      await setTimeout(200)
    }
    if (!ready) throw new Error(`Server ${port} failed to start`)
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1440, 1024, 768, 390, 375]) {
    for (const [port, path] of [[15173, '/'], [15173, '/login'], [15173, '/register'], [18787, '/travel/'], [18787, '/travel/login'], [18787, '/travel/credits']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'networkidle', timeout: 60000 })
      // Trigger lazy images and scroll-entry animations before inspecting the page.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.8) {
          window.scrollTo(0, y);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        textLength: document.body.innerText.trim().length,
        brokenImages: [...document.images].filter(i => i.currentSrc && i.complete && !i.naturalWidth).map(i => i.getAttribute('src')),
        testLab: [...document.querySelectorAll('a')].some(a => /test lab/i.test(a.textContent || '')),
      }))
      const result = { width, path, ...state, errors }
      result.pass = !state.overflow && state.textLength > 80 && !state.brokenImages.length && !state.testLab && !errors.length
      results.push(result)
      await page.screenshot({ path: `${output}/${port}-${path.replaceAll('/', '_')}-${width}.png`, fullPage: true })
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${width}px ${path}`, result.pass ? '' : JSON.stringify(result))
      await page.close()
    }
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
  await browser?.close()
  for (const child of children) child.kill('SIGTERM')
}
if (results.some(r => !r.pass)) process.exitCode = 1
