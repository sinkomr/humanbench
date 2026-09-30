/**
 * Build-level checks of the visual renderers (ROADMAP M1.13, A3: Three.js only for rotation
 * stimuli, loaded lazily; the renderer gallery is dev-only):
 * - the production app build (this repo's `vite.config.ts`) contains no gallery page and none of
 *   its code, and the gallery entry refuses to run outside the dev server;
 * - a bundle of the renderer map (`src/render/visual.ts`) keeps Three.js out of its entry chunk:
 *   Three.js sits in a separate chunk that the entry loads with a dynamic import;
 * - `src/render/rotation/three-view.ts` is the only app module that imports `three` (tests of the
 *   rotation renderer may import its maths classes).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { build, type Plugin, type Rolldown } from 'vite'
import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const RENDER = fileURLToPath(new URL('../src/render/', import.meta.url))

/** The specifier 'three' or a 'three/…' subpath, in either quote style. */
const THREE_SPECIFIER = String.raw`['"]three(?:/[^'"]*)?['"]`
/**
 * Every static or dynamic way to reach 'three': `import … from` / `export … from` (incl. `import
 * type`), side-effect `import 'three'`, dynamic `import('three')` and `require('three')`.
 */
const IMPORTS_THREE = new RegExp(String.raw`\bfrom\s*${THREE_SPECIFIER}|\bimport\s*${THREE_SPECIFIER}|\b(?:import|require)\s*\(\s*${THREE_SPECIFIER}\s*\)`)

/** Files under web/src (posix, relative) that import 'three' or a 'three/…' subpath. */
function threeImporters(): string[] {
  const out: string[] = []
  for (const f of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    const rel = f.split(/[\\/]/).join('/')
    if (!/\.(ts|js|svelte)$/.test(rel)) continue
    if (IMPORTS_THREE.test(readFileSync(`${SRC}${rel}`, 'utf8'))) out.push(rel)
  }
  return out.sort()
}

/** Strings only the gallery has (its heading, its entry path and its page name). */
const GALLERY_MARKERS = ['Visual renderer gallery', 'visual-gallery', 'render-visual', 'Remove items']
/** A string literal Three.js keeps in minified builds (its WebGLRenderer error messages). */
const THREE_MARKER = /THREE\.WebGLRenderer/

type Output = Rolldown.OutputChunk | Rolldown.OutputAsset

function outputsOf(result: Awaited<ReturnType<typeof build>>): Output[] {
  return ((Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]).flatMap((o) => o.output)
}

const textOfOutput = (o: Output): string => (o.type === 'chunk' ? o.code : typeof o.source === 'string' ? o.source : new TextDecoder().decode(o.source))

describe('visual renderer bundles (M1.13)', () => {
  it('the production app build has no renderer gallery', async () => {
    const outputs = outputsOf(await build({ configFile: `${WEB}vite.config.ts`, root: WEB, mode: 'production', logLevel: 'silent', build: { write: false } }))
    const names = outputs.map((o) => o.fileName)
    expect(names).toContain('index.html')
    // Only the build pages (the app, the notes builder of Phase AI and the public RT self-test, M1.23), never the gallery.
    expect(names.filter((n) => n.endsWith('.html')).sort()).toEqual(['index.html', 'notes.html', 'rt-selftest.html'])
    const text = outputs.map(textOfOutput).join('\n')
    expect(text).toContain('HumanBench')
    for (const m of GALLERY_MARKERS) expect(text, m).not.toContain(m)
  }, 60_000)

  it('the import scan sees every form of importing three (so the next check is not vacuous)', () => {
    const hits = [
      "import { Mesh } from 'three'",
      'import * as THREE from "three"',
      "import type { Mesh } from 'three'",
      "import 'three'",
      'import "three/examples/jsm/controls/OrbitControls.js"',
      "export { Mesh } from 'three'",
      "export * from 'three/src/math/Vector3.js'",
      "const m = await import('three')",
      "const m = await import ( 'three/webgpu' )",
      "const t = require('three')",
      "  import{Mesh}from'three'",
    ]
    for (const h of hits) expect(IMPORTS_THREE.test(h), h).toBe(true)
    const misses = ["import { x } from './three-view'", "import('./three-view')", "import 'threejs-extras'", "from 'three-stdlib'", "// uses three.js", "const three = 3"]
    for (const m of misses) expect(IMPORTS_THREE.test(m), m).toBe(false)
  })

  it('only the rotation renderer imports Three.js (A3)', () => {
    const importers = threeImporters()
    expect(importers.filter((f) => !/\.test\.ts$/.test(f))).toEqual(['render/rotation/three-view.ts'])
    for (const f of importers) expect(f).toMatch(/^render\/rotation\//)
  })

  it('the gallery entry is guarded by import.meta.env.DEV', () => {
    const entry = readFileSync(`${RENDER}visual-gallery/main.ts`, 'utf8')
    expect(entry).toMatch(/if \(!import\.meta\.env\.DEV\) throw/)
    const page = readFileSync(`${WEB}render-visual.html`, 'utf8')
    expect(page).toContain('/src/render/visual-gallery/main.ts')
  })

  it('the renderer map keeps Three.js in a lazily loaded chunk of its own', async () => {
    const id = '\0hb-render-probe'
    const probe: Plugin = {
      name: 'hb-render-probe',
      resolveId: (source) => (source === 'hb-render-probe' ? id : null),
      load: (source) => (source === id ? `export { VISUAL_RENDERERS } from ${JSON.stringify(`${RENDER}visual.ts`)}` : null),
    }
    const outputs = outputsOf(
      await build({
        configFile: false,
        root: WEB,
        logLevel: 'silent',
        plugins: [svelte(), probe],
        build: { write: false, minify: true, rollupOptions: { input: 'hb-render-probe', preserveEntrySignatures: 'strict' } },
      }),
    )
    const chunks = outputs.filter((o): o is Rolldown.OutputChunk => o.type === 'chunk')
    const entry = chunks.find((c) => c.isEntry)
    if (!entry) throw new Error('no entry chunk')
    expect(entry.code).not.toMatch(THREE_MARKER)
    // The entry reaches Three.js only through a dynamic import (possibly via three-view's chunk).
    const threeChunks = chunks.filter((c) => THREE_MARKER.test(c.code))
    expect(threeChunks.length).toBeGreaterThan(0)
    const lazy = new Set<string>()
    const visit = (c: Rolldown.OutputChunk): void => {
      for (const f of [...c.imports, ...c.dynamicImports]) {
        if (lazy.has(f)) continue
        lazy.add(f)
        const next = chunks.find((x) => x.fileName === f)
        if (next) visit(next)
      }
    }
    for (const f of entry.dynamicImports) {
      lazy.add(f)
      const c = chunks.find((x) => x.fileName === f)
      if (c) visit(c)
    }
    const staticDeps = new Set(entry.imports)
    for (const c of threeChunks) {
      expect(lazy.has(c.fileName), `${c.fileName} is not loaded lazily`).toBe(true)
      expect(staticDeps.has(c.fileName), `${c.fileName} is a static import of the entry`).toBe(false)
    }
  }, 60_000)
})
