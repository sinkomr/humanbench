/**
 * What the builds ship of the AUT sentence embedder (ROADMAP M6.4; DESIGN §5.4: "all-MiniLM-L6-v2 via
 * Transformers.js, downloaded once"). The library and ONNX Runtime are heavy (a ~0.5 MB chunk and a 14 MB wasm),
 * so a person who never reaches the task must not pay for them:
 *
 * - (a) a plain production build contains no Transformers.js or ONNX Runtime code and no wasm. (When the task
 *   joins the production app, relax this to (b) applied to that build: the library is then present, lazily.)
 * - (b) in the `VITE_HB_DEV_ROUTES=1` build (the Playwright build, which has the AUT demo), any chunk that holds
 *   library code is reached only by a dynamic `import()`: not by the static imports of any entry chunk, and not
 *   preloaded by a page. The demo page loads the real scorer on a press, so at least one chunk holds the library
 *   and the build ships exactly one wasm, ONNX Runtime's plain one.
 * - (b2) a build of `src/tasks/aut/minilm.ts` itself (so the check above is not vacuous) puts the library in a
 *   lazily loaded chunk, ships ONNX Runtime's plain wasm and its loader as separate assets, and does NOT ship the
 *   27 MB WebGPU ("asyncify") wasm that Transformers.js' default entry would drag in (`vite.config.ts`, `resolve.alias`).
 * - (c) no file under `web/src` imports the library statically (`import type` is erased and allowed); only
 *   `tasks/aut/minilm.ts` imports it at all, dynamically.
 *
 * No test here downloads a model or reaches the network.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build, type Plugin, type Rolldown } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SRC = `${WEB}src/`
const FLAG = 'VITE_HB_DEV_ROUTES'
const saved = process.env[FLAG]

afterEach(() => {
  if (saved === undefined) delete process.env[FLAG]
  else process.env[FLAG] = saved
})

type Output = Rolldown.OutputChunk | Rolldown.OutputAsset
type Chunk = Rolldown.OutputChunk

const textOf = (o: Output): string => (o.type === 'chunk' ? o.code : typeof o.source === 'string' ? o.source : new TextDecoder().decode(o.source))
const sizeOf = (o: Output): number => (o.type === 'chunk' ? Buffer.byteLength(o.code) : typeof o.source === 'string' ? Buffer.byteLength(o.source) : o.source.byteLength)
const outputsOf = (result: Awaited<ReturnType<typeof build>>): Output[] => ((Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]).flatMap((o) => o.output)
const chunksOf = (outputs: Output[]): Chunk[] => outputs.filter((o): o is Chunk => o.type === 'chunk')

/**
 * Strings that stay in the minified library chunk: Transformers.js' cache name, one of its error messages and its
 * ONNX Runtime session class and package name. (`Xenova` and `ort-wasm` are not markers: `minilm.ts` itself
 * names the model and the wasm file.)
 */
const LIBRARY_MARKERS = ['transformers-cache', 'Unsupported pipeline:', 'InferenceSession', 'onnxruntime'] as const
const holdsLibrary = (o: Output): boolean => o.type === 'chunk' && LIBRARY_MARKERS.some((m) => o.code.includes(m))

/** The chunks an entry chunk loads by static imports, itself included. */
function staticClosure(entry: Chunk, chunks: readonly Chunk[]): Set<string> {
  const seen = new Set<string>()
  const walk = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    for (const i of chunks.find((c) => c.fileName === name)?.imports ?? []) walk(i)
  }
  walk(entry.fileName)
  return seen
}

/** The real app build (in memory) as `dev-routes.test.ts` makes it. */
async function appBuild(devRoutes: boolean): Promise<Output[]> {
  if (devRoutes) process.env[FLAG] = '1'
  else delete process.env[FLAG]
  return outputsOf(await build({ configFile: `${WEB}vite.config.ts`, root: WEB, mode: 'production', logLevel: 'silent', build: { write: false } }))
}

/** A build with this repo's `vite.config.ts` whose only entry is `minilm.ts` (and the mock embedder next to it). */
async function minilmBuild(): Promise<Output[]> {
  const id = '\0hb-aut-minilm-probe'
  const probe: Plugin = {
    name: 'hb-aut-minilm-probe',
    resolveId: (source) => (source === 'hb-aut-minilm-probe' ? id : null),
    load: (source) =>
      source === id ? `export { loadMiniLmEmbedder, MINILM_MODEL_ID } from ${JSON.stringify(`${SRC}tasks/aut/minilm.ts`)}\nexport { createMockEmbedder } from ${JSON.stringify(`${SRC}tasks/aut/embedder.ts`)}` : null,
  }
  delete process.env[FLAG]
  return outputsOf(
    await build({
      configFile: `${WEB}vite.config.ts`,
      root: WEB,
      mode: 'production',
      logLevel: 'silent',
      plugins: [probe],
      build: { write: false, minify: true, rolldownOptions: { input: 'hb-aut-minilm-probe', preserveEntrySignatures: 'strict' } },
    }),
  )
}

describe('the production build carries none of the embedder runtime (a)', () => {
  it('a plain build has no Transformers.js, no ONNX Runtime and no wasm', async () => {
    const outputs = await appBuild(false)
    expect(outputs.some((o) => o.fileName === 'index.html')).toBe(true)
    expect(outputs.filter(holdsLibrary).map((o) => o.fileName)).toEqual([])
    expect(outputs.filter((o) => /\.wasm$/.test(o.fileName)).map((o) => o.fileName)).toEqual([])
    expect(outputs.filter((o) => /ort-wasm|transformers|onnx/i.test(o.fileName)).map((o) => o.fileName)).toEqual([])
    const text = outputs.map(textOf).join('\n')
    expect(text).not.toContain('onnxruntime')
    expect(text).not.toContain('cdn.jsdelivr.net')
  }, 120_000)
})

describe('the e2e build loads the embedder runtime only on demand (b)', () => {
  it('any chunk with library code is reached by dynamic imports only, and no page preloads it', async () => {
    const outputs = await appBuild(true)
    const chunks = chunksOf(outputs)
    const entries = chunks.filter((c) => c.isEntry)
    expect(entries.length).toBeGreaterThan(0)
    const holders = chunks.filter(holdsLibrary)
    // The AUT demo (src/dev/AutDemo.svelte) imports the loader, so the runtime is in this build (otherwise the
    // checks below would pass on nothing).
    expect(holders.length).toBeGreaterThan(0)
    const htmls = outputs.filter((o) => o.fileName.endsWith('.html')).map(textOf)
    expect(htmls.length).toBeGreaterThan(0)
    for (const h of holders) {
      for (const e of entries) expect(staticClosure(e, chunks).has(h.fileName), `${h.fileName} is loaded statically from the entry ${e.fileName}`).toBe(false)
      for (const html of htmls) expect(html, `a page names ${h.fileName}`).not.toContain(h.fileName)
      // something does ask for it, or it would not be in the build
      expect(
        chunks.some((c) => c.dynamicImports.includes(h.fileName)),
        `${h.fileName} is not the target of any dynamic import`,
      ).toBe(true)
    }
    // The wasm is ours, plain, and one file (never the 27 MB WebGPU build).
    const wasm = outputs.filter((o) => /\.wasm$/.test(o.fileName))
    expect(wasm.map((o) => o.fileName.replace(/^.*\//, ''))).toEqual([expect.stringMatching(/^ort-wasm-simd-threaded-[\w-]+\.wasm$/)])
  }, 120_000)
})

describe('a build of minilm.ts (b2)', () => {
  it('keeps the library in a lazy chunk and ships only the plain wasm, from our own build', async () => {
    const outputs = await minilmBuild()
    const chunks = chunksOf(outputs)
    const entry = chunks.find((c) => c.isEntry)
    if (entry === undefined) throw new Error('no entry chunk')

    // The entry holds our loader (and the mock embedder) but none of the library, and no static path leads to it.
    expect(holdsLibrary(entry)).toBe(false)
    expect(entry.code).toContain('Xenova/all-MiniLM-L6-v2')
    const holders = chunks.filter(holdsLibrary)
    expect(holders.length).toBeGreaterThan(0)
    const closure = staticClosure(entry, chunks)
    for (const h of holders) {
      expect(closure.has(h.fileName), `${h.fileName} is a static dependency of the entry`).toBe(false)
      expect(entry.dynamicImports).toContain(h.fileName)
    }
    // Everything the entry loads at once is small.
    const eager = [...closure].map((n) => outputs.find((o) => o.fileName === n)).filter((o): o is Output => o !== undefined)
    expect(eager.reduce((s, o) => s + sizeOf(o), 0)).toBeLessThan(40_000)

    // ONNX Runtime's plain build: one wasm and its loader, as separate hashed assets. Never the WebGPU build.
    const wasm = outputs.filter((o): o is Rolldown.OutputAsset => o.type === 'asset' && o.fileName.endsWith('.wasm'))
    expect(wasm.map((o) => o.fileName.replace(/^.*\//, ''))).toEqual([expect.stringMatching(/^ort-wasm-simd-threaded-[\w-]+\.wasm$/)])
    expect(sizeOf(wasm[0] as Output)).toBeGreaterThan(5_000_000)
    expect(sizeOf(wasm[0] as Output)).toBeLessThan(20_000_000)
    expect(outputs.filter((o) => /asyncify|jsep|jspi/i.test(o.fileName))).toEqual([])
    const loader = outputs.filter((o): o is Rolldown.OutputAsset => o.type === 'asset' && /ort-wasm-simd-threaded-[\w-]+\.mjs$/.test(o.fileName))
    expect(loader).toHaveLength(1)
    expect(textOf(loader[0] as Output)).toContain('ort-wasm-simd-threaded.wasm')

    // The entry reaches both through URL-only modules (a few bytes each), loaded when the runtime is configured.
    const urlChunks = chunks.filter((c) => c.code.length < 200 && /ort-wasm-simd-threaded-[\w-]+\.(wasm|mjs)/.test(c.code))
    expect(urlChunks).toHaveLength(2)
    for (const c of urlChunks) expect(entry.dynamicImports).toContain(c.fileName)

    // The library is pointed at our files: its jsDelivr default never needs to be used.
    expect(textOf(entry)).not.toContain('jsdelivr')
  }, 120_000)
})

describe('the packages minilm.ts relies on (b2)', () => {
  const require = createRequire(`${WEB}package.json`)

  it('onnxruntime-web, which minilm.ts imports for its wasm URLs, is the copy Transformers.js uses', () => {
    // Neither package exports its package.json, so compare where a file both would load resolves to.
    const fromTransformers = createRequire(require.resolve('@huggingface/transformers'))
    for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
      const own = realpathSync(require.resolve(`onnxruntime-web/${f}`))
      expect(existsSync(own), own).toBe(true)
      expect(statSync(own).size).toBeGreaterThan(10_000)
      expect(realpathSync(fromTransformers.resolve(`onnxruntime-web/${f}`)), f).toBe(own)
    }
  })

  it('Transformers.js stays pinned exactly (its wasm names and its API are what minilm.ts is written against)', () => {
    const pkg = JSON.parse(readFileSync(`${WEB}package.json`, 'utf8')) as { dependencies?: Record<string, string> }
    expect(pkg.dependencies?.['@huggingface/transformers']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

/* ------------------------------------------------------------------ source scan (c) */

const PACKAGES = String.raw`@huggingface\/transformers|onnxruntime-(?:web|common|node)`
const SPECIFIER = String.raw`['"](?:${PACKAGES})(?:\/[^'"]*)?['"]`
/**
 * `import … from 'pkg'` and `export … from 'pkg'` that survive compilation: all but `import type` / `export type`
 * (`import { type A } from` is kept as a side-effect import under `verbatimModuleSyntax`, so it is flagged).
 */
const STATIC_FROM = new RegExp(String.raw`^[ \t]*(?:import|export)(?![\w$])(?!\s+type\b)[^'"` + '`' + String.raw`;]*?\bfrom\s*${SPECIFIER}`, 'gm')
/** `import 'pkg'` (a side-effect import) and `require('pkg')`. */
const STATIC_BARE = new RegExp(String.raw`^[ \t]*import\s*${SPECIFIER}|\brequire\s*\(\s*${SPECIFIER}\s*\)`, 'gm')
/** `import('pkg')`, with a subpath or a `?url` query if it has one. */
const DYNAMIC = new RegExp(String.raw`\bimport\s*\(\s*${SPECIFIER}\s*\)`, 'g')

/** Whether `re` matches `text` (a fresh regex each time: global ones keep a position between calls). */
const once = (re: RegExp, text: string): boolean => new RegExp(re.source, re.flags.replace('g', '')).test(text)
const isStatic = (text: string): boolean => once(STATIC_FROM, text) || once(STATIC_BARE, text)

/** Files under web/src (posix, relative) whose text matches `re`. */
function filesMatching(re: RegExp): string[] {
  const out: string[] = []
  for (const f of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    const rel = f.split(/[\\/]/).join('/')
    if (!/\.(ts|js|svelte)$/.test(rel)) continue
    if (once(re, readFileSync(`${SRC}${rel}`, 'utf8'))) out.push(rel)
  }
  return out.sort()
}

describe('imports of the embedder runtime in src (c)', () => {
  it('the scan sees every static form, and none of the allowed ones (so the next checks are not vacuous)', () => {
    const static_ = [
      "import { pipeline } from '@huggingface/transformers'",
      'import * as tf from "@huggingface/transformers"',
      "import tf from '@huggingface/transformers'",
      "import { type Pipeline } from '@huggingface/transformers'",
      "import {\n  pipeline,\n  env,\n} from '@huggingface/transformers'",
      "export { env } from '@huggingface/transformers'",
      "export * from '@huggingface/transformers'",
      "import '@huggingface/transformers'",
      "import { env } from '@huggingface/transformers/src/env.js'",
      "import * as ort from 'onnxruntime-web'",
      "import * as ort from 'onnxruntime-web/wasm'",
      "import ort from 'onnxruntime-common'",
      "import wasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'",
      "  import{pipeline}from'@huggingface/transformers'",
      "const tf = require('@huggingface/transformers')",
    ]
    for (const s of static_) expect(isStatic(s), s).toBe(true)
    const allowed = [
      "import type { Pipeline } from '@huggingface/transformers'",
      "export type { Pipeline } from '@huggingface/transformers'",
      "const tf = await import('@huggingface/transformers')",
      "import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')",
      " * import { pipeline } from '@huggingface/transformers'",
      "// import { pipeline } from '@huggingface/transformers'",
      "import { x } from './transformers-helper'",
      "import { x } from 'transformers'",
      "import { x } from '@huggingface/jinja'",
      "vi.mock('@huggingface/transformers', () => ({}))",
    ]
    for (const s of allowed) expect(isStatic(s), s).toBe(false)
    const dynamic = ["await import('@huggingface/transformers')", 'import( "@huggingface/transformers" )', "import('onnxruntime-web/ort-wasm-simd-threaded.mjs?url')"]
    for (const s of dynamic) expect(once(DYNAMIC, s), s).toBe(true)
    for (const s of ["import type { P } from '@huggingface/transformers'", "import('./minilm')", "vi.doMock('@huggingface/transformers')"]) expect(once(DYNAMIC, s), s).toBe(false)
  })

  it('no file under web/src imports Transformers.js or ONNX Runtime statically', () => {
    expect([...new Set([...filesMatching(STATIC_FROM), ...filesMatching(STATIC_BARE)])]).toEqual([])
  })

  it('embedder.ts, which the rest of the task imports, does not mention either package in code', () => {
    const src = readFileSync(`${SRC}tasks/aut/embedder.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toMatch(/transformers|onnxruntime/)
  })

  it('only tasks/aut/minilm.ts imports them at all, and it does so with dynamic imports', () => {
    expect(filesMatching(DYNAMIC)).toEqual(['tasks/aut/minilm.ts'])
    const minilm = readFileSync(`${SRC}tasks/aut/minilm.ts`, 'utf8')
    expect(minilm).toMatch(/await import\('@huggingface\/transformers'\)/)
    expect(minilm).toMatch(/import\('onnxruntime-web\/ort-wasm-simd-threaded\.wasm\?url'\)/)
    expect(minilm).toMatch(/import\('onnxruntime-web\/ort-wasm-simd-threaded\.mjs\?url'\)/)
  })
})
