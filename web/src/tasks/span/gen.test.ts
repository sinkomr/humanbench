import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import {
  CORSI_BOARD,
  SPAN_BWD,
  SPAN_CORSI,
  SPAN_FWD,
  SPAN_TASKS,
  drawSequence,
  drawTrials,
  hasImmediateRepeat,
  hasRunOfThree,
  isPalindrome,
  runCompletion,
} from '.'

describe('fixed Corsi board (M1.9, §14.6 ex. 11)', () => {
  const { size, blocks } = CORSI_BOARD

  it('has 9 blocks inside the unit square', () => {
    expect(blocks).toHaveLength(9)
    for (const [x, y] of blocks) {
      expect(x - size / 2).toBeGreaterThanOrEqual(0)
      expect(y - size / 2).toBeGreaterThanOrEqual(0)
      expect(x + size / 2).toBeLessThanOrEqual(1)
      expect(y + size / 2).toBeLessThanOrEqual(1)
    }
  })

  it('never lets blocks touch: centres ≥ 0.27 apart (> the block diagonal)', () => {
    let min = Infinity
    for (let i = 0; i < 9; i++) {
      for (let j = i + 1; j < 9; j++) {
        const [a, b] = [blocks[i] as readonly [number, number], blocks[j] as readonly [number, number]]
        min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1]))
      }
    }
    expect(min).toBeGreaterThanOrEqual(0.27)
    expect(min).toBeGreaterThan(size * Math.SQRT2)
  })

  it('is not a grid: no two centres share a row or a column', () => {
    const gaps = (vs: number[]) => {
      const s = [...vs].sort((a, b) => a - b)
      return Math.min(...s.slice(1).map((v, i) => v - (s[i] as number)))
    }
    expect(gaps(blocks.map((b) => b[0]))).toBeGreaterThanOrEqual(0.06 - 1e-12)
    expect(gaps(blocks.map((b) => b[1]))).toBeGreaterThanOrEqual(0.04 - 1e-12)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(CORSI_BOARD)).toBe(true)
    expect(Object.isFrozen(CORSI_BOARD.blocks)).toBe(true)
    expect(Object.isFrozen(CORSI_BOARD.blocks[0])).toBe(true)
  })
})

describe('sequence rules', () => {
  it('runCompletion names the digit that would make a ±1 run of three', () => {
    expect(runCompletion(3, 4)).toBe(5)
    expect(runCompletion(8, 7)).toBe(6)
    expect(runCompletion(1, 2)).toBe(3)
    expect(runCompletion(2, 1)).toBe(0) // not a digit: nothing to forbid
    expect(runCompletion(3, 5)).toBeUndefined()
    expect(runCompletion(undefined, 5)).toBeUndefined()
  })

  it('draws rule-abiding sequences of any length from any seed (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 12 }), fc.constantFrom(...SPAN_TASKS), (seed, len, cfg) => {
        const seq = drawSequence(createRng(seed), cfg, len)
        expect(seq).toHaveLength(len)
        expect(seq.every((x) => cfg.symbols.includes(x))).toBe(true)
        expect(hasImmediateRepeat(seq)).toBe(false)
        if (cfg.forbidRuns) expect(hasRunOfThree(seq)).toBe(false)
      }),
      { numRuns: 3_000 },
    )
  })

  it('draws whole blocks: 2 distinct sequences per length, no backward palindromes (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.constantFrom(SPAN_FWD, SPAN_BWD, SPAN_CORSI), (seed, cfg) => {
        const trials = drawTrials(createRng(seed), cfg)
        expect(trials.map((t) => t.length)).toEqual(Array.from({ length: 2 * (cfg.maxLength - 2) }, (_, i) => 3 + Math.floor(i / 2)))
        expect(new Set(trials.map((t) => t.join(','))).size).toBe(trials.length)
        if (cfg.forbidPalindromes) expect(trials.some(isPalindrome)).toBe(false)
      }),
      { numRuns: 1_000 },
    )
  })

  it('uses each allowed next digit about equally often', () => {
    // After …3, 4 the next digit is uniform over {1,2,6,7,8,9} ∪ {3} minus 4 and 5: 7 options.
    const rng = createRng('uniform')
    const counts = new Map<number, number>()
    const n = 72_000
    for (let i = 0; i < n; i++) {
      const seq = drawSequence(rng, SPAN_FWD, 3)
      if (seq[0] === 3 && seq[1] === 4) counts.set(seq[2] as number, (counts.get(seq[2] as number) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 6, 7, 8, 9])
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    for (const c of counts.values()) expect(Math.abs(c / total - 1 / 7)).toBeLessThan(0.05)
  })
})
