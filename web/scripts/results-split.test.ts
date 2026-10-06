/**
 * The results code stays out of the entry chunk (UX-100). The welcome screen needs none of the end of a
 * session (`session/Finished.svelte`: the reveal, the profile drawings with D3, the share card, the worked
 * examples), so it is a chunk of its own that `session/results-loader.ts` fetches from the ready screen on.
 *
 * One production build of the real app (Vite, in memory) checks that:
 * - nothing the entry chunk loads statically (the entry and the chunks it imports) holds the results
 *   modules or D3's shapes, and the results chunk is one of the entry's dynamic imports;
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
import { WEB } from './css-tokens'

/**
 * The entry chunk's gzip size limit, in bytes. Before the split it was 158 KB (results included); after it,
 * 120 KB. The results chunk alone is about 41 KB gzip, so a static import of it trips this bound, while the
 * welcome-to-run code keeps some 15 KB of room to grow.
 */
const ENTRY_GZIP_MAX = 135_000

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
