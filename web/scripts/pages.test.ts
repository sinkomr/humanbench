/**
 * HTML pages of the build (ROADMAP M1.23, M1.20, M1.A): every `web/*.html` is a Vite build input
 * (`PAGES` in vite.config.ts), so `vite preview` and GitHub Pages serve it, and is scanned by the
 * language lint (A13). The RT timing self-test is one such page, `<base>rt-selftest.html`, and
 * is not indexed by search engines.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PAGES } from '../vite.config'
import { SCAN_FILES } from './language-lint'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const HTML = readdirSync(WEB).filter((f) => f.endsWith('.html'))

describe('HTML pages', () => {
  it('every web/*.html is a build input, and every input exists', () => {
    expect(HTML.sort()).toEqual(Object.values(PAGES).map((p) => basename(p)).sort())
    expect(HTML).toEqual(expect.arrayContaining(['index.html', 'rt-selftest.html']))
  })

  it('every web/*.html is scanned by the language lint (A13)', () => {
    for (const f of HTML) expect(SCAN_FILES).toContain(`web/${f}`)
  })

  it('the self-test page mounts its own entry and asks not to be indexed', () => {
    const html = readFileSync(`${WEB}rt-selftest.html`, 'utf8')
    expect(html).toContain('<script type="module" src="/src/selftest/main.ts"></script>')
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).toContain('<html lang="en">')
  })
})
