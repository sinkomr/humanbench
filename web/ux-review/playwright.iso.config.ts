/**
 * The e2e suite (`e2e/*.spec.ts`) in isolation, for fix packages that run beside other workstreams: the
 * base config (`../playwright.config.ts`) with its build dir, output dir and ports made private, so
 * parallel runs never share `dist/`, `test-results/` or 4174/4175. Projects, timeouts, expect and `use`
 * are the base's; the base file itself stays untouched (`scripts/e2e-config.test.ts` pins it).
 *
 *   E2E_PORT      (required) port of this run's `vite preview` (the base's baseURL follows it).
 *   HB_RUN        (required) kebab-case id; build in test-results/iso/<HB_RUN>/dist, output in .../out.
 *   HB_DEV_SERVER 1: also start the Vite dev server (needs E2E_DEV_PORT) and run the dev-only specs
 *                 (gallery.spec.ts, render-visual.spec.ts), which are ignored without it.
 *   E2E_DEV_PORT  port of that dev server (required with HB_DEV_SERVER=1).
 *                 Without HB_DEV_SERVER=1 the a11y routes that live on the dev server are skipped (HB_NO_DEV_SERVER).
 *
 *   E2E_PORT=4607 HB_RUN=fix-a npx playwright test -c ux-review/playwright.iso.config.ts e2e/smoke.spec.ts --project=chromium
 *
 * Snapshot paths do not move: `snapshotPathTemplate` starts at `{snapshotDir}/{testFileDir}`, `snapshotDir`
 * defaults to `testDir`, and `testDir` is the same `web/e2e` here (absolute instead of `./e2e`), so the
 * baselines stay in `web/e2e/*.spec.ts-snapshots/`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { NO_DEV_SERVER_ENV } from '../e2e/dev-server'
import base from '../playwright.config'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function intEnv(name: string, what: string): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') throw new Error(`${name} is required: ${what}.`)
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`${name} must be an integer between 1024 and 65535 (got "${raw}").`)
  return n
}

const PORT = intEnv('E2E_PORT', 'the port of this run\'s preview server, e.g. E2E_PORT=4607')
const RUN = process.env.HB_RUN ?? ''
if (RUN === '') throw new Error('HB_RUN is required: a kebab-case id for this run, e.g. HB_RUN=fix-a (build in test-results/iso/<HB_RUN>/dist).')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(RUN)) throw new Error(`HB_RUN must be kebab-case (lower-case letters, digits, single hyphens), got "${RUN}".`)
const WITH_DEV = process.env.HB_DEV_SERVER === '1'
if (WITH_DEV) intEnv('E2E_DEV_PORT', 'the port of the Vite dev server that HB_DEV_SERVER=1 starts, e.g. E2E_DEV_PORT=4608')
// Without the dev server the routes that live on it (a11y.spec.ts: dev-visual-gallery, dev-review, ...) are skipped, not
// sent to whatever listens on 4175 (e2e/dev-server.ts). The workers load this file too, so they see the same value.
if (WITH_DEV) delete process.env[NO_DEV_SERVER_ENV]
else process.env[NO_DEV_SERVER_ENV] = '1'

const servers = Array.isArray(base.webServer) ? base.webServer : base.webServer === undefined ? [] : [base.webServer]
const [preview, dev] = servers
if (preview === undefined || dev === undefined) throw new Error('web/playwright.config.ts no longer has a preview server and a dev server in that order: update ux-review/playwright.iso.config.ts.')

const DIST = `test-results/iso/${RUN}/dist`

export default defineConfig({
  ...base,
  testDir: path.join(WEB, 'e2e'),
  testMatch: '**/*.spec.ts',
  testIgnore: WITH_DEV ? [] : ['**/gallery.spec.ts', '**/render-visual.spec.ts'],
  outputDir: path.join(WEB, 'test-results', 'iso', RUN, 'out'),
  reporter: [['list']],
  webServer: [
    {
      ...preview,
      command: `npm run build -- --outDir ${DIST} && npm run preview -- --outDir ${DIST} --host 127.0.0.1 --port ${PORT} --strictPort`,
      cwd: WEB,
    },
    ...(WITH_DEV ? [{ ...dev, cwd: WEB }] : []),
  ],
})
