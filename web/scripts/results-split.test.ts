/**
 * The results code stays out of the entry chunk (UX-100). The welcome screen needs none of the end of a
 * session (`session/Finished.svelte`: the reveal, the profile drawings with D3, the share card, the worked
 * examples), so it is a chunk of its own that `session/results-loader.ts` fetches from the ready screen on.
 *
 * One production build of the real app (Vite, in memory) checks that:
 * - nothing the entry chunk loads statically (the entry and the chunks it imports) holds the results
 *   modules or D3's shapes, and the results chunk is one of the entry's dynamic imports;
 * - the session runtime (`session/runtime.ts`: the session machine, the selector, the generators) is not reachable
 *   from the entry without a dynamic import, and the families' verifiers are in no chunk of the build;
 * - the entry chunk stays under a gzip bound (see ENTRY_GZIP_MAX);
 * - the built index.html has the static welcome shell filled in and its stylesheets after the shell.
 * A source scan backs it up without a build: no value import of the results component in the entry's own files.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build, type Rolldown } from 'vite'
import { beforeAll, describe, expect, it } from 'vitest'
import { DISCLAIMER } from '../src/copy'
import { WELCOME_HEADING, WELCOME_INTRO, WELCOME_TAGLINE } from '../src/session/copy'
import { RESULTS_CHUNK_FILE } from '../src/session/results-loader'
import { RUNTIME_CHUNK_FILE } from '../src/session/runtime-loader'
import { LAZY_CSS_APPEND } from '../vite.config'
import { WEB } from './css-tokens'

/**
 * The entry chunk's gzip size limit, in bytes. Before the split it was 158 KB (results included); after it,
 * 120 KB. The results chunk alone is about 41 KB gzip, so a static import of it trips this bound, while the
 * welcome-to-run code keeps room to grow. Raised from 135 KB to 140 KB with the passage screen of M3.11
 * phase 2 (about 1.5 KB gzip, measured on the default build: the passage spec, the layout and the run's set
 * rule), which took the entry of this build to 136.0 KB; a static import of the results chunk still trips the
 * bound by a wide margin. Raised to 142 KB with the remaining families of M3.11 (2026-10-13), which took the entry from
 * 138.1 to 140.6 KB: the served payload shapes, the logic-game setup on the passage screen, the skills the server has
 * and the rotation of the parts. Their four renderers and the task modules behind them stay out of the entry
 * (`src/session/served-renderers.ts`, fetched when a session with one of their parts starts). Raised to 143 KB when
 * the three branches of 2026-10-13 (session fixes, served families, inline confidence) were merged together: each added
 * session code (the question timer and the answer sent at time-out, the selector's start-up rule, the skills the server
 * has and the rotation, the confidence scale on the question screen), which took this entry to 142.2 KB on CI's Node 24
 * (141.7 KB on Node 26, whose gzip is tighter). All of it runs in the session the entry starts. Taking the text
 * renderer out as well saved only 0.6 KB here and nothing in the e2e build (`e2e/ux2-perf.spec.ts`, where the dev
 * routes already split it off), so the bound was raised rather than the session code split further.
 *
 * Raised to 160 KB for quant generator 1.4.0 (ROADMAP M3.12, owner 2026-10-15: harder Quantitative items): the
 * 45 templates of strata 5 and 6 (`tasks/quant/hard1.ts` … `hard4.ts`, about 11 KB gzip) and their verifier
 * routes (`verify-hard*.ts`, about 7 KB), which the family carries because the device generates and keys its quant
 * items; this took the entry from about 142 to 158.8 KB. The verifiers run only in tests, the dump and the dev review
 * page; keeping them out of the entry needs a family contract whose verify() can load late (not done here).
 *
 * Raised to 162 KB when merged with the cross-skill aim (2026-10-16, `engine/xskill.ts`, about 1.2 KB). The entry
 * now carries the whole session runtime and the device's item generators; moving them behind Start is the follow-up.
 * The hard strata of matrices 1.3.0, series 1.4.0 and rotation 1.4.0 (M3.12, branch `feat/hard-mat-spa`, about
 * 5 KB on their own base) merged on top took it to 157.9 KB (Node 26; CI's Node 24 gzips a little larger): bound 166 KB
 * until the session runtime moved behind Start.
 *
 * **Lowered to 31.5 KB (2026-10-16, ROADMAP M3.12 follow-up).** The session runtime is a chunk of its own
 * (`src/session/runtime.ts`, fetched by `runtime-loader.ts` in idle time on the welcome screen and at Start): the
 * session machine, the selector and the cross-skill aim, the question timer and confidence scale, the practice round,
 * the ready screen, the scoring of earlier saves and the device's item generators. The families' verifiers are in no
 * production chunk at all (`src/tasks/verifier-slot.ts`; only the tests, the dump and the review page install them).
 * That took the entry from 157.9 to 29.1 KB as this test builds it (vitest runs with NODE_ENV=test, which makes the
 * same build about 2.2 KB larger than `npm run build`'s 26.9 KB; Node 26). The bound is that plus about 2.4 KB (8%)
 * for growth and for Node 24's gzip. The runtime may not come back: see SESSION_RUNTIME below.
 */
const ENTRY_GZIP_MAX = 31_500

/** Modules of the results side: none may be reachable from the entry without a dynamic import. */
const RESULTS_SIDE = [
  /\/src\/session\/Finished\.svelte$/,
  /\/src\/reveal\/Reveal\.svelte$/,
  /\/src\/reveal\/SavePanel\.svelte$/,
  /\/src\/reveal\/ShareCard\.svelte$/,
  /\/src\/reveal\/worked\//,
  /\/src\/viz\/BlobChart\.svelte$/,
  /\/src\/viz\/card\.ts$/,
  /\/node_modules\/d3-shape\//,
]

/**
 * Modules of the session runtime (`src/session/runtime.ts`, UX-100): none may be reachable from the entry without a
 * dynamic import. The welcome screen, the gate, the honour code and the device check need none of them.
 */
const SESSION_RUNTIME = [
  /\/src\/session\/run\.ts$/,
  /\/src\/session\/SessionScreen\.svelte$/,
  /\/src\/session\/Ready\.svelte$/,
  /\/src\/session\/PracticeScreen\.svelte$/,
  /\/src\/session\/item-timer\.ts$/,
  /\/src\/session\/ConfidenceScale\.svelte$/,
  /\/src\/engine\/selector\.ts$/,
  /\/src\/engine\/xskill\.ts$/,
  /\/src\/engine\/scorer\.ts$/,
  /\/src\/tasks\/registry\.ts$/,
  /\/src\/tasks\/(matrices|series|rotation|quant|span|rt|coding|reading)\/index\.ts$/,
  /\/src\/save\/rescore\.ts$/,
]

/** Modules that hold only the families' verifiers (G2/G3, A1): in no chunk of the build. */
const VERIFIER_ONLY = [
  /\/src\/tasks\/verifiers\.ts$/,
  /\/src\/tasks\/quant\/verify(-hard\d|-kit)?\.ts$/,
  /\/src\/tasks\/(matrices|series|rotation|coding|reading)\/verify\.ts$/,
]
/** Verify modules that also hold helpers the generators use (`expectedKey`, the RT spec fields): only those may ship. */
const SHARED_VERIFY = /\/src\/tasks\/(span|rt)\/verify\.ts$/
const SHARED_VERIFY_MAX = 1_000

type Chunk = Rolldown.OutputChunk
type Asset = Rolldown.OutputAsset

let chunks: Chunk[] = []
let assets: Asset[] = []

beforeAll(async () => {
  const result = await build({ configFile: join(WEB, 'vite.config.ts'), root: WEB, mode: 'production', logLevel: 'silent', build: { write: false } })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const all = outputs.flatMap((o) => o.output)
  chunks = all.filter((o): o is Chunk => o.type === 'chunk')
  assets = all.filter((o): o is Asset => o.type === 'asset')
}, 180_000)

const entry = (): Chunk => {
  const c = chunks.find((x) => x.isEntry && x.name === 'index')
  if (c === undefined) throw new Error('no index entry chunk in the build')
  return c
}
const byFile = (file: string): Chunk | undefined => chunks.find((c) => c.fileName === file)

/** The entry chunk and every chunk it imports statically, transitively. */
function staticClosure(start: Chunk): Chunk[] {
  const seen = new Map<string, Chunk>()
  const visit = (c: Chunk): void => {
    if (seen.has(c.fileName)) return
    seen.set(c.fileName, c)
    for (const f of c.imports) {
      const next = byFile(f)
      if (next !== undefined) visit(next)
    }
  }
  visit(start)
  return [...seen.values()]
}

describe('the results code is a chunk of its own (UX-100)', () => {
  it('nothing the entry loads statically holds the results side; the results chunk is a dynamic import of the entry', () => {
    const closure = staticClosure(entry())
    const leaked = closure.flatMap((c) => c.moduleIds.filter((id) => RESULTS_SIDE.some((re) => re.test(id.replace(/\\/g, '/')))).map((id) => `${c.fileName}: ${id.replace(WEB, '')}`))
    expect(leaked).toEqual([])
    const results = chunks.find((c) => c.moduleIds.some((id) => /\/src\/session\/Finished\.svelte$/.test(id)))
    expect(results).toBeDefined()
    expect(results!.isDynamicEntry).toBe(true)
    expect(entry().dynamicImports).toContain(results!.fileName)
    // The loader finds the chunk's failed preload by this name (WebKit's import errors name no URL).
    expect(`/${results!.fileName}`).toMatch(RESULTS_CHUNK_FILE)
    // The check can see the results side where it is: the chunk holds the reveal and D3's shapes.
    for (const re of [/\/src\/reveal\/Reveal\.svelte$/, /\/node_modules\/d3-shape\//]) expect(results!.moduleIds.some((id) => re.test(id))).toBe(true)
  })

  it('the session runtime is not reachable from the entry without a dynamic import; its chunk is a dynamic import of the entry', () => {
    const closure = staticClosure(entry())
    const leaked = closure.flatMap((c) => c.moduleIds.filter((id) => SESSION_RUNTIME.some((re) => re.test(id.replace(/\\/g, '/')))).map((id) => `${c.fileName}: ${id.replace(WEB, '')}`))
    expect(leaked).toEqual([])
    const runtime = chunks.find((c) => c.moduleIds.some((id) => /\/src\/session\/runtime\.ts$/.test(id.replace(/\\/g, '/'))))
    expect(runtime).toBeDefined()
    expect(runtime!.isDynamicEntry).toBe(true)
    expect(entry().dynamicImports).toContain(runtime!.fileName)
    expect(`/${runtime!.fileName}`).toMatch(RUNTIME_CHUNK_FILE)
    // The check sees the runtime where it is: the runtime's static closure holds the session machine and the selector.
    const held = staticClosure(runtime!).flatMap((c) => c.moduleIds.map((id) => id.replace(/\\/g, '/')))
    for (const re of [/\/src\/session\/run\.ts$/, /\/src\/engine\/selector\.ts$/, /\/src\/tasks\/registry\.ts$/]) expect(held.some((id) => re.test(id)), String(re)).toBe(true)
  })

  it('the families\' verifiers are in no chunk of the build: only the tests, the dump and the review page install them', () => {
    const shipped = chunks.flatMap((c) =>
      Object.entries(c.modules)
        .filter(([id, m]) => m.renderedLength > 0 && VERIFIER_ONLY.some((re) => re.test(id.replace(/\\/g, '/'))))
        .map(([id]) => `${c.fileName}: ${id.replace(WEB, '')}`),
    )
    expect(shipped).toEqual([])
    for (const c of chunks)
      for (const [id, m] of Object.entries(c.modules)) if (SHARED_VERIFY.test(id.replace(/\\/g, '/'))) expect(m.renderedLength, `${c.fileName}: ${id.replace(WEB, '')}`).toBeLessThan(SHARED_VERIFY_MAX)
  })

  it('a lazily loaded chunk\'s stylesheet is appended after the entry\'s (to the body), so the cascade is that of one stylesheet', () => {
    // Nothing in the build appends to the head any more, and the preload helper (the code that makes stylesheet and
    // modulepreload links for a dynamic import) appends to the body.
    for (const c of chunks) expect(c.code, c.fileName).not.toContain('document.head.appendChild(')
    const helpers = chunks.filter((c) => c.code.includes(LAZY_CSS_APPEND) && c.code.includes('modulepreload') && c.code.includes('stylesheet'))
    expect(helpers.length).toBeGreaterThan(0)
  })

  it(`the entry chunk stays under ${ENTRY_GZIP_MAX / 1000} KB gzip`, () => {
    const gzip = gzipSync(entry().code).length
    expect(gzip).toBeLessThan(ENTRY_GZIP_MAX)
  })

  it('the built index.html paints the welcome shell from the HTML alone, its stylesheets after the shell', () => {
    const html = assets.find((a) => a.fileName === 'index.html')?.source
    expect(typeof html).toBe('string')
    const text = html as string
    const [head, body] = text.split('</head>') as [string, string]
    expect(text).not.toContain('<!--hb-shell:')
    expect(body).toContain(`>${WELCOME_HEADING}</h1>`)
    expect(body).toContain(`>${WELCOME_TAGLINE}</p>`)
    expect(body).toContain(`>${WELCOME_INTRO}</p>`)
    const footer = /<footer class="hb-shell-foot">\s*<p>([^<]*)<\/p>/.exec(body)?.[1]
    expect(footer).toBe(DISCLAIMER)
    // No stylesheet blocks the first paint of the shell; the module script (deferred) stays in the head.
    expect(head).not.toMatch(/rel="stylesheet"/)
    expect(head).toMatch(/<script type="module"[^>]*src="[^"]*\/assets\/index-[^"]+\.js"/)
    const sheets = [...body.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1])
    expect(sheets.length).toBeGreaterThan(0)
    expect(body.indexOf('<link rel="stylesheet"')).toBeGreaterThan(body.indexOf('</footer>'))
    // The results' stylesheet comes with the results chunk, not with the page.
    expect(sheets.some((s) => /Finished-/.test(s ?? ''))).toBe(false)
  })
})

describe('no value import of the results component in the entry graph (source scan)', () => {
  // `import type` is erased and fine; a value import would put the results back in the entry chunk.
  const VALUE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+['"][^'"]*(Finished\.svelte|reveal\/Reveal\.svelte|viz\/[A-Za-z]+\.svelte)['"]/m
  for (const file of ['src/main.ts', 'src/App.svelte', 'src/session/SessionApp.svelte', 'src/session/results-loader.ts']) {
    it(file, () => {
      expect(readFileSync(join(WEB, file), 'utf8')).not.toMatch(VALUE_IMPORT)
    })
  }

  it('the scan sees a value import when there is one', () => {
    expect(`<script>\n  import Finished from './Finished.svelte'\n`).toMatch(VALUE_IMPORT)
    expect(`  import type Finished from './Finished.svelte'\n`).not.toMatch(VALUE_IMPORT)
  })
})
