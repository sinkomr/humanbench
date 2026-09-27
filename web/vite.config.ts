import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const SCHEMA_DIR = fileURLToPath(new URL('../schema/', import.meta.url))

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

// The GitHub Pages project site lives at /humanbench/ (ROADMAP A3).
// Override with VITE_BASE (shell env or .env*), e.g. VITE_BASE=/ for a custom domain.
// The Pages workflow sets it from actions/configure-pages, so a custom domain works too.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/humanbench/').replace(/\/?$/, '/')
  return {
    base,
    plugins: [svelte(), schemaAssets()],
    test: {
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
