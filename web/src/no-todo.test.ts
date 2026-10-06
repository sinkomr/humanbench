/**
 * No placeholder reaches a person (UX-REVIEW D1, UX-061): the privacy notice once showed "TODO(user)".
 * Every string the copy modules export (a constant, a list or a record of them, and what a function
 * returns for a few plain arguments) is scanned for "TODO". The DOM tests (App*.dom.test.ts,
 * session/components.dom.test.ts) and e2e/session.spec.ts check the rendered pages as well.
 */

import { describe, expect, it } from 'vitest'

/** The copy modules: every copy.ts and *-copy.ts under src, and the other modules that hold words shown to the person. */
const MODULES: Record<string, Record<string, unknown>> = {
  ...import.meta.glob<Record<string, unknown>>(['./**/copy.ts', './**/*-copy.ts'], { eager: true }),
  ...import.meta.glob<Record<string, unknown>>(['./session/segments.ts', './brief/results-talk.ts', './engine/axes.ts', './session/title.ts'], { eager: true }),
}

/** Arguments a copy function is tried with; one that wants others throws or returns a non-string, and is left out. */
const ARGS: readonly (readonly unknown[])[] = [[], ['Spatial'], [3], [1], [25, 4], [0, null], [1, 1, 1], ['a', 1], [2, true], [['Spatial', 'Reaction Time']]]

function strings(module: string, exports: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = []
  const seen = new Set<unknown>()
  const add = (name: string, v: unknown, depth: number): void => {
    if (typeof v === 'string') {
      out.push([name, v])
      return
    }
    if (depth > 6 || v === null || seen.has(v)) return
    if (typeof v === 'function') {
      for (const args of ARGS) {
        try {
          const r: unknown = (v as (...a: readonly unknown[]) => unknown)(...args)
          if (typeof r === 'string') out.push([`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`, r])
        } catch {
          // a function that takes other arguments
        }
      }
      return
    }
    if (typeof v !== 'object') return
    seen.add(v)
    if (Array.isArray(v)) v.forEach((x, i) => add(`${name}[${i}]`, x, depth + 1))
    else for (const [k, x] of Object.entries(v)) add(`${name}.${k}`, x, depth + 1)
  }
  for (const [k, v] of Object.entries(exports)) add(`${module} ${k}`, v, 0)
  return out
}

describe('no placeholder in the copy (UX-REVIEW D1)', () => {
  it('finds the copy modules', () => {
    const names = Object.keys(MODULES)
    // ... and the M6 entries' copy (dev routes: situational judgment, word links, unusual uses).
    for (const m of ['./copy.ts', './session/copy.ts', './backend/copy.ts', './viz/card-copy.ts', './render/common/entry-copy.ts', './session/segments.ts', './brief/results-talk.ts', './tasks/sjt/copy.ts', './tasks/rat/copy.ts', './tasks/aut/copy.ts']) {
      expect(names).toContain(m)
    }
    expect(names.some((n) => n.endsWith('.test.ts'))).toBe(false)
  })

  it('no exported string of any copy module says "TODO"', () => {
    const all = Object.entries(MODULES).flatMap(([m, exports]) => strings(m, exports))
    expect(all.length).toBeGreaterThan(500)
    const hits = all.filter(([, text]) => /TODO/.test(text)).map(([name, text]) => `${name}: ${text.slice(0, 120)}`)
    expect(hits).toEqual([])
  })

  it('both privacy notices are among the strings scanned', () => {
    const all = Object.entries(MODULES).flatMap(([m, exports]) => strings(m, exports))
    const names = all.map(([n]) => n)
    expect(names.some((n) => n.startsWith('./session/copy.ts PRIVACY_SECTIONS[0].paragraphs['))).toBe(true)
    expect(names.some((n) => n.startsWith('./backend/copy.ts SERVER_PRIVACY_SECTIONS[0].paragraphs['))).toBe(true)
  })
})
