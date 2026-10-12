import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/**
 * A smoke test of the online version against a real project (ROADMAP M2.6, M2.7; DESIGN §11.2):
 * the **plain production build** (no dev routes, no `?hb_backend=` override; what Pages deploys)
 * built with a server's public URL and key, served by `vite preview`, and one short session taken
 * through it in Chromium. It is not part of `npm run e2e` or of CI: it talks to the live database,
 * uses one of the five sessions a network address may start in a day, and deletes what it stored
 * with `delete_my_data` at the end.
 *
 *   HB_LIVE_SUPABASE_URL       the project URL (https://<project>.supabase.co); public
 *   HB_LIVE_SUPABASE_ANON_KEY  its anon / publishable key; public. Never the service-role key.
 *   E2E_LIVE_PORT              the preview port (default 4186)
 *
 *   HB_LIVE_SUPABASE_URL=https://example.supabase.co HB_LIVE_SUPABASE_ANON_KEY=the-anon-key npm run e2e:live
 *
 * The build goes to test-results/live/dist, so `dist/` and the ordinary e2e run are left alone.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL_ENV = 'HB_LIVE_SUPABASE_URL'
const KEY_ENV = 'HB_LIVE_SUPABASE_ANON_KEY'
const url = process.env[URL_ENV] ?? ''
const key = process.env[KEY_ENV] ?? ''
if (url === '' || key === '') throw new Error(`${URL_ENV} and ${KEY_ENV} are required: the project's public URL and anon key (this test talks to the live server).`)

const PORT = Number(process.env.E2E_LIVE_PORT ?? 4186)
const BASE = '/humanbench/'
const ORIGIN = `http://127.0.0.1:${PORT}`
const DIST = path.join(WEB, 'test-results', 'live', 'dist')

export default defineConfig({
  testDir: WEB + '/e2e-live',
  testMatch: '**/*.spec.ts',
  outputDir: path.join(WEB, 'test-results', 'live', 'out'),
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0, // a retry would start another session (5 a day per address)
  reporter: [['list']],
  // An action that cannot be done fails after 20 s, long before the test's own limit, so the spec's clean-up still runs.
  use: { baseURL: `${ORIGIN}${BASE}`, trace: 'retain-on-failure', actionTimeout: 20_000, navigationTimeout: 30_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A plain production build: VITE_HB_DEV_ROUTES is not set, so the page cannot be pointed elsewhere.
    command: `npx vite build --outDir "${DIST}" --emptyOutDir && npx vite preview --outDir "${DIST}" --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: WEB,
    url: `${ORIGIN}${BASE}`,
    env: { VITE_BASE: BASE, VITE_HB_SUPABASE_URL: url, VITE_HB_SUPABASE_ANON_KEY: key, VITE_HB_DEV_ROUTES: '' },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
