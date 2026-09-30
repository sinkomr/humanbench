/**
 * HTML pages of the build (ROADMAP M1.23, M1.20, M1.A, M1.13, M1.G7): every `web/*.html` is either
 * a Vite build input (`PAGES` in vite.config.ts), so `vite preview` and GitHub Pages serve it, or a
 * dev-only page (`DEV_ONLY_PAGES`) that no build includes; every one is scanned by the language
 * lint (A13). The RT timing self-test is a build page, `<base>rt-selftest.html`, and is not indexed
 * by search engines.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SURFACES, STALE_AFTER_DAYS, surfacesStaleness } from '../src/brief/surfaces'
import { DEV_ONLY_PAGES, PAGES, SURFACES_STALE_AFTER_DAYS, surfacesStaleWarning } from '../vite.config'
import { SCAN_FILES } from './language-lint'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const HTML = readdirSync(WEB).filter((f) => f.endsWith('.html'))

describe('HTML pages', () => {
  it('every web/*.html is a build input or a dev-only page, and every listed page exists', () => {
    const built = Object.values(PAGES).map((p) => basename(p))
    expect(HTML.sort()).toEqual([...built, ...DEV_ONLY_PAGES].sort())
    expect(built.filter((p) => DEV_ONLY_PAGES.includes(p))).toEqual([])
    expect(built.sort()).toEqual(['index.html', 'notes.html', 'rt-selftest.html'])
  })

  it('every web/*.html is scanned by the language lint (A13)', () => {
    for (const f of HTML) expect(SCAN_FILES).toContain(`web/${f}`)
  })

  it('the notes page mounts its own entry, is titled and described, and needs no external file (Phase AI)', () => {
    const html = readFileSync(`${WEB}notes.html`, 'utf8')
    expect(html).toContain('<script type="module" src="/src/brief/main.ts"></script>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<title>Notes for your AI')
    expect(html).not.toMatch(/https?:\/\/|<link[^>]+stylesheet/)
  })

  it('the build warns when the notes builder\'s destination data is older than 120 days, with the same rule as the page (AI.4)', () => {
    expect(SURFACES_STALE_AFTER_DAYS).toBe(STALE_AFTER_DAYS)
    for (const today of ['2026-09-29', '2027-01-26', '2027-01-27', '2030-01-01']) {
      expect(surfacesStaleWarning(SURFACES.checked, today) === null, today).toBe(!surfacesStaleness(today).stale)
    }
    expect(surfacesStaleWarning('2026-09-28', '2027-01-26')).toBeNull()
    expect(surfacesStaleWarning('2026-09-28', '2027-01-27')).toContain('121 days ago')
    expect(surfacesStaleWarning('soon', '2027-01-27')).toContain('unreadable')
    // the bundled data is fresh on the day it was assembled, so a normal build prints nothing
    expect(surfacesStaleWarning(SURFACES.checked, SURFACES.checked)).toBeNull()
  })

  it('the self-test page mounts its own entry and asks not to be indexed', () => {
    const html = readFileSync(`${WEB}rt-selftest.html`, 'utf8')
    expect(html).toContain('<script type="module" src="/src/selftest/main.ts"></script>')
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).toContain('<html lang="en">')
  })
})
