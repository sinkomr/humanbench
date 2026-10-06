import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { loadEnv, runnerImport, type Plugin } from 'vite'
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

/** Days after which the destination data of the notes builder counts as out of date (`src/brief/surfaces.ts`, `STALE_AFTER_DAYS`; a test keeps the two equal). */
export const SURFACES_STALE_AFTER_DAYS = 120

/**
 * The warning for a build made on `today` (`YYYY-MM-DD`) when `src/brief/surfaces.json` was last
 * checked on `checked`, or null while it is fresh (ROADMAP AI.4; R-17.10). The build only warns:
 * out-of-date install steps are a reminder to re-check the menus, not a reason to fail unrelated work.
 */
export function surfacesStaleWarning(checked: string, today: string): string | null {
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checked}T00:00:00Z`)) / 86_400_000)
  if (days <= SURFACES_STALE_AFTER_DAYS) return null
  if (!Number.isFinite(days)) return `src/brief/surfaces.json has an unreadable "checked" date (${checked}); it must be YYYY-MM-DD.`
  return `src/brief/surfaces.json was last checked on ${checked}, ${days} days ago (limit ${SURFACES_STALE_AFTER_DAYS}). Re-check the install steps and limits of each destination and update "checked".`
}

/** Warns in the build log when the notes builder's destination data is more than 120 days old. */
function surfacesStaleness(): Plugin {
  return {
    name: 'humanbench-surfaces-staleness',
    apply: 'build',
    buildStart() {
      const file = fileURLToPath(new URL('./src/brief/surfaces.json', import.meta.url))
      const checked = (JSON.parse(readFileSync(file, 'utf8')) as { checked?: unknown }).checked
      if (typeof checked !== 'string') return this.warn('src/brief/surfaces.json has no "checked" date.')
      const warning = surfacesStaleWarning(checked, new Date().toISOString().slice(0, 10))
      if (warning !== null) this.warn(warning)
    },
  }
}

/** The words of the static welcome shell of index.html (UX-100): the app's own constants, by name. */
export const SHELL_TEXT_NAMES = ['WELCOME_HEADING', 'WELCOME_TAGLINE', 'WELCOME_INTRO', 'DISCLAIMER'] as const
export type ShellText = Readonly<Record<(typeof SHELL_TEXT_NAMES)[number], string>>

/** The mark of a page that has the shell (index.html only). */
export const SHELL_MARK = 'id="hb-shell"'

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * index.html with the shell's placeholders (`<!--hb-shell:NAME-->`) filled in with `text`, and the build's
 * stylesheet links moved from the head to the end of the body: the browser paints the shell (styled inline)
 * without waiting for them, and the app's module script still waits for them before it runs, so the app
 * never mounts unstyled. Pages without the shell come back as they are.
 */
export function fillShell(html: string, text: ShellText): string {
  if (!html.includes(SHELL_MARK)) return html
  const filled = html.replace(/<!--hb-shell:([A-Z_]+)-->/g, (whole, name: string) => {
    const value = (text as Readonly<Record<string, string>>)[name]
    if (value === undefined) throw new Error(`index.html: unknown shell placeholder ${whole}`)
    return escapeHtml(value)
  })
  const headEnd = filled.indexOf('</head>')
  const links: string[] = []
  const head = filled.slice(0, headEnd).replace(/[ \t]*<link\b[^>]*\brel="stylesheet"[^>]*>\n?/g, (link) => {
    links.push(link.trim())
    return ''
  })
  const rest = filled.slice(headEnd)
  if (links.length === 0) return head + rest
  return head + rest.replace('</body>', `${links.map((l) => `  ${l}\n`).join('')}  </body>`)
}

/** The shell's words, read from src/session/copy.ts and src/copy.ts through Vite's module runner. */
export async function loadShellText(): Promise<ShellText> {
  const [session, app] = await Promise.all(
    ['./src/session/copy.ts', './src/copy.ts'].map(async (f) => (await runnerImport<Record<string, unknown>>(fileURLToPath(new URL(f, import.meta.url)))).module),
  )
  const all: Record<string, unknown> = { ...app, ...session }
  const out: Record<string, string> = {}
  for (const name of SHELL_TEXT_NAMES) {
    const value = all[name]
    if (typeof value !== 'string' || value === '') throw new Error(`static shell: ${name} is not a string in src/session/copy.ts or src/copy.ts`)
    out[name] = value
  }
  return out as ShellText
}

/**
 * The static welcome shell of index.html (UX-100), filled in dev and build (`fillShell`). On a slow line the page
 * used to stay blank until the app's script had loaded and run; now the HTML itself shows the welcome screen's
 * heading, tagline and intro and the footer disclaimer, in the app's own words (`loadShellText`) and look (inline
 * styles that repeat app.css, render.css, session.css and App.svelte's footer; scripts/static-shell.test.ts
 * compares them), with a "Loading…" line where Start will be and nothing to press. src/main.ts clears it before
 * the app mounts. A tiny inline script in the head (the site sends no Content-Security-Policy, so it may run)
 * marks a page with JavaScript, which shows the "Loading…" line and the footer (without JavaScript the noscript
 * text in the shell says what to do and carries the disclaimer), and a page opened on a deep link (the privacy
 * notice, the data page, a dev route), whose welcome text stays hidden: that page is about to be another one.
 */
function staticShell(): Plugin {
  let text: Promise<ShellText> | undefined
  return {
    name: 'humanbench-static-shell',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        if (!html.includes(SHELL_MARK)) return html
        // Read once per server or build; a failure is not kept, so the next request tries again.
        text ??= loadShellText().catch((e: unknown) => {
          text = undefined
          throw e
        })
        return fillShell(html, await text)
      },
    },
  }
}

/** Whether the build includes the dev-only routes of src/dev/ (see `define` below; M1.16). */
export function devRoutesEnabled(mode: string, env: Record<string, string>): boolean {
  return mode !== 'production' || env.VITE_HB_DEV_ROUTES === '1'
}

/**
 * Whether the build includes the server client (`src/backend/`, ROADMAP M2.7). A plain production
 * build has no server: `VITE_HB_SUPABASE_URL` is unset, `__HB_BACKEND__` is false, and the dynamic
 * import of supabase-js folds away, so the Pages build ships no trace of it (the static fallback is
 * the default build). It is on in dev and tests, in a build that names a server, and in the
 * Playwright build (`VITE_HB_DEV_ROUTES=1`), whose pages can be pointed at a fake server with
 * `?hb_backend=` (`src/backend/config.ts`).
 */
export function backendCompiledIn(mode: string, env: Record<string, string>): boolean {
  return mode !== 'production' || (env.VITE_HB_SUPABASE_URL ?? '') !== '' || env.VITE_HB_DEV_ROUTES === '1'
}

// The GitHub Pages project site lives at /humanbench/ (ROADMAP A3).
// Override with VITE_BASE (shell env or .env*), e.g. VITE_BASE=/ for a custom domain.
// The Pages workflow sets it from actions/configure-pages, so a custom domain works too.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/humanbench/').replace(/\/?$/, '/')
  return {
    base,
    plugins: [svelte(), schemaAssets(), surfacesStaleness(), staticShell()],
    // Dev-only routes (src/dev/, e.g. the M1.16 blob demo): on in dev and tests, and in a build
    // with VITE_HB_DEV_ROUTES=1 (the Playwright e2e build); a plain production build drops them.
    define: { __HB_DEV_ROUTES__: JSON.stringify(devRoutesEnabled(mode, env)), __HB_BACKEND__: JSON.stringify(backendCompiledIn(mode, env)) },
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
            // *.db.test.ts need a real Postgres: `npm run test:db` (vitest.db.config.ts, ROADMAP M2.0).
            exclude: ['src/**/*.dom.test.ts', 'src/**/*.svelte.test.ts', 'scripts/**/*.db.test.ts'],
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
