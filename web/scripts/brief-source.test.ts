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

  it('imports nothing from scoring, saves, tasks or renderers (scoring isolation), except the save module\'s types for the stored form', () => {
    const FORBIDDEN = /^(?:engine|save|session|tasks|render|viz|review|selftest|sim|dev)\//
    for (const f of files) {
      const text = readFileSync(join(DIR, f), 'utf8')
      const imports = [...text.matchAll(/(?:import|export)(\s+type)?\s[^'"]*?from\s+'(\.\.?\/[^']+)'/g)].map((m) => ({ type: m[1] !== undefined, path: m[2] as string }))
      for (const i of imports) {
        // Resolved against src/, so `../render` from src/brief/ui/ (the notes' own renderer) is not src/render/.
        const target = posix.normalize(posix.join('brief', posix.dirname(f), i.path))
        // The page entry reads the month through the one module allowed to read the wall clock.
        if (target === 'save/clock') continue
        // The stored form of the settings is the save module's type (AI.7): a type is erased, so no save code runs in the notes.
        if (i.type && target === 'save/types' && (f === 'stored.ts' || f === 'store-types.ts')) continue
        // The page entry asks the session's consent record whether the person already passed the 18+ gate (M1.15, AI.5): reading it writes nothing.
        if (f === 'main.ts' && target === 'session/gate') continue
        // The page entry hands the page the store that keeps the settings (brief-store/, which is checked below).
        if (f === 'main.ts' && target === 'brief-store/persist') continue
        expect(FORBIDDEN.test(`${target}/`), `${f} imports ${i.path} (src/${target})`).toBe(false)
      }
    }
  })

  it('reads no clock and draws no random numbers in the generator files', () => {
    const generator = ['build.ts', 'grammar.ts', 'render.ts', 'parse.ts', 'match.ts', 'lint.ts', 'sanitize.ts', 'normalize.ts', 'validate.ts', 'topics.ts', 'gates.ts', 'surfaces.ts', 'prefs.ts', 'dump.ts', 'contexts.ts', 'interests.ts', 'check.ts', 'diff.ts', 'meaning.ts', 'retired.ts', 'returning.ts', 'results-talk.ts', 'results-talk-gate.ts', 'fit.ts', 'stored.ts', 'builder.ts', 'store-types.ts']
    for (const f of generator) {
      expect(files, f).toContain(f)
      expect(/Date\.now|new Date\b|\bDate\(\)|Math\.random|getRandomValues|randomUUID|performance\./.test(source(f)), f).toBe(false)
    }
  })

  it('has no `eval`, `new Function` or `innerHTML` in any file', () => {
    for (const f of files) expect(/\beval\s*\(|new Function\b|\.innerHTML\b|document\.write/.test(source(f)), f).toBe(false)
  })
})

describe('the rest of the app reaches the notes only through the light reveal barrel (AI.6b, R-17.13)', () => {
  const SRC = join(PUB_ROOT, 'web', 'src')
  const ALLOWED = new Set(['brief/reveal', 'brief/results-talk', 'brief/results-talk-gate'])
  const all = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => /\.(ts|svelte)$/.test(f) && !/\.test\.ts$|\.svelte\.test\.ts$|(^|\/)testing\.ts$|__fixtures__|__snapshots__/.test(f))
  const outside = all.filter((f) => !f.startsWith('brief/') && !f.startsWith('brief-store/') && !f.startsWith('dev/'))

  /** Notes module paths (`brief/...`, relative to src/) that `file` imports. */
  const notesImports = (file: string): string[] =>
    [...readFileSync(join(SRC, file), 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\.\.?\/[^']+)'/g)]
      .map((m) => posix.normalize(posix.join(posix.dirname(file), m[1] as string)).replace(/\.(ts|svelte|js)$/, ''))
      .filter((t) => t === 'brief' || t.startsWith('brief/') || t.startsWith('brief-store/'))

  it('scans the app (not vacuous) and finds the barrel the demo uses', () => {
    expect(outside.length).toBeGreaterThan(50)
    expect(notesImports('dev/RevealAiDemo.svelte')).toEqual(['brief/reveal'])
    expect(notesImports('render/common/props.ts')).toEqual([]) // a file with no import of the notes
  })

  it('imports only the reveal barrel or the results-talk texts: never the grammar, the checker, the builder or a store', () => {
    for (const f of outside) for (const t of notesImports(f)) expect(ALLOWED.has(t), `${f} imports src/${t}`).toBe(true)
  })

  // OPEN until M1.18: no share-card renderer exists yet (nothing in src/ has "share" in its name), so a
  // check over "the share files" would pass on an empty list and prove nothing. It is a todo while the list
  // is empty, and a real check the moment M1.18 adds a file (AI.6b acceptance: the renderer never contains
  // notes strings; M1.18 also adds a test of its output against NOTES_LEAK_MARKERS).
  const share = all.filter((f) => /share/i.test(f))
  if (share.length === 0) it.todo('a share-card renderer imports nothing from the notes at all (proposal AI.6b; open until M1.18 adds the renderer)')
  else {
    it('a share-card renderer imports nothing from the notes at all (proposal AI.6b: it never contains notes strings)', () => {
      for (const f of share) expect(notesImports(f), f).toEqual([])
    })
  }
})

describe('src/brief-store/ (AI.7): where the settings are kept', () => {
  const STORE = join(PUB_ROOT, 'web', 'src', 'brief-store')
  const stored = readdirSync(STORE, { encoding: 'utf8' }).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
  const code = (f: string): string => strip(readFileSync(join(STORE, f), 'utf8'))

  it('has source to scan', () => {
    expect(stored).toContain('persist.ts')
  })

  it('names no network API and reads no clock or random source of its own', () => {
    const banned = /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share|importScripts|new Worker\b|serviceWorker|document\.cookie|indexedDB|Date\.now|new Date\b|\bDate\(\)|Math\.random|getRandomValues|randomUUID|performance\.)/
    for (const f of stored) expect(banned.exec(code(f))?.[0], f).toBeUndefined()
  })

  it('reaches storage only through the save module\'s autosave (no direct localStorage), and never imports scoring, tasks or renderers', () => {
    for (const f of stored) {
      const text = code(f)
      expect(/\b(localStorage|sessionStorage)\b/.test(text), f).toBe(false)
      const imports = [...text.matchAll(/from\s+'(\.\.?\/[^']+)'/g)].map((m) => m[1] as string)
      for (const i of imports) {
        const target = posix.normalize(posix.join('brief-store', i))
        expect(/^(?:engine|tasks|render|viz|review|selftest|sim|dev)\//.test(`${target}/`), `${f} imports ${i}`).toBe(false)
        // the notes themselves: only the types of the stored form, never the generator
        if (target.startsWith('brief/')) expect(['brief/store-types', 'brief/stored'], `${f} imports ${i}`).toContain(target)
      }
    }
  })

  it('is imported by the page entry alone: nothing in the generator or the rest of the app reaches it', () => {
    const src = join(PUB_ROOT, 'web', 'src')
    const all = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .map((f) => f.split('\\').join('/'))
      .filter((f) => /\.(ts|svelte)$/.test(f) && !/\.test\.ts$|\.svelte\.test\.ts$|(^|\/)testing\.ts$|__fixtures__|__snapshots__/.test(f))
    for (const f of all) {
      if (f.startsWith('brief-store/') || f === 'brief/main.ts') continue
      expect(/from\s+'[^']*brief-store\/[^']*'/.test(readFileSync(join(src, f), 'utf8')), f).toBe(false)
    }
  })
})
