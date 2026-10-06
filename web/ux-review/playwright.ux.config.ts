/**
 * Playwright config of the UX review harness: persona specs (`ux-review/personas/*.ux.ts`) drive a
 * PREBUILT app (`npm run ux:build`, one shared dist) served by `vite preview` on a port of their own,
 * so any number of reviewers run side by side without colliding. Nothing here builds the app.
 *
 *   UX_PORT   (required) integer port of this run's preview server; every package has its own 46xx port.
 *   UX_RUN    (required) kebab-case run id; outputs go to web/test-results/ux-review/<UX_RUN>/.
 *   UX_DIST   build dir relative to web/ (default test-results/ux-review/_dist).
 *   UX_REUSE  1: reuse a server that already listens on UX_PORT instead of failing.
 *
 *   UX_PORT=4606 UX_RUN=phone npx playwright test -c ux-review/playwright.ux.config.ts --project=iphone
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')

function port(): number {
  const raw = process.env.UX_PORT
  if (raw === undefined || raw === '') throw new Error('UX_PORT is required: the port of this run\'s preview server, e.g. UX_PORT=4606 (every package has its own 46xx port).')
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`UX_PORT must be an integer between 1024 and 65535 (got "${raw}").`)
  return n
}

function run(): string {
  const raw = process.env.UX_RUN
  if (raw === undefined || raw === '') throw new Error('UX_RUN is required: a kebab-case run id, e.g. UX_RUN=phone. Outputs go to web/test-results/ux-review/<UX_RUN>/.')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw)) throw new Error(`UX_RUN must be kebab-case (lower-case letters, digits, single hyphens), got "${raw}".`)
  return raw
}

const PORT = port()
const RUN = run()
const DIST = process.env.UX_DIST ?? 'test-results/ux-review/_dist'
const BASE = '/humanbench/'
const BASE_URL = `http://127.0.0.1:${PORT}${BASE}`

if (!existsSync(path.resolve(WEB, DIST, 'index.html'))) {
  throw new Error(`No build at ${path.resolve(WEB, DIST)} (index.html is missing): run \`npm run ux:build\` first (from web/).`)
}

export default defineConfig({
  testDir: HERE,
  testMatch: '**/*.ux.ts',
  // A reviewer plays whole sessions and tours dozens of routes in one test.
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: path.join(WEB, 'test-results', 'ux-review', '_pw', RUN),
  use: {
    baseURL: BASE_URL,
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite preview --outDir ${DIST} --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: WEB,
    env: { VITE_BASE: BASE },
    url: BASE_URL,
    reuseExistingServer: process.env.UX_REUSE === '1',
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
