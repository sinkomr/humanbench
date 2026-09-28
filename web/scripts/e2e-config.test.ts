/**
 * Guards the Playwright harness wiring (ROADMAP M1.A, A3; CLAUDE.md: e2e incl. WebKit/iOS
 * emulation) without launching a browser: the three projects, the /humanbench/ base path against a
 * fresh `vite preview` of the production build, the dev server for dev-only pages (M1.13), the npm
 * scripts, and the CI job.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BLOCKING_IMPACTS, WCAG_AA_TAGS } from '../e2e/axe'
import { REVIEW_URL, visualGalleryUrl } from '../e2e/dev-server'
import config from '../playwright.config'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string): string => readFileSync(`${WEB}${p}`, 'utf8')

describe('Playwright config (M1.A)', () => {
  it('runs e2e/*.spec.ts in Chromium, WebKit and an iPhone 13 on WebKit', () => {
    expect(config.testDir).toMatch(/e2e$/)
    const projects = config.projects ?? []
    expect(projects.map((p) => p.name)).toEqual(['chromium', 'webkit', 'iphone'])
    const [chromium, webkit, iphone] = projects
    expect(chromium?.use?.defaultBrowserType).toBe('chromium')
    expect(webkit?.use?.defaultBrowserType).toBe('webkit')
    expect(iphone?.use).toMatchObject({ defaultBrowserType: 'webkit', isMobile: true, hasTouch: true })
    expect(iphone?.use?.userAgent).toMatch(/iPhone/)
    // WebKit is slowest on a loaded machine, so it gets more than the default budget.
    expect(config.timeout).toBeGreaterThanOrEqual(60_000)
    for (const p of [webkit, iphone]) expect(p?.timeout ?? 0, p?.name).toBeGreaterThan(config.timeout ?? 0)
  })

  it('tests a fresh vite preview of the production build under /humanbench/', () => {
    expect(config.use?.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/humanbench\/$/)
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer
    expect(server?.command).toMatch(/^npm run build && npm run preview -- .*--strictPort/)
    // Plus the dev-only routes (M1.16 blob demo); scripts/dev-routes.test.ts keeps them out of Pages.
    expect(server?.env).toEqual({ VITE_BASE: '/humanbench/', VITE_HB_DEV_ROUTES: '1' })
    expect(server?.reuseExistingServer).toBe(false)
    expect(server?.url).toBe(config.use?.baseURL)
  })

  it('also starts a fresh Vite dev server for the dev-only pages (M1.13 galleries, M1.G7 review page)', () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    expect(servers).toHaveLength(2)
    const dev = servers[1]
    expect(dev?.command).toMatch(/^npx vite --host 127\.0\.0\.1 --port \d+ --strictPort$/)
    expect(dev?.command).not.toMatch(/build|preview/)
    expect(dev?.env).toEqual({ VITE_BASE: '/humanbench/' })
    expect(dev?.reuseExistingServer).toBe(false)
    expect(dev?.url).toBe(REVIEW_URL)
    expect(dev?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/humanbench\/review\.html$/)
    // Both dev-only pages live on the same server.
    expect(new URL(visualGalleryUrl()).origin).toBe(new URL(dev?.url ?? '').origin)
    expect(visualGalleryUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/humanbench\/render-visual\.html$/)
    // A different port from the preview's.
    expect(new URL(dev?.url ?? '').port).not.toBe(new URL(config.use?.baseURL ?? '').port)
  })

  it('checks axe against WCAG 2.0, 2.1 and 2.2 at A and AA, failing on serious and critical (§13)', () => {
    // §13 asks for WCAG 2.2 AA; axe tags each rule with the WCAG version that added it, so dropping a
    // version's tags silently drops its rules (the e2e helper test covers 2.1 AA and 2.2 AA by example).
    expect([...WCAG_AA_TAGS].sort()).toEqual(['wcag21a', 'wcag21aa', 'wcag22aa', 'wcag2a', 'wcag2aa'])
    expect([...BLOCKING_IMPACTS].sort()).toEqual(['critical', 'serious'])
  })

  it('has the npm scripts, and a CI job that installs browsers and runs the suite', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; devDependencies: Record<string, string> }
    expect(pkg.scripts.e2e).toBe('playwright test')
    expect(pkg.scripts['e2e:install']).toBe('playwright install --with-deps chromium webkit')
    expect(Object.keys(pkg.devDependencies)).toEqual(expect.arrayContaining(['@playwright/test', '@axe-core/playwright']))
    const ci = read('../.github/workflows/ci.yml')
    const job = ci.slice(ci.indexOf('\n  e2e:'))
    expect(job.length).toBeGreaterThan(10)
    for (const step of ['npm ci', 'npm run e2e:install', 'npx playwright install-deps chromium webkit', 'npm run e2e', 'actions/cache@', '~/.cache/ms-playwright']) {
      expect(job).toContain(step)
    }
  })
})
