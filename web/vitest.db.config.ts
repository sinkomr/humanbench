import { defineConfig } from 'vitest/config'

/**
 * `npm run test:db` (ROADMAP M2.0): the tests that need a real Postgres. Separate from vite.config.ts
 * so `npm test` never starts a database; the unit project there excludes *.db.test.ts.
 * globalSetup starts one throw-away cluster for the run; each test file clones its own database.
 */
export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['scripts/db/**/*.db.test.ts'],
    globalSetup: ['scripts/db/global-setup.ts'],
    // initdb and the first template take a few seconds; a loaded machine, more.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
})
