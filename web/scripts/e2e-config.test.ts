/**
 * Guards the Playwright harness wiring (ROADMAP M1.A, A3; CLAUDE.md: e2e incl. WebKit/iOS
 * emulation) without launching a browser: the three projects, the /humanbench/ base path against a
 * fresh `vite preview` of the production build, the npm scripts, and the CI job.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
  })

  it('tests a fresh vite preview of the production build under /humanbench/', () => {
    expect(config.use?.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/humanbench\/$/)
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer
    expect(server?.command).toMatch(/^npm run build && npm run preview -- .*--strictPort/)
    expect(server?.env).toEqual({ VITE_BASE: '/humanbench/' })
    expect(server?.reuseExistingServer).toBe(false)
    expect(server?.url).toBe(config.use?.baseURL)
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
