/**
 * The route list of the accessibility sweep is complete (ROADMAP M1.21: "axe 0 serious/critical on
 * EVERY route"; Phase AI AI.5: the notes builder joins the list). `e2e/routes.ts` is what
 * `e2e/a11y.spec.ts` walks; this test fails, without a browser, when something a person can reach has
 * no entry there:
 *
 * - every HTML page (`web/*.html`, build and dev-only) and every hash route (`#/privacy`, `#/dev/*`);
 * - every block and item renderer, which with the segment titles (A15) covers every part of the session;
 * - every screen component of the session flow, the results and the other pages;
 * - the claims in `covers` are true (the file exists), so a rename cannot leave a stale entry.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEV_ROUTES } from '../src/dev/routes'
import { A15_SEGMENTS } from '../src/engine/selector'
import { ENTRY_RENDERERS } from '../src/render/entry'
import { SEGMENT_INFO } from '../src/session/segments'
import { DEV_ONLY_PAGES, PAGES } from '../vite.config'
import { DEV_SERVER_ROUTES, PREVIEW_ROUTES, ROUTES, SEGMENT_TITLES } from '../e2e/routes'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(WEB, 'src')

const covers = ROUTES.flatMap((r) => r.covers)

/** `covers` names a file under src/ (or a directory of them), an HTML page of web/, or a hash route. */
function isCovered(target: string): boolean {
  return covers.some((c) => c === target || (!c.includes('.') && !c.startsWith('#') && target.startsWith(`${c}/`)))
}

function svelteFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...svelteFiles(full))
    else if (name.endsWith('.svelte')) out.push(relative(SRC, full))
  }
  return out.sort()
}

describe('the accessibility sweep covers every route (M1.21)', () => {
  it('has unique ids and says what each route is', () => {
    const ids = ROUTES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of ROUTES) {
      expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(r.state.length, r.id).toBeGreaterThan(8)
      expect(r.covers.length, r.id).toBeGreaterThan(0)
    }
    expect(PREVIEW_ROUTES.length + DEV_SERVER_ROUTES.length).toBe(ROUTES.length)
  })

  it('has a route for every HTML page, build and dev-only', () => {
    const pages = [...Object.values(PAGES).map((p) => p.slice(p.lastIndexOf('/') + 1)), ...DEV_ONLY_PAGES]
    expect(pages.sort()).toEqual(readdirSync(WEB).filter((f) => f.endsWith('.html')).sort())
    for (const page of pages) expect(isCovered(page), `${page} has no route in e2e/routes.ts`).toBe(true)
  })

  it('has a route for the dev-only pages on the dev server, and none of the build pages there', () => {
    expect(DEV_SERVER_ROUTES.flatMap((r) => r.covers).filter((c) => c.endsWith('.html')).sort()).toEqual([...DEV_ONLY_PAGES].sort())
    for (const r of PREVIEW_ROUTES) expect(r.covers.filter((c) => DEV_ONLY_PAGES.includes(c)), r.id).toEqual([])
  })

  it('has a route for every hash route: the privacy notice and each dev route', () => {
    const hashes = ['#/privacy', ...Object.keys(DEV_ROUTES).map((name) => `#/dev/${name}`)]
    for (const h of hashes) expect(isCovered(h), `${h} has no route in e2e/routes.ts`).toBe(true)
    // The privacy route is the one App.svelte switches on.
    expect(readFileSync(join(SRC, 'App.svelte'), 'utf8')).toContain("'#/privacy'")
  })

  it('reaches the session segments by their A15 titles, in order (the renderers test below sees that each segment shows something)', () => {
    expect(SEGMENT_TITLES).toEqual(A15_SEGMENTS.map((s) => SEGMENT_INFO[s.id].title))
    expect(SEGMENT_TITLES).toHaveLength(6)
  })

  it('has a route that draws every block and item renderer', () => {
    const renderers = [...Object.keys(ENTRY_RENDERERS)]
    expect(renderers.length).toBeGreaterThan(0)
    // One Svelte file per renderer family (span and RT each serve two families).
    const files = new Set(
      svelteFiles(join(SRC, 'render'))
        .filter((f) => /Renderer\.svelte$/.test(f))
        .map((f) => `render/${f.slice('render/'.length)}`),
    )
    for (const f of files) expect(isCovered(f), `${f} has no route in e2e/routes.ts`).toBe(true)
  })

  it('has a route for every screen component of the flow, the results, the pages and the dev tools', () => {
    /** Parts that only ever appear inside a screen that has a route: each names where. */
    const PARTS: Readonly<Record<string, string>> = {
      'App.svelte': 'the root of index.html (welcome and #/privacy)',
      'session/SessionApp.svelte': 'hosts every screen of the flow',
      'session/Screen.svelte': 'the wrapper of every screen',
      'session/Stage.svelte': 'hosts the renderers',
      'render/coding/Glyph.svelte': 'a symbol inside the coding renderer',
      'render/matrices/MatrixCellSvg.svelte': 'a cell inside the matrix renderer',
      'brief/ui/About.svelte': 'inside the notes builder (brief/ui)',
    }
    const dirs = ['session', 'reveal', 'render', 'dev', 'selftest', 'review', 'viz', 'brief']
    const missing = dirs.flatMap((d) => svelteFiles(join(SRC, d)).map((f) => `${d}/${f.slice(d.length + 1)}`)).concat(['App.svelte']).filter((f) => !isCovered(f) && PARTS[f] === undefined)
    expect(missing, 'screen components with no route in e2e/routes.ts (add the route, or list the part with where it appears)').toEqual([])
  })

  it('every claim in `covers` is true: the file, directory, page or hash route exists', () => {
    const hashes = new Set(['#/privacy', ...Object.keys(DEV_ROUTES).map((name) => `#/dev/${name}`)])
    const wrong: string[] = []
    for (const r of ROUTES) {
      for (const c of r.covers) {
        const ok = c.startsWith('#') ? hashes.has(c) : c.endsWith('.html') ? existsSync(join(WEB, c)) : existsSync(join(SRC, c))
        if (!ok) wrong.push(`${r.id}: ${c}`)
      }
    }
    expect(wrong).toEqual([])
  })
})
