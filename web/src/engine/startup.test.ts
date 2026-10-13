import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { getFamily } from '../tasks/registry'
import { createRng } from './prng'
import { answeredItems, candidatePool, selectionAim, sessionPosterior, type AnsweredItem } from './selector'
import { SELECTION_PRIOR_SD_FACTOR, STARTUP_MAX, STARTUP_MIN, STARTUP_STEP, STARTUP_WINDOW, startupCompetes, startupTarget, type StartupUnit } from './startup'
import type { Observation } from './types'

const u = (b: number, correct: number, scored = 1): StartupUnit => ({ b, correct, scored })

describe('startupTarget: one stratum beyond the last question until the first reversal (owner feedback 2026-10-13, DESIGN §7.4)', () => {
  it('does not apply before the first scored answer', () => {
    expect(startupTarget([])).toBeNull()
    expect(startupTarget([u(0.3, 0, 0)])).toBeNull() // a question that was not scored (ran out of time on the server)
  })

  it('steps up one stratum after each correct answer, from the difficulty of the last question', () => {
    expect(STARTUP_STEP).toBe(1)
    expect(startupTarget([u(-0.5, 1)])).toBeCloseTo(0.5, 12)
    expect(startupTarget([u(-0.5, 1), u(0.4, 1)])).toBeCloseTo(1.4, 12)
    expect(startupTarget([u(-0.5, 1), u(0.4, 1), u(1.6, 1), u(2.4, 1)])).toBeCloseTo(3.4, 12)
  })

  it('steps down after each miss', () => {
    expect(startupTarget([u(0, 0)])).toBeCloseTo(-1, 12)
    expect(startupTarget([u(0, 0), u(-1.2, 0)])).toBeCloseTo(-2.2, 12)
  })

  it('is over at the first reversal, for good', () => {
    expect(startupTarget([u(0, 1), u(1, 0)])).toBeNull()
    expect(startupTarget([u(0, 0), u(-1, 1)])).toBeNull()
    expect(startupTarget([u(0, 1), u(1, 0), u(0.5, 0), u(0, 0)])).toBeNull()
    expect(startupTarget([u(0, 1), u(1, 0), u(0.5, 1), u(1, 1), u(1.5, 1)])).toBeNull()
  })

  it('stays inside the range of difficulties', () => {
    expect(startupTarget([u(3.2, 1)])).toBe(STARTUP_MAX)
    expect(startupTarget([u(-3.1, 0)])).toBe(STARTUP_MIN)
  })

  it('a passage is one unit: up when all its questions were right, down when none was, a reversal in between', () => {
    expect(startupTarget([u(0.2, 3, 3)])).toBeCloseTo(1.2, 12)
    expect(startupTarget([u(0.2, 0, 4)])).toBeCloseTo(-0.8, 12)
    expect(startupTarget([u(0.2, 2, 3)])).toBeNull()
    expect(startupTarget([u(0.2, 3, 3), u(1.1, 3, 4)])).toBeNull()
    // an unscored question inside a passage is left out of the count; a unit with none scored says nothing
    expect(startupTarget([u(0.2, 2, 2), u(9, 0, 0)])).toBeCloseTo(1.2, 12)
  })

  it('property: a target exists exactly while the scored units agree, and is the last scored unit ± one step, clamped', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ b: fc.double({ min: -4, max: 4, noNaN: true }), y: fc.constantFrom(0, 1), scored: fc.boolean() }), { maxLength: 12 }), (xs) => {
        const units = xs.map((x) => u(x.b, x.scored ? x.y : 0, x.scored ? 1 : 0))
        const scored = xs.filter((x) => x.scored)
        const t = startupTarget(units)
        if (scored.length === 0 || new Set(scored.map((x) => x.y)).size > 1) {
          expect(t).toBeNull()
          return
        }
        const last = scored[scored.length - 1]!
        expect(t).toBeCloseTo(Math.min(STARTUP_MAX, Math.max(STARTUP_MIN, last.b + (last.y === 1 ? 1 : -1))), 12)
        // one more answer of the same kind keeps it going; one of the other kind ends it
        expect(startupTarget([...units, u(0, last.y)])).not.toBeNull()
        expect(startupTarget([...units, u(0, 1 - last.y)])).toBeNull()
      }),
      { numRuns: 500 },
    )
  })

  it('refuses a difficulty that is not a number', () => {
    expect(() => startupTarget([u(Number.NaN, 1)])).toThrow(RangeError)
  })
})

describe('startupCompetes: the candidates within half a stratum of the target, or the nearest', () => {
  it('keeps the candidates inside the window', () => {
    expect(STARTUP_WINDOW).toBe(0.5)
    expect(startupCompetes([0, 0.6, 1.0, 1.5, 1.6, 3], 1)).toEqual([false, true, true, true, false, false])
  })

  it('with none inside it, keeps the nearest (all of them on a tie)', () => {
    expect(startupCompetes([-1, 0, 1.3, 1.3], 3)).toEqual([false, false, true, true])
    expect(startupCompetes([0, 2], 1)).toEqual([true, true])
    expect(startupCompetes([], 1)).toEqual([])
  })

  it('property: something always competes, and nothing nearer than a competitor is left out', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -4, max: 4, noNaN: true }), { minLength: 1, maxLength: 30 }), fc.double({ min: -3.5, max: 3.5, noNaN: true }), (bs, target) => {
        const keep = startupCompetes(bs, target)
        expect(keep.some(Boolean)).toBe(true)
        const worstKept = Math.max(...bs.filter((_, i) => keep[i]).map((b) => Math.abs(b - target)))
        bs.forEach((b, i) => {
          if (!keep[i]) expect(Math.abs(b - target)).toBeGreaterThan(worstKept)
        })
      }),
      { numRuns: 300 },
    )
  })
})

describe('the device selector with the start-up rule', () => {
  const rotation = getFamily('rotation')!
  const obsOf = (h: readonly AnsweredItem[]): Observation[] => h.map((x) => ({ kind: '2pl', axis: x.axis, a: 1, b: x.b, y: x.y }))
  const poolOf = (history: readonly AnsweredItem[], startup = true) => {
    const obs = obsOf(history)
    return candidatePool({ sessionSeed: 'startup-selector', posterior: sessionPosterior(obs), administered: [], history, aim: selectionAim(obs) }, { axes: ['SPA'], families: [rotation], startup })
  }
  const bs = (p: ReturnType<typeof poolOf>): number[] => p.ranked.map((c) => (c.item.params as { b: number }).b)

  it('answeredItems reads the scored dichotomous answers of a session, in order, and nothing else', () => {
    const obs: Observation[] = [
      { kind: '2pl', axis: 'MAT', a: 1, b: 0.1, y: 1 },
      { kind: 'grm', axis: 'WM', a: 1.7, b: [-1, 0, 1], y: 2 },
      { kind: '3pl', axis: 'SPA', a: 1, b: -0.4, c: 0.25, y: 0 },
      { kind: 'gaussian', axis: 'RT', lam: 1, d: 0, sigma: 0.5, x: 0.1 },
    ]
    expect(answeredItems(obs)).toEqual([
      { axis: 'MAT', b: 0.1, y: 1 },
      { axis: 'SPA', b: -0.4, y: 0 },
    ])
  })

  it('after three correct answers in a row the candidates are a stratum above the last one, not at the estimate', () => {
    const history: AnsweredItem[] = [-0.5, 0.4, 1.5].map((b) => ({ axis: 'SPA', b, y: 1 }))
    const with_ = bs(poolOf(history))
    const without = bs(poolOf(history, false))
    expect(with_.length).toBeGreaterThan(0)
    for (const b of with_) expect(Math.abs(b - 2.5)).toBeLessThanOrEqual(STARTUP_WINDOW + 1e-9)
    // without the rule the five that compete sit near the estimate, more than half a stratum lower on average
    const top = (xs: number[]): number => xs.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, xs.length)
    expect(top(without)).toBeLessThan(top(with_) - 0.5)
  })

  it('answers on another skill do not start or end a skill’s start-up', () => {
    const own: AnsweredItem[] = [{ axis: 'SPA', b: 0, y: 1 }]
    const other: AnsweredItem[] = [{ axis: 'MAT', b: 0, y: 0 }, { axis: 'QR', b: 1, y: 0 }]
    for (const b of bs(poolOf([...other, ...own, ...other]))) expect(Math.abs(b - 1)).toBeLessThanOrEqual(STARTUP_WINDOW + 1e-9)
  })

  it('after the reversal the items are aimed at the estimate under the wider selection prior: above the posterior mean for a strong record', () => {
    expect(SELECTION_PRIOR_SD_FACTOR).toBe(2)
    const history: AnsweredItem[] = [0, 1, 2, 3, 2.2, 2.4].map((b, i) => ({ axis: 'SPA', b, y: i === 3 ? 0 : 1 }))
    const obs = obsOf(history)
    const mean = sessionPosterior(obs).SPA.mean
    const aim = selectionAim(obs).SPA!
    expect(aim).toBeGreaterThan(mean + 0.4)
    expect(aim).toBeLessThan(3.5)
    // an axis without answers is aimed at the prior mean, like its posterior
    expect(selectionAim(obs).MAT).toBe(0)
    expect(selectionAim([]).SPA).toBe(0)
    const mb = (p: ReturnType<typeof poolOf>): number => bs(p).slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, bs(p).length)
    expect(mb(poolOf(history))).toBeGreaterThan(mb(poolOf(history, false)) + 0.2)
  })

  it('without a history the selection is the one of before, item for item', () => {
    const state = { sessionSeed: 'startup-selector', posterior: sessionPosterior([]), administered: [] }
    const a = candidatePool(state, { axes: ['SPA'], families: [rotation] })
    const b = candidatePool(state, { axes: ['SPA'], families: [rotation], startup: false })
    expect(a.ranked.map((c) => [c.item.item_id, c.score])).toEqual(b.ranked.map((c) => [c.item.item_id, c.score]))
  })

  it('property: whatever the record, the pool is never empty because of the rule, and the exclusions still hold', () => {
    const rng = createRng('startup-pool-prop')
    fc.assert(
      fc.property(fc.array(fc.record({ b: fc.double({ min: -3, max: 3.4, noNaN: true }), y: fc.constantFrom<0 | 1>(0, 1) }), { maxLength: 10 }), (xs) => {
        const history: AnsweredItem[] = xs.map((x) => ({ axis: 'SPA', ...x }))
        const seen = rotation.generate(`seen-${rng.int(0, 5)}`)
        const obs = obsOf(history)
        const p = candidatePool({ sessionSeed: 'startup-selector', posterior: sessionPosterior(obs), administered: [seen], history, aim: selectionAim(obs) }, { axes: ['SPA'], families: [rotation] })
        expect(p.ranked.length).toBeGreaterThan(0)
        for (const c of p.ranked) {
          expect(c.item.family_id).not.toBe(seen.family_id)
          expect(c.item.sibling_group).not.toBe(seen.sibling_group)
        }
        expect(new Set(p.ranked.map((c) => c.item.family_id)).size).toBe(p.ranked.length)
      }),
      { numRuns: 60 },
    )
  })
})
