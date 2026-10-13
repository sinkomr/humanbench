import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/**
 * The online version in real browsers against the real local database (ROADMAP M3.11 phase 1, M2.0,
 * M2.7; DESIGN §11.2): the Playwright build of the app (`?hb_backend=` allowed) pointed at the
 * PostgREST stand-in of `e2e-db/server.ts`, which runs every call as the anon role on a throw-away
 * PostgreSQL with `supabase/migrations`. Chromium, WebKit and an emulated iPhone, as `npm run e2e`.
 * Not part of `npm run e2e`: it needs the embedded PostgreSQL (`npm run test:db` has the same need).
 *
 *   npm run e2e:db
 *
 *   E2E_DB_APP_PORT  the preview port (default 4187)
 *   E2E_DB_PORT      the first of the database ports (default 4188; the others are +1 and +3, see server.ts)
 *
 * The build goes to test-results/db/dist, so `dist/` and the ordinary e2e run are left alone.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.E2E_DB_APP_PORT ?? 4187)
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 4188)
const BASE = '/humanbench/'
const ORIGIN = `http://127.0.0.1:${PORT}`
const DIST = path.join(WEB, 'test-results', 'db', 'dist')
const WEBKIT_TIMEOUT = 180_000

export default defineConfig({
  testDir: path.join(WEB, 'e2e-db'),
  testMatch: '**/*.spec.ts',
  outputDir: path.join(WEB, 'test-results', 'db', 'out'),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `${ORIGIN}${BASE}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, timeout: WEBKIT_TIMEOUT },
    { name: 'iphone', use: { ...devices['iPhone 13'] }, timeout: WEBKIT_TIMEOUT },
  ],
  webServer: [
    {
      command: `npx vite build --outDir "${DIST}" --emptyOutDir && npx vite preview --outDir "${DIST}" --host 127.0.0.1 --port ${PORT} --strictPort`,
      cwd: WEB,
      url: `${ORIGIN}${BASE}`,
      env: { VITE_BASE: BASE, VITE_HB_DEV_ROUTES: '1' },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx tsx e2e-db/server.ts',
      cwd: WEB,
      url: `http://127.0.0.1:${DB_PORT + 1}/ready`,
      env: { E2E_DB_PORT: String(DB_PORT) },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
    },
  ],
})
