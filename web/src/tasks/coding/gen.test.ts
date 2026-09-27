import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import {
  CODING_SEQUENCE_LENGTH,
  CODING_SYMBOLS,
  balancedCounts,
  codingStructure,
  drawSequence,
  drawTable,
  glyphCounts,
  hasImmediateRepeat,
  legendOf,
  sequencePattern,
  type CodingSymbol,
} from '.'

describe('coding generation (M1.11)', () => {
  it('drawTable is a bijection glyph → 1–9 and uniform over glyph/digit pairs', () => {
    const hits = CODING_SYMBOLS.map(() => new Array<number>(9).fill(0))
    const N = 9_000
    for (let i = 0; i < N; i++) {
      const t = drawTable(createRng(`t${i}`))
      expect(Object.keys(t).sort()).toEqual([...CODING_SYMBOLS].sort())
      expect(Object.values(t).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      CODING_SYMBOLS.forEach((s, g) => {
        const row = hits[g] as number[]
        row[t[s] - 1] = (row[t[s] - 1] as number) + 1
      })
    }
    // Chi-square over 81 cells, 64 df: the 0.999 quantile is ≈ 112.3.
    const expected = N / 9
    let chi2 = 0
    for (const row of hits) for (const h of row) chi2 += (h - expected) ** 2 / expected
    expect(chi2).toBeLessThan(112.3)
  })

  it('legendOf lists digits 1–9 in order with the table glyph of each', () => {
    const t = drawTable(createRng('legend'))
    const legend = legendOf(t)
    expect(legend.map((e) => e.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (const e of legend) expect(t[e.symbol]).toBe(e.digit)
    expect(() => legendOf({ ...t, [CODING_SYMBOLS[0]]: t[CODING_SYMBOLS[1]] })).toThrow(RangeError) // digit of glyph 0 shown twice
  })

  it('balancedCounts gives ⌊n/9⌋ or ⌈n/9⌉ of each glyph, summing to n', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000 }), fc.string(), (n, seed) => {
        const c = balancedCounts(createRng(`c${seed}`), n)
        expect(c.reduce((a, x) => a + x, 0)).toBe(n)
        expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1)
      }),
    )
  })

  it('drawSequence: any length, no immediate repeat, balanced counts (fast-check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), fc.string(), (n, seed) => {
        const seq = drawSequence(createRng(`s${seed}`), n)
        expect(seq).toHaveLength(n)
        expect(hasImmediateRepeat(seq)).toBe(false)
        const c = glyphCounts(seq)
        expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1)
      }),
      { numRuns: 300 },
    )
  })

  it('the 200-glyph streams: every glyph 22 or 23 times, glyphs uniform at each position', () => {
    const N = 2_700
    const firstHits = new Map<string, number>()
    const lastHits = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const seq = drawSequence(createRng(`p${i}`))
      expect(seq).toHaveLength(CODING_SEQUENCE_LENGTH)
      expect(hasImmediateRepeat(seq)).toBe(false)
      const c = glyphCounts(seq)
      expect(c.filter((x) => x === 23)).toHaveLength(2)
      expect(c.filter((x) => x === 22)).toHaveLength(7)
      firstHits.set(seq[0] as string, (firstHits.get(seq[0] as string) ?? 0) + 1)
      lastHits.set(seq.at(-1) as string, (lastHits.get(seq.at(-1) as string) ?? 0) + 1)
    }
    // Chi-square over 9 glyphs, 8 df: the 0.999 quantile is ≈ 26.1.
    for (const hits of [firstHits, lastHits]) {
      let chi2 = 0
      for (const s of CODING_SYMBOLS) chi2 += ((hits.get(s) ?? 0) - N / 9) ** 2 / (N / 9)
      expect(chi2).toBeLessThan(26.1)
    }
  })

  it('does not avoid lag-2 repeats (A B A is allowed; only A A is banned)', () => {
    const seq = drawSequence(createRng('lag2'))
    const lag2 = seq.filter((s, i) => i >= 2 && s === seq[i - 2]).length
    expect(lag2).toBeGreaterThan(5) // ≈ 200/8 expected
  })

  it('sequencePattern is canonical under glyph relabelling (A11 isomorphs share it)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (seed, perm) => {
        const seq = drawSequence(createRng(`r${seed}`), 60)
        const shuffled = createRng(`perm${perm}`).shuffle(CODING_SYMBOLS)
        const relabel = new Map<CodingSymbol, CodingSymbol>(CODING_SYMBOLS.map((s, i) => [s, shuffled[i] as CodingSymbol]))
        const renamed = seq.map((s) => relabel.get(s) as CodingSymbol)
        expect(sequencePattern(renamed)).toEqual(sequencePattern(seq))
        expect(codingStructure(renamed)).toEqual(codingStructure(seq))
      }),
      { numRuns: 200 },
    )
    expect(sequencePattern(['star', 'wedge', 'star', 'tridot'])).toEqual([0, 1, 0, 2])
    expect(sequencePattern([])).toEqual([])
  })
})
