import { defineConfig, devices } from '@playwright/test'
import { DEV_BASE, DEV_PORT, REVIEW_URL } from './e2e/dev-server'

/**
 * Playwright + axe-core harness (ROADMAP M1.A, A3; DESIGN §13 accessibility, §14.3 M1 acceptance 4).
 *
 * Every run builds the app and serves the production build with `vite preview` under the Pages base
 * path `/humanbench/` (VITE_BASE is pinned here, so a local `.env` cannot change it), then runs
 * `e2e/*.spec.ts` in desktop Chromium, desktop WebKit and an emulated iPhone 13 (WebKit). A fresh
 * server is started each run, so a stale build is never tested; set E2E_PORT if 4174 is taken.
 * Browsers: `npm run e2e:install`. Run: `npm run e2e` (or `npm run e2e -- --project=webkit`).
 *
 * A second server, the Vite dev server on E2E_DEV_PORT (default 4175), serves the dev-only pages
 * that no production build contains (`e2e/dev-server.ts`): the visual renderer gallery
 * (`render-visual.html`, M1.13, `e2e/render-visual.spec.ts`) and the renderer gallery / G7 review
 * page (`review.html`, M1.13, M1.G7, `e2e/gallery.spec.ts`).
 */

const PORT = Number(process.env.E2E_PORT ?? 4174)
const BASE = '/humanbench/'
const ORIGIN = `http://127.0.0.1:${PORT}`
const CI = Boolean(process.env.CI)
const WEBKIT_TIMEOUT = 90_000

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Headroom over the 30 s / 5 s defaults: a cold WebKit on a loaded machine took 23 s for a page
  // load and timed out inside an axe scan; the tests themselves take about 1 s each.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  // The HTML report (playwright-report/) holds the traces of failed tests: npx playwright show-report.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Trailing slash: page.goto('./') resolves to the base path.
    baseURL: `${ORIGIN}${BASE}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit is the slow engine under load: at load average 8-17 its tests took 20-43 s against the
    // 60 s budget, so both WebKit projects get 90 s (README: avoid overlapping heavy jobs locally).
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, timeout: WEBKIT_TIMEOUT },
    // iOS emulation (WebKit engine, iPhone 13 viewport, touch, mobile UA): CLAUDE.md, M1.22.
    { name: 'iphone', use: { ...devices['iPhone 13'] }, timeout: WEBKIT_TIMEOUT },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `${ORIGIN}${BASE}`,
      env: { VITE_BASE: BASE },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Dev-only pages (import.meta.env.DEV): render-visual.html and review.html (M1.13, M1.G7).
      command: `npx vite --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
      url: REVIEW_URL,
      env: { VITE_BASE: DEV_BASE },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
