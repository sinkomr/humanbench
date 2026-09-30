import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const SCHEMA_DIR = fileURLToPath(new URL('../schema/', import.meta.url))

/**
 * HTML entry points. Besides the app, the RT timing self-test (ROADMAP M1.23, DESIGN §11.6) is its
 * own page at <base>rt-selftest.html, linked from nowhere prominent, and the "Notes for your AI"
 * builder (Phase AI, ROADMAP AI.5) is <base>notes.html (the Home link comes with M1.15).
 */
export const PAGES: Readonly<Record<string, string>> = {
  index: fileURLToPath(new URL('./index.html', import.meta.url)),
  rt_selftest: fileURLToPath(new URL('./rt-selftest.html', import.meta.url)),
  notes: fileURLToPath(new URL('./notes.html', import.meta.url)),
}

/**
 * The other web/*.html: dev-only pages the dev server serves and no build includes (ROADMAP M1.13,
 * M1.G7): the visual renderer gallery and the renderer gallery / G7 review page. Their entries
 * refuse to run outside `import.meta.env.DEV` (scripts/render-bundle.test.ts, review-build.test.ts).
 */
export const DEV_ONLY_PAGES: readonly string[] = ['render-visual.html', 'review.html']

/**
 * Publishes the repo-root schema/*.json files at <base>schema/ in the build, so the
 * save file's "$schema" URL (DESIGN §8, .../humanbench/schema/save-v1.json) resolves.
 */
function schemaAssets(): Plugin {
  return {
    name: 'humanbench-schema-assets',
    apply: 'build',
    generateBundle() {
      if (!existsSync(SCHEMA_DIR)) return
      for (const name of readdirSync(SCHEMA_DIR)) {
        if (!name.endsWith('.json')) continue
        this.emitFile({
          type: 'asset',
          fileName: `schema/${name}`,
          source: readFileSync(SCHEMA_DIR + name, 'utf8'),
        })
      }
    },
  }
}

/** Whether the build includes the dev-only routes of src/dev/ (see `define` below; M1.16). */
export function devRoutesEnabled(mode: string, env: Record<string, string>): boolean {
  return mode !== 'production' || env.VITE_HB_DEV_ROUTES === '1'
}

// The GitHub Pages project site lives at /humanbench/ (ROADMAP A3).
// Override with VITE_BASE (shell env or .env*), e.g. VITE_BASE=/ for a custom domain.
// The Pages workflow sets it from actions/configure-pages, so a custom domain works too.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/humanbench/').replace(/\/?$/, '/')
  return {
    base,
    plugins: [svelte(), schemaAssets()],
    // Dev-only routes (src/dev/, e.g. the M1.16 blob demo): on in dev and tests, and in a build
    // with VITE_HB_DEV_ROUTES=1 (the Playwright e2e build); a plain production build drops them.
    define: { __HB_DEV_ROUTES__: JSON.stringify(devRoutesEnabled(mode, env)) },
    build: { rolldownOptions: { input: { ...PAGES } } },
    test: {
      // A safety net above vitest's 5 s default, so a busy machine (e.g. the bank's pytest running
      // alongside) does not fail seconds-long tests; heavy tests still set their own timeouts.
      testTimeout: 30_000,
      // Tests named *.dom.test.ts or *.svelte.test.ts run in jsdom; all other *.test.ts (src/ and the
      // Node scripts/ tests: dump CLI, fixture sync, A17) run in node. scripts/**/*.ts are
      // type-checked by tsconfig.scripts.json.
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
            exclude: ['src/**/*.dom.test.ts', 'src/**/*.svelte.test.ts'],
          },
        },
        {
          extends: true,
          resolve: { conditions: ['browser'] },
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: ['src/**/*.dom.test.ts', 'src/**/*.svelte.test.ts'],
          },
        },
      ],
    },
  }
})
