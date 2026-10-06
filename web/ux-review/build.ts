/**
 * `npm run ux:build`: the one shared build the persona specs serve (test-results/ux-review/_dist; UX_DIST overrides): the
 * Pages base path and the dev-only routes (`?fast=1`, `#/dev/*`) compiled in, like the e2e build. It is a script, not an
 * npm one-liner, because `scripts/dev-routes.test.ts` keeps the dev-routes flag out of package.json.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.env.UX_DIST ?? 'test-results/ux-review/_dist'

const run = spawnSync('npx', ['vite', 'build', '--outDir', DIST], {
  cwd: WEB,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: '/humanbench/', VITE_HB_DEV_ROUTES: '1' },
})
if (run.error !== undefined) console.error(`could not run vite: ${run.error.message}`)
process.exit(run.status ?? 1)
