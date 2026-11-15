// Reuse the existing ignored configuration without modifying or copying credentials.
try { process.loadEnvFile('.env') } catch { /* environment supplied by host */ }
try { process.loadEnvFile('../api-keys.env') } catch { /* optional local configuration */ }

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/travel/',
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: { '/travel/api': { target: 'http://127.0.0.1:8787' } } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
})
