/**
 * Repo-wide timing and determinism lint over `web/src` (CLAUDE.md "Timing code: rAF-locked
 * onset, performance.now(); never Date.now() for RT"; DESIGN §11.6; ROADMAP A11; audit: the
 * earlier lint covered only `src/tasks/rt/`).
 *
 * Every `.ts`, `.js` and `.svelte` file under `web/src`, tests included, is parsed with the
 * TypeScript compiler, so comments and strings never match:
 * - **clock** (all of `src/`): no `Date.now`, no argless `new Date()` / `new Date`, no `Date()`
 *   call. Response times come from `performance.now()` and rAF timestamps only. `new Date(x)` with
 *   an argument (parsing or formatting a given time) is fine.
 * - **random** (`src/engine/`, `src/tasks/`, `src/render/`, `src/viz/`, `src/session/`,
 *   `src/reveal/`, `src/brief/`): no `Math.random`, `getRandomValues` or `randomUUID`. Items and
 *   scores must regenerate from their seed (A11): draw from the seeded engine stream. Renderers
 *   must never reorder or randomise what the spec fixes (A18: option order is the item's), and the
 *   blob draws the same for a given profile (§9.3), so both are covered too. The session run and
 *   practice pick the items and the reveal draws its worked examples from the session id (A11), and
 *   the notes text is a pure function of the person's choices, so those three are covered as well.
 *   `save/ids.ts` (crypto session ids) stays outside.
 *
 * A file that legitimately needs one of these (e.g. a save file's wall-clock `created_at`, §8)
 * goes in {@link ALLOW} with the rule and the reason; stale entries fail. Svelte markup outside
 * `<script>` is checked with plain patterns after its HTML comments are removed.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PUB_ROOT } from './dump-lib'

type Rule = 'clock' | 'random'

interface Hit {
  readonly rule: Rule
  readonly what: string
  readonly line: number
}

const SRC = join(PUB_ROOT, 'web', 'src')

/**
 * Files allowed to use a banned API, by path under `web/src` (posix) → rule → why. Keep it empty
 * unless there is no clock-free or seeded alternative.
 */
const ALLOW: Readonly<Record<string, Partial<Record<Rule, string>>>> = {
  'save/clock.ts': { clock: 'save-file metadata only (§8 created_utc, started_utc, session-id time prefix); never RT' },
  'brief/browser.ts': { random: 'download file-name and fit-note id tokens that only have to differ between downloads (AI.5); never an item, a score or the notes text' },
}

/** Directories (under `web/src`) where the random rule applies (module comment; A11, A18). */
const SEEDED_DIRS = ['engine/', 'tasks/', 'render/', 'viz/', 'session/', 'reveal/', 'brief/']

/** Whether the random rule applies to a file (posix path under `web/src`). */
const isSeeded = (f: string): boolean => SEEDED_DIRS.some((d) => f.startsWith(d))

const RANDOM_MEMBERS = new Set(['random', 'getRandomValues', 'randomUUID'])

/** Banned uses in one TS/JS source text (see the module comment). */
function scanScript(text: string, fileName = 'x.ts'): Hit[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const hits: Hit[] = []
  const at = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const isId = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name
  const memberName = (node: ts.Node): string | undefined => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
    return undefined
  }
  const visit = (node: ts.Node): void => {
    const member = memberName(node)
    if (member !== undefined && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      if (member === 'now' && isId(node.expression, 'Date')) hits.push({ rule: 'clock', what: 'Date.now', line: at(node) })
      if (member === 'random' && isId(node.expression, 'Math')) hits.push({ rule: 'random', what: 'Math.random', line: at(node) })
      if (member !== 'random' && RANDOM_MEMBERS.has(member)) hits.push({ rule: 'random', what: member, line: at(node) })
    }
    if (ts.isNewExpression(node) && isId(node.expression, 'Date') && (node.arguments === undefined || node.arguments.length === 0)) {
      hits.push({ rule: 'clock', what: 'argless new Date()', line: at(node) })
    }
    if (ts.isCallExpression(node) && isId(node.expression, 'Date')) hits.push({ rule: 'clock', what: 'Date() call', line: at(node) })
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g
const MARKUP_BANNED: readonly [Rule, string, RegExp][] = [
  ['clock', 'Date.now', /\bDate\s*\.\s*now\b/],
  ['clock', 'argless new Date()', /\bnew\s+Date\b(?!\s*\(\s*[^\s)])/],
  ['random', 'Math.random', /\bMath\s*\.\s*random\b/],
]

/** Banned uses in a Svelte component: its `<script>` blocks parsed as TS, then its markup. */
function scanSvelte(text: string): Hit[] {
  const hits: Hit[] = []
  const lineOf = (offset: number): number => text.slice(0, offset).split('\n').length
  for (const m of text.matchAll(SCRIPT_RE)) {
    const body = m[1] ?? ''
    const offset = (m.index ?? 0) + m[0].indexOf(body)
    const first = lineOf(offset) - 1
    for (const h of scanScript(body)) hits.push({ ...h, line: h.line + first })
  }
  const markup = text.replace(SCRIPT_RE, (s) => s.replace(/[^\n]/g, ' ')).replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '))
  markup.split('\n').forEach((line, i) => {
    for (const [rule, what, re] of MARKUP_BANNED) if (re.test(line)) hits.push({ rule, what, line: i + 1 })
  })
  return hits
}

/** Every `.ts`, `.js` and `.svelte` file under `web/src`, as posix paths relative to it. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|js|svelte)$/.test(f))
    .map((f) => f.split(sep).join('/'))
    .sort()
}

function violations(): string[] {
  const out: string[] = []
  for (const f of sourceFiles()) {
    const text = readFileSync(join(SRC, f), 'utf8')
    const hits = f.endsWith('.svelte') ? scanSvelte(text) : scanScript(text, f)
    for (const h of hits) {
      if (h.rule === 'random' && !isSeeded(f)) continue
      if (ALLOW[f]?.[h.rule] !== undefined) continue
      out.push(`src/${f}:${h.line}: ${h.what} (${h.rule})`)
    }
  }
  return out
}

describe('timing and determinism lint over web/src (CLAUDE.md, §11.6, A11)', () => {
  it('scans the whole app tree, tests and Svelte components included', () => {
    const files = sourceFiles()
    for (const f of ['App.svelte', 'main.ts', 'engine/scorer.ts', 'tasks/family.ts', 'tasks/rt/timing.ts', 'tasks/coding/score.ts', 'tasks/reading/score.ts', 'engine/types.test.ts']) {
      expect(files).toContain(f)
    }
    expect(files.length).toBeGreaterThan(100)
  })

  it('no file reads the wall clock, and nothing in engine/, tasks/, render/, viz/, session/, reveal/ or brief/ uses an unseeded random source', () => {
    expect(violations()).toEqual([])
  })

  it('applies the random rule to renderers, the viz, the session run and the reveal, not to save-file ids (A11, A18, §9.3)', () => {
    for (const f of ['engine/prng.ts', 'tasks/family.ts', 'render/choice/OptionGroup.svelte', 'render/entry.ts', 'viz/profile.ts', 'viz/BlobChart.svelte', 'session/run.ts', 'session/practice.ts', 'reveal/Reveal.svelte', 'brief/build.ts']) expect(isSeeded(f), f).toBe(true)
    for (const f of ['save/ids.ts', 'save/clock.ts', 'App.svelte', 'review/verdicts.ts']) expect(isSeeded(f), f).toBe(false)
    const files = sourceFiles()
    for (const d of SEEDED_DIRS) expect(files.some((f) => f.startsWith(d)), d).toBe(true)
  })

  it('allow-list entries are justified and still needed', () => {
    for (const [f, rules] of Object.entries(ALLOW)) {
      const text = readFileSync(join(SRC, f), 'utf8')
      const hits = f.endsWith('.svelte') ? scanSvelte(text) : scanScript(text, f)
      for (const [rule, why] of Object.entries(rules)) {
        expect(why?.trim().length ?? 0, `${f} ${rule}: give a reason`).toBeGreaterThan(10)
        expect(hits.some((h) => h.rule === rule), `${f} no longer needs ${rule}`).toBe(true)
      }
    }
  })

  it('flags each banned form, and not comments, strings, performance.now or dated Date objects', () => {
    const src = [
      'const a = Date.now()',
      "const b = Date['now']()",
      'const c = new Date()',
      'const d = new Date',
      'const e = Date()',
      'const f = Math.random()',
      'const g = crypto.getRandomValues(new Uint8Array(4))',
      'const h = globalThis.crypto.randomUUID()',
      'const pick = Math.random',
    ].join('\n')
    expect(scanScript(src).map((h) => `${h.line} ${h.rule} ${h.what}`)).toEqual([
      '1 clock Date.now',
      '2 clock Date.now',
      '3 clock argless new Date()',
      '4 clock argless new Date()',
      '5 clock Date() call',
      '6 random Math.random',
      '7 random getRandomValues',
      '8 random randomUUID',
      '9 random Math.random',
    ])
    const clean = [
      '// never Date.now() or Math.random() here',
      '/* new Date() */',
      "const s = 'Date.now() and Math.random()'",
      'const t = `new Date()`',
      'const u = performance.now()',
      'const v = new Date(0).toISOString()',
      'const w = rng.random()',
      'const x = /Date\\.now\\(\\)/',
    ].join('\n')
    expect(scanScript(clean)).toEqual([])
  })

  it('checks Svelte scripts and markup, with line numbers in the component', () => {
    const svelte = ['<script lang="ts">', '  // Date.now() in a comment', '  const t0 = Date.now()', '</script>', '<!-- {Math.random()} -->', '<p>{new Date()}</p>', '<p>{new Date(0)}</p>'].join('\n')
    expect(scanSvelte(svelte).map((h) => `${h.line} ${h.what}`)).toEqual(['3 Date.now', '6 argless new Date()'])
  })
})
