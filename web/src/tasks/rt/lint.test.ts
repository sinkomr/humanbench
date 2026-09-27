/**
 * Timing lint (CLAUDE.md, DESIGN §11.6): nothing in the rt family reads the wall clock or an
 * unseeded random source. RT comes from performance.now() and rAF timestamps only, and every
 * random draw comes from the seeded engine stream. The banned patterns are assembled at run
 * time so this file does not match itself.
 */

import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob(['./**/*.ts', './**/*.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const BANNED: readonly [string, RegExp][] = [
  ['the wall clock (Date + .now)', new RegExp(['Date', 'now'].join('\\s*\\.\\s*'))],
  ['a Date object (new + Date)', new RegExp(['new', 'Date\\b'].join('\\s+'))],
  ['an unseeded random source (Math + .random)', new RegExp(['Math', 'random'].join('\\s*\\.\\s*'))],
]

describe('rt timing lint', () => {
  it('scans every source and test file of the family (the Vite glob skips only this file)', () => {
    const names = Object.keys(SOURCES).map((p) => p.replace(/^\.\//, ''))
    for (const f of ['index.ts', 'gen.ts', 'score.ts', 'timing.ts', 'verify.ts', 'prior.ts', 'types.ts', 'timing.test.ts']) {
      expect(names).toContain(f)
    }
  })

  it('no file uses the wall clock, Date objects or Math.random', () => {
    const hits: string[] = []
    for (const [path, src] of Object.entries(SOURCES)) {
      for (const [what, re] of BANNED) if (re.test(src)) hits.push(`${path}: ${what}`)
    }
    expect(hits).toEqual([])
  })

  it('the generator uses no engine-approximated math, so items regenerate bit for bit (A11)', () => {
    // ECMA-262 lets Math.exp/log/sin/cos/pow (and so rng.normal) differ by an ULP between engines.
    const approx = new RegExp(['Math\\.(exp|expm1|log|log1p|log2|log10|sin|cos|tan|pow)\\(', '\\.normal\\('].join('|'))
    expect(approx.test(['Math', 'exp(1)'].join('.'))).toBe(true)
    expect(approx.test(['rng', 'normal(0, 1)'].join('.'))).toBe(true)
    const gen = SOURCES['./gen.ts']
    expect(gen).toBeDefined()
    expect(gen?.split('\n').filter((line) => approx.test(line))).toEqual([])
  })

  it('the patterns do match the banned calls', () => {
    const [clock, date, random] = BANNED.map(([, re]) => re)
    expect(clock?.test(['Date', 'now()'].join('.'))).toBe(true)
    expect(clock?.test(['Date ', ' now()'].join('.'))).toBe(true)
    expect(date?.test(['new', 'Date()'].join(' '))).toBe(true)
    expect(random?.test(['Math', 'random()'].join('.'))).toBe(true)
    expect(clock?.test('performance.now()')).toBe(false)
  })
})
