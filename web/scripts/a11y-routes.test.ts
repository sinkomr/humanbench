/**
 * The route list of the accessibility sweep is complete (ROADMAP M1.21: "axe 0 serious/critical on
 * EVERY route"; Phase AI AI.5: the notes builder joins the list). `e2e/routes.ts` is what
 * `e2e/a11y.spec.ts` walks; this test fails, without a browser, when something a person can reach has
 * no entry there:
 *
 * - every HTML page (`web/*.html`, build and dev-only) and every hash route (`#/privacy`, `#/dev/*`);
 * - every block and item renderer, which with the segment titles (A15) covers every part of the session;
 * - every screen component of the session flow, the results and the other pages;
 * - the claims in `covers` are true (the file exists), so a rename cannot leave a stale entry, and a claim of a
 *   renderer is a claim about the page: `RENDERER_ROOTS` names what each renderer draws and the sweep checks it
 *   (`openRoute`);
 * - no route can be dropped unseen: each is either the only one to cover something, or pinned by name as a state.
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
import { DEV_SERVER_ROUTES, PREVIEW_ROUTES, RENDERER_ROOTS, ROUTES, SEGMENT_TITLES } from '../e2e/routes'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(WEB, 'src')

const covers = ROUTES.flatMap((r) => r.covers)

/**
 * `covers` names a file under src/, an HTML page of web/, or a hash route; each by its exact name. A directory
 * is not a claim: a component added to a folder that some route draws would otherwise count as drawn.
 */
function isCovered(target: string): boolean {
  return covers.includes(target)
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
    }
    const dirs = ['session', 'reveal', 'render', 'dev', 'selftest', 'review', 'viz', 'brief']
    const missing = dirs.flatMap((d) => svelteFiles(join(SRC, d)).map((f) => `${d}/${f.slice(d.length + 1)}`)).concat(['App.svelte']).filter((f) => !isCovered(f) && PARTS[f] === undefined)
    expect(missing, 'screen components with no route in e2e/routes.ts (add the route, or list the part with where it appears)').toEqual([])
  })

  /**
   * Routes that show a state of a screen or renderer that other routes also cover: an error, a notice, a second look, a
   * block at another moment. The completeness checks above are per component and do not notice these go; dropping one is a
   * decision, so it is made here, where it can be seen, and not by deleting a route.
   */
  const STATES = [
    // the start of the flow
    'welcome-returning',
    'gate',
    'gate-error',
    'gate-under-18',
    'ready',
    'ready-returning',
    'practice',
    'practice-feedback',
    // the running session
    'rt-intro',
    'rt-trial',
    'confirm-skip',
    'confirm-finish',
    'item-spatial-no-webgl',
    'memory-intro',
    'coding-intro',
    'coding-running',
    'reading-passage',
    'reading-questions',
    'break-offer',
    'on-break',
    'finished-nothing',
    // the results
    'results-building',
    'results-drilldown',
    'results-bars',
    'results-open',
    'results-view',
    'results-leave',
    'results-saved',
    'share-card-dark',
    'share-card-too-few',
    // the notes builder
    'notes-filled',
    'notes-fit',
    'notes-keep-error',
    'notes-kept',
    'notes-returning',
    'notes-checker',
    // the self-test
    'rt-selftest-keys',
    'rt-selftest-results',
    // the development pages
    'dev-blob',
    'dev-blob-m1',
    'dev-reveal-ai',
    'dev-reveal-ai-share',
    'dev-fermi',
    'dev-fermi-notes',
    'dev-fermi-feedback',
    'dev-emotion',
    'dev-emotion-tip',
    'dev-emotion-feedback',
  ]

  it('keeps the routes for the states of a screen that its component alone does not show (an error, a notice, a second look)', () => {
    const ids = new Set(ROUTES.map((r) => r.id))
    expect(STATES.filter((id) => !ids.has(id))).toEqual([])
    expect(new Set(STATES).size, 'a state is listed once').toBe(STATES.length)
  })

  it('lets no route go unseen: each is the only one to cover something, or is listed as a state above', () => {
    // A route that nothing else could replace fails the completeness checks when it is deleted. One that shares every
    // claim with another route (a second state of the same screen) would pass them, so it must be named as a state.
    const unpinned = ROUTES.filter((r) => !STATES.includes(r.id) && r.covers.every((c) => ROUTES.some((o) => o !== r && o.covers.includes(c)))).map((r) => r.id)
    expect(unpinned, 'routes that share every claim with another and are not listed in STATES (list them, or give them a claim of their own)').toEqual([])
  })

  it('names what every renderer draws, so that a claim of one is checked against the page', () => {
    const renderers = svelteFiles(join(SRC, 'render')).filter((f) => /Renderer\.svelte$/.test(f))
    expect(renderers.length).toBeGreaterThan(0)
    for (const f of renderers) expect(RENDERER_ROOTS[f], `${f} has no entry in RENDERER_ROOTS (e2e/routes.ts)`).toBeDefined()
    for (const [file, selector] of Object.entries(RENDERER_ROOTS)) {
      const source = readFileSync(join(SRC, file), 'utf8')
      // `section.hb-render.coding` -> the classes `hb-render` and `coding`, written in the component's own markup.
      const classes = selector.split('.').slice(1)
      expect(classes.length, selector).toBeGreaterThan(0)
      for (const c of classes) expect(source, `${file} does not draw ${selector}`).toMatch(new RegExp(`class="[^"]*\\b${c}\\b`))
    }
  })

  it('claims no renderer on a route that can only draw it by chance (the session serves its items at random)', () => {
    for (const r of ROUTES.filter((x) => x.group === 'session' && x.covers.some((c) => c.startsWith('session/Stage')))) {
      expect(r.covers.filter((c) => RENDERER_ROOTS[c] !== undefined), `${r.id} plays whichever item comes first`).toEqual([])
    }
  })

  it('every claim in `covers` is true: the file, page or hash route exists (a directory is not a claim)', () => {
    const hashes = new Set(['#/privacy', ...Object.keys(DEV_ROUTES).map((name) => `#/dev/${name}`)])
    const wrong: string[] = []
    for (const r of ROUTES) {
      for (const c of r.covers) {
        const ok = c.startsWith('#') ? hashes.has(c) : c.endsWith('.html') ? existsSync(join(WEB, c)) : existsSync(join(SRC, c)) && statSync(join(SRC, c)).isFile()
        if (!ok) wrong.push(`${r.id}: ${c}`)
      }
    }
    expect(wrong).toEqual([])
  })
})
