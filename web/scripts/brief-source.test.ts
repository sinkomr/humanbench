/**
 * Source-level guarantees of the notes core (`src/brief/`; Phase AI, R-17.1, R-17.12):
 * - **local only**: no storage API and no network API is named anywhere in it (the builder page
 *   adds only the clipboard and a file download, which are not storage);
 * - **no clock, no randomness in the generator**: the month is passed in, so the same settings
 *   always give the same bytes (the file-name token is drawn by the page, not the generator);
 * - **scoring isolation**: nothing in it imports scoring, saves, task families or renderers, so
 *   the notes cannot read or change results (proposal §7.2).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUB_ROOT } from './dump-lib'

const DIR = join(PUB_ROOT, 'web', 'src', 'brief')
const files = readdirSync(DIR, { recursive: true, encoding: 'utf8' })
  .map((f) => f.split('\\').join('/'))
  .filter((f) => /\.(ts|svelte)$/.test(f) && !/\.test\.ts$|(^|\/)testing\.ts$|__fixtures__/.test(f))
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const source = (f: string): string => strip(readFileSync(join(DIR, f), 'utf8'))

describe('src/brief/ (R-17.1: local only)', () => {
  it('has source files to scan', () => {
    expect(files).toEqual(expect.arrayContaining(['build.ts', 'grammar.ts', 'render.ts', 'parse.ts', 'lint.ts', 'surfaces.ts']))
  })

  it('names no storage or network API', () => {
    const banned = /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\b|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share|importScripts|new Worker\b|serviceWorker)/
    for (const f of files) expect(banned.exec(source(f))?.[0], f).toBeUndefined()
  })

  it('imports nothing from scoring, saves, tasks or renderers (scoring isolation)', () => {
    const FORBIDDEN = /^(?:engine|save|tasks|render|viz|review|selftest|sim|dev)\//
    for (const f of files) {
      const imports = [...readFileSync(join(DIR, f), 'utf8').matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => m[1] as string)
      for (const i of imports) {
        // Resolved against src/, so `../render` from src/brief/ui/ (the notes' own renderer) is not src/render/.
        const target = posix.normalize(posix.join('brief', posix.dirname(f), i))
        // The page entry reads the month through the one module allowed to read the wall clock.
        if (target === 'save/clock') continue
        expect(FORBIDDEN.test(`${target}/`), `${f} imports ${i} (src/${target})`).toBe(false)
      }
    }
  })

  it('reads no clock and draws no random numbers in the generator files', () => {
    const generator = ['build.ts', 'grammar.ts', 'render.ts', 'parse.ts', 'match.ts', 'lint.ts', 'sanitize.ts', 'normalize.ts', 'validate.ts', 'topics.ts', 'gates.ts', 'surfaces.ts', 'prefs.ts', 'dump.ts', 'contexts.ts', 'interests.ts']
    for (const f of generator) {
      expect(files, f).toContain(f)
      expect(/Date\.now|new Date\b|\bDate\(\)|Math\.random|getRandomValues|randomUUID|performance\./.test(source(f)), f).toBe(false)
    }
  })

  it('has no `eval`, `new Function` or `innerHTML` in any file', () => {
    for (const f of files) expect(/\beval\s*\(|new Function\b|\.innerHTML\b|document\.write/.test(source(f)), f).toBe(false)
  })
})
