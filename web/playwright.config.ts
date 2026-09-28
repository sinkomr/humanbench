import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright + axe-core harness (ROADMAP M1.A, A3; DESIGN §13 accessibility, §14.3 M1 acceptance 4).
 *
 * Every run builds the app and serves the production build with `vite preview` under the Pages base
 * path `/humanbench/` (VITE_BASE is pinned here, so a local `.env` cannot change it), plus the
 * dev-only routes (VITE_HB_DEV_ROUTES=1, M1.16), then runs
 * `e2e/*.spec.ts` in desktop Chromium, desktop WebKit and an emulated iPhone 13 (WebKit). A fresh
 * server is started each run, so a stale build is never tested; set E2E_PORT if 4174 is taken.
 * Browsers: `npm run e2e:install`. Run: `npm run e2e` (or `npm run e2e -- --project=webkit`).
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
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${ORIGIN}${BASE}`,
    // VITE_HB_DEV_ROUTES=1 also compiles in the dev-only routes (src/dev/, e.g. #/dev/blob, M1.16)
    // so their pages can be tested; the Pages and CI builds leave them out (scripts/dev-routes.test.ts).
    env: { VITE_BASE: BASE, VITE_HB_DEV_ROUTES: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
