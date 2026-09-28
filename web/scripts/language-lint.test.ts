/**
 * Tests of the language lint (ROADMAP M1.20, A13; DESIGN R-5.6.1–R-5.6.5, §13): the repo is clean,
 * the fixtures under `scripts/fixtures/language-lint/` fail (banned.*) or pass (allowed.*) exactly
 * as expected, and fast-check properties pin case-insensitivity, word boundaries, file-type
 * handling, and the exactness of the two allowed texts.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DISCLAIMER, RESOURCE_LINE } from '../src/copy'
import {
  ALLOWED_TEXT,
  BANNED_TERMS,
  NOT_BANNED,
  REPO_ROOT,
  collectFiles,
  kindOf,
  lintFiles,
  lintRepo,
  lintText,
  main,
  type Hit,
  type MainIo,
} from './language-lint'

const WEB = join(REPO_ROOT, 'web')
const FIXTURES = 'web/scripts/fixtures/language-lint'
const fixture = (name: string): { path: string; text: string } => ({ path: `${FIXTURES}/${name}`, text: readFileSync(join(REPO_ROOT, FIXTURES, name), 'utf8') })
const summary = (hits: readonly Hit[]): string[] => hits.map((h) => `${h.line} ${h.term}${h.where === undefined ? '' : ` ${h.where}`}`)
const terms = (hits: readonly Hit[]): string[] => [...new Set(hits.map((h) => h.term))].sort()

/** Captures a {@link main} run. */
function run(argv: readonly string[]): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const io: MainIo = { out: (s) => (out += `${s}\n`), err: (s) => (err += `${s}\n`), cwd: WEB }
  const code = main(argv, io)
  return { code, out, err }
}

/** `s` as copy in each file type the lint reads, with the path that selects its scanner. */
const WRAPPERS: Readonly<Record<string, (s: string) => { text: string; path: string }>> = {
  'ts string': (s) => ({ text: `export const x = ${JSON.stringify(s)}\n`, path: 'x.ts' }),
  'ts template': (s) => ({ text: `export const x = (n: number): string => \`\${n} ${s.replace(/[`\\$]/g, '\\$&')}\`\n`, path: 'x.ts' }),
  'js string': (s) => ({ text: `export const x = ${JSON.stringify(s)}\n`, path: 'x.js' }),
  'svelte markup': (s) => ({ text: `<script lang="ts">\n  const n = 1\n</script>\n\n<p>{n} ${s}</p>\n`, path: 'x.svelte' }),
  'svelte script': (s) => ({ text: `<script lang="ts">\n  const x = ${JSON.stringify(s)}\n</script>\n\n<p>{x}</p>\n`, path: 'x.svelte' }),
  'svelte attribute': (s) => ({ text: `<button type="button" aria-label="${s.replace(/"/g, '&quot;')}">go</button>\n`, path: 'x.svelte' }),
  json: (s) => ({ text: JSON.stringify({ copy: [s] }, null, 2), path: 'x.json' }),
  markdown: (s) => ({ text: `# Title\n\n${s}\n`, path: 'x.md' }),
  html: (s) => ({ text: `<!doctype html>\n<title>t</title>\n<p>${s}</p>\n`, path: 'x.html' }),
  svg: (s) => ({ text: `<svg xmlns="http://www.w3.org/2000/svg"><text>${s}</text></svg>\n`, path: 'x.svg' }),
}
const KINDS = Object.keys(WRAPPERS)
const lintAs = (kind: string, s: string): Hit[] => {
  const { text, path } = (WRAPPERS[kind] as (s: string) => { text: string; path: string })(s)
  return lintText(text, path)
}

/** Benign filler that no banned pattern touches. */
const BENIGN = ['the', 'blob', 'shows', 'your', 'reasoning', 'speed', 'memory', 'profile', 'with', 'uncertainty', 'rings', 'provisional', 'add', 'screen', 'normal']
const DELIMS = [' ', '\n', ', ', '. ', ' (', ') ', ' "', '" ', ' — ', ' - ', ': ', '\n  ', ' / ']
const benignText = fc.array(fc.constantFrom(...BENIGN), { maxLength: 6 }).map((ws) => ws.join(' '))
const recase = (s: string, flips: readonly boolean[]): string => [...s].map((c, i) => (flips[i % Math.max(1, flips.length)] ? c.toUpperCase() : c.toLowerCase())).join('')

describe('language lint scope (ROADMAP M1.20)', () => {
  it('scans web/src, web/public, web/index.html and the README, but not tests or test data', () => {
    const files = collectFiles()
    for (const f of ['README.md', 'web/index.html', 'web/src/App.svelte', 'web/src/copy.ts', 'web/src/main.ts', 'web/src/app.css', 'web/public/favicon.svg', 'web/src/tasks/reading/passages.render.json', 'web/src/tasks/reading/passages.json']) {
      expect(files).toContain(f)
    }
    expect(files.some((f) => /\.test\.ts$|__fixtures__/.test(f))).toBe(false)
    expect(files.some((f) => f.startsWith('web/scripts/') || f.startsWith('docs/'))).toBe(false)
    expect(files.length).toBeGreaterThan(60)
  })

  it('reads each file type with the right scanner', () => {
    expect(['a.ts', 'a.svelte.ts', 'a.js', 'a.svelte', 'a.html', 'a.md', 'a.svg', 'a.css', 'a.json', 'a.png', 'a.woff2'].map(kindOf)).toEqual([
      'script',
      'script',
      'script',
      'component',
      'component',
      'markup',
      'markup',
      'css',
      'json',
      undefined,
      undefined,
    ])
  })
})

describe('language lint over the repo (A13, R-5.6.1)', () => {
  it('finds no banned words in user-facing text, and the R-5.6.5 sentence only in src/copy.ts', () => {
    expect(lintRepo()).toEqual([])
  })
})

describe('banned terms (A13)', () => {
  it('every term has a unique id, a reason, and examples that it catches as a whole word', () => {
    expect(new Set(BANNED_TERMS.map((t) => t.id)).size).toBe(BANNED_TERMS.length)
    for (const t of BANNED_TERMS) {
      expect(t.why.length, t.id).toBeGreaterThan(20)
      expect(t.examples.length, t.id).toBeGreaterThan(0)
      for (const ex of t.examples) expect(terms(lintText(ex, 'x.md')), `${t.id}: ${ex}`).toContain(t.id)
    }
  })

  it('covers the terms A13 and R-5.6.1 name, and the task list', () => {
    const caught = (w: string): string[] => terms(lintText(w, 'x.md'))
    for (const w of ['autism', 'autistic', 'ADHD', 'alexithymia', 'dyslexia', 'dyscalculia', 'diagnosis', 'diagnose', 'diagnostic', 'disorder', 'deficit', 'impairment', 'IQ', 'pathology', 'symptom', 'syndrome', 'neurodivergent', 'clinical']) {
      expect(caught(w), w).not.toEqual([])
    }
  })

  it('leaves the deliberate near-misses alone', () => {
    for (const [w, why] of Object.entries(NOT_BANNED)) {
      expect(why.length, w).toBeGreaterThan(10)
      for (const kind of KINDS) expect(lintAs(kind, w), `${kind}: ${w}`).toEqual([])
    }
  })
})

describe('allowed texts (A13: the R-5.6.5 constant; "clinical" only in the §13 disclaimer)', () => {
  it('are exactly RESOURCE_LINE and DISCLAIMER from src/copy.ts, and only RESOURCE_LINE is pinned to one file', () => {
    expect(ALLOWED_TEXT.map((a) => [a.name, a.text, a.home])).toEqual([
      ['RESOURCE_LINE', RESOURCE_LINE, 'web/src/copy.ts'],
      ['DISCLAIMER', DISCLAIMER, undefined],
    ])
  })

  it('unlock only their own words: autism and clinician (R-5.6.5), clinical and IQ (§13)', () => {
    // Drop the final period so the text no longer masks, and see what it would otherwise trip.
    expect(summary(lintText(RESOURCE_LINE.slice(0, -1), 'x.md'))).toEqual(['1 autism', '1 clinical'])
    expect(summary(lintText(DISCLAIMER.slice(0, -1), 'x.md'))).toEqual(['1 clinical', '1 iq'])
    expect(lintText(RESOURCE_LINE, 'x.md')).toEqual([])
    expect(lintText(DISCLAIMER, 'x.md')).toEqual([])
  })

  it('mask nothing beyond themselves', () => {
    expect(summary(lintText(`${DISCLAIMER} A clinical view.`, 'x.md'))).toEqual(['1 clinical'])
    expect(summary(lintText(`Autism: ${RESOURCE_LINE}`, 'x.md'))).toEqual(['1 autism'])
    expect(summary(lintText(`${RESOURCE_LINE} IQ. ${DISCLAIMER}`, 'x.md'))).toEqual(['1 iq'])
  })

  it('the repo lint fails when a file other than src/copy.ts spells out the R-5.6.5 sentence', () => {
    const results = { path: 'web/src/results/Footer.svelte', text: `<footer>\n  <p>${RESOURCE_LINE}</p>\n</footer>\n` }
    expect(lintFiles([results])).toEqual(['web/src/results/Footer.svelte: spells out RESOURCE_LINE; import it from web/src/copy.ts instead (A13: one allow-listed constant)'])
    expect(lintFiles([results], { checkHomes: false })).toEqual([])
    expect(lintFiles([{ path: 'web/src/copy.ts', text: `export const RESOURCE_LINE = ${JSON.stringify(RESOURCE_LINE)}` }])).toEqual([])
    expect(lintFiles([{ path: 'web/src/results/Footer.svelte', text: "<script lang=\"ts\">\n  import { RESOURCE_LINE } from '../copy'\n</script>\n<p>{RESOURCE_LINE}</p>\n" }])).toEqual([])
  })

  it('the disclaimer may be quoted anywhere, but only exactly', () => {
    expect(lintFiles([{ path: 'README.md', text: `> ${DISCLAIMER}\n` }])).toEqual([])
    expect(lintFiles([{ path: 'README.md', text: `> ${DISCLAIMER.replace('Not an', 'not an')}\n` }]).length).toBe(2)
  })
})

describe('fixtures (negative tests)', () => {
  it('banned.ts: string and template literals fail; comments and identifiers do not', () => {
    const f = fixture('banned.ts')
    expect(summary(lintText(f.text, f.path))).toEqual(['5 autism', '6 adhd', '6 screening', '7 deficit', '8 diagnosis', '9 diagnosis', '9 iq', '11 neurotype-label'])
  })

  it('banned.svelte: script strings, markup text, attributes and expressions fail; comments do not', () => {
    const f = fixture('banned.svelte')
    expect(summary(lintText(f.text, f.path))).toEqual(['3 symptom', '8 iq', '9 diagnosis', '10 alexithymia'])
  })

  it('banned.json: string values fail, with their path; keys do not', () => {
    const f = fixture('banned.json')
    expect(summary(lintText(f.text, f.path))).toEqual(['3 disorder $.title', '4 clinical $.notes[1]', '5 on-the-spectrum $.nested.deep'])
  })

  it('banned.md and banned.html: text and meta copy fail, and a near-exact disclaimer does not mask', () => {
    const md = fixture('banned.md')
    expect(summary(lintText(md.text, md.path))).toEqual(['3 neurotype-label', '7 clinical'])
    const html = fixture('banned.html')
    expect(summary(lintText(html.text, html.path))).toEqual(['4 iq', '8 clinical', '8 iq', '10 impairment'])
  })

  it('allowed.*: the exact R-5.6.5 sentence and §13 disclaimer pass, wrapped or not', () => {
    for (const name of ['allowed.ts', 'allowed.svelte', 'allowed.md']) {
      const f = fixture(name)
      expect(lintText(f.text, f.path), name).toEqual([])
    }
  })
})

describe('npm run lint:language (CLI)', () => {
  it('is wired as an npm script', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['lint:language']).toBe('tsx scripts/lint-language.ts')
  })

  it('exits 1 on each banned fixture and 0 on the allowed ones and on the repo', () => {
    for (const name of ['banned.ts', 'banned.svelte', 'banned.json', 'banned.md', 'banned.html']) {
      const r = run([`scripts/fixtures/language-lint/${name}`])
      expect(r.code, name).toBe(1)
      expect(r.err, name).toContain(`${FIXTURES}/${name}:`)
    }
    const ok = run(['scripts/fixtures/language-lint/allowed.ts', 'scripts/fixtures/language-lint/allowed.svelte', 'scripts/fixtures/language-lint/allowed.md'])
    expect(ok).toEqual({ code: 0, out: 'language lint: 3 file(s) clean\n', err: '' })
    const repo = run([])
    expect(repo.code).toBe(0)
    expect(repo.out).toMatch(/^language lint: \d+ file\(s\) clean\n$/)
  })

  it('exits 2 on a bad option or path', () => {
    expect(run(['--nope']).code).toBe(2)
    expect(run(['scripts/fixtures/language-lint/missing.ts']).code).toBe(2)
    expect(run(['public/favicon.png']).code).toBe(2)
    expect(run(['--help'])).toMatchObject({ code: 0 })
  })

  it('the tsx entry point exits non-zero on a banned fixture', () => {
    const tsx = join(WEB, 'node_modules', '.bin', 'tsx')
    const bad = spawnSync(tsx, ['scripts/lint-language.ts', 'scripts/fixtures/language-lint/banned.md'], { cwd: WEB, encoding: 'utf8' })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('"neurodivergent"')
    const good = spawnSync(tsx, ['scripts/lint-language.ts', 'scripts/fixtures/language-lint/allowed.md'], { cwd: WEB, encoding: 'utf8' })
    expect(good.status).toBe(0)
  })
})

describe('language lint properties (fast-check)', () => {
  const example = fc.constantFrom(...BANNED_TERMS.flatMap((t) => t.examples.map((ex) => [t.id, ex] as const)))

  it('catches every banned form in any case, in any file type, between any delimiters', () => {
    fc.assert(
      fc.property(
        example,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        benignText,
        benignText,
        fc.constantFrom(...DELIMS),
        fc.constantFrom(...DELIMS),
        fc.constantFrom(...KINDS),
        ([id, ex], flips, left, right, d1, d2, kind) => {
          const text = `${left}${d1}${recase(ex, flips)}${d2}${right}`
          expect(terms(lintAs(kind, text))).toContain(id)
        },
      ),
    )
  })

  it('does not match a banned stem inside a longer word', () => {
    const single = BANNED_TERMS.flatMap((t) => t.examples.filter((ex) => /^[a-z]+$/i.test(ex)))
    fc.assert(
      fc.property(fc.constantFrom(...single), fc.stringMatching(/^[xqz]{1,3}$/), fc.constantFrom(...KINDS), (ex, prefix, kind) => {
        expect(lintAs(kind, `the ${prefix}${ex} rings`)).toEqual([])
      }),
    )
  })

  it('passes the allowed texts in any file type, amid any benign text, however their spaces wrap', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(RESOURCE_LINE, DISCLAIMER),
        fc.array(fc.constantFrom(' ', ' ', '\n', '\n    ', '  '), { minLength: 1, maxLength: 30 }),
        benignText,
        benignText,
        fc.constantFrom(...KINDS),
        (allowed, gaps, left, right, kind) => {
          let i = 0
          const wrapped = allowed.replace(/ /g, () => gaps[i++ % gaps.length] as string)
          expect(lintAs(kind, `${left} ${wrapped} ${right}`)).toEqual([])
        },
      ),
    )
  })

  it('any one-character deletion or case flip un-masks an allowed text', () => {
    fc.assert(
      fc.property(fc.constantFrom(RESOURCE_LINE, DISCLAIMER), fc.nat(), fc.boolean(), fc.constantFrom('markdown', 'ts string', 'svelte markup'), (allowed, n, del, kind) => {
        let mutated: string
        if (del) {
          const i = n % allowed.length
          mutated = allowed.slice(0, i) + allowed.slice(i + 1)
        } else {
          const letters = [...allowed.matchAll(/[a-z]/gi)].map((m) => m.index)
          const i = letters[n % letters.length] as number
          const c = allowed[i] as string
          mutated = allowed.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + allowed.slice(i + 1)
        }
        expect(lintAs(kind, mutated).length).toBeGreaterThan(0)
      }),
    )
  })
})
