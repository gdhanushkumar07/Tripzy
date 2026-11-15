import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Uses the existing isolated database harness and the installed Chrome binary.
// Override E2E_WEB_PORT / E2E_API_PORT to leave running development servers alone.
export default defineConfig({
  ...base,
  projects: base.projects?.filter(project => ['public', 'setup', 'app'].includes(project.name || '')).map(project => ({
    ...project,
    use: { ...project.use, channel: 'chrome' },
  })),
})
