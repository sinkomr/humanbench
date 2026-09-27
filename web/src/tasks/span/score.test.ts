import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { grmCumulative, grmProbs, loglikGrm } from '../../engine'
import { B_PRIOR_LIMIT, stratumOfB } from '../priors'
import {
  SPAN_BWD,
  SPAN_CORSI,
  SPAN_FWD,
  SPAN_GRM_A,
  SPAN_TASKS,
  SPAN_TIME_RANGE_S,
  corsi,
  grmThresholds,
  meanLength,
  runBlock,
  spanB,
  spanBwd,
  spanDifficulty,
  spanExpectedTime,
  spanFwd,
  spanObservation,
  spanStratum,
  type SpanItem,
  type SpanOutcome,
} from '.'

const WRONG: number[] = []

/** Responses of a taker who gets exactly the trials with length ≤ span right, until the block stops. */
function takerResponses(item: SpanItem, span: number): number[][] {
  const out: number[][] = []
  for (;;) {
    const s = runBlock(item, out)
    if (s.finished) return out
    out.push(s.length <= span ? [...(item.key.sequences[s.trial] as number[])] : WRONG)
  }
}

const outcomeOf = (item: SpanItem, responses: readonly unknown[]): SpanOutcome => {
  const s = runBlock(item, responses)
  if (!s.finished) throw new Error('unfinished')
  return s.outcome
}

describe('GRM mapping (A10, provisional)', () => {
  it('uses b_L = (L − 0.5 − μ)/σ for L = 3 … max with the provisional norms', () => {
    const fwd = grmThresholds(SPAN_FWD)
    expect(fwd).toHaveLength(8)
    expect(fwd[0]).toBeCloseTo((3 - 0.5 - 6.5) / 1.2, 12)
    expect(fwd[4]).toBeCloseTo(0, 12) // L = 7: θ = 0 passes 7 half the time (μ + 0.5 = 7)
    expect(fwd[7]).toBeCloseTo((10 - 0.5 - 6.5) / 1.2, 12)
    const bwd = grmThresholds(SPAN_BWD)
    expect(bwd).toHaveLength(7)
    expect(bwd[0]).toBeCloseTo((3 - 0.5 - 4.8) / 1.3, 12)
    expect(bwd[6]).toBeCloseTo((9 - 0.5 - 4.8) / 1.3, 12)
    const cor = grmThresholds(SPAN_CORSI)
    expect(cor).toHaveLength(8)
    expect(cor[0]).toBeCloseTo((3 - 0.5 - 5.5) / 1.1, 12)
    expect(cor[7]).toBeCloseTo((10 - 0.5 - 5.5) / 1.1, 12)
  })

  it.each(SPAN_TASKS)('$name thresholds are strictly increasing and inside the EAP grid', (cfg) => {
    const b = grmThresholds(cfg)
    expect(b.every((x, i) => i === 0 || x > (b[i - 1] as number))).toBe(true)
    expect(b.every((x) => Math.abs(x) <= B_PRIOR_LIMIT)).toBe(true)
    expect(SPAN_GRM_A).toBe(1.7)
  })

  it('reads θ as the z-score of span: P(longest ≥ μ + 0.5 | θ = 0) = ½', () => {
    const cum = grmCumulative(0, SPAN_GRM_A, grmThresholds(SPAN_FWD))
    expect(cum[5]).toBeCloseTo(0.5, 12) // P*(y ≥ 5) = P(longest ≥ 7)
  })
})

describe('difficulty and time priors (M1.P, [SPEC] v0)', () => {
  it.each(SPAN_TASKS)('$name: b_prior is the mean threshold, σ_b = 1, one stratum', (cfg) => {
    const d = spanDifficulty(cfg)
    const b = grmThresholds(cfg)
    expect(d.b_prior).toBeCloseTo(b.reduce((s, x) => s + x, 0) / b.length, 12)
    expect(d.b_prior).toBe(spanB(cfg, meanLength(cfg)))
    expect(d.sd_prior).toBe(1)
    expect(d.provenance).toMatch(/^\[SPEC\] v0, provisional until M4\.8 \(A10\)/)
    expect(d.features).toMatchObject({ task: cfg.task, max_length: cfg.maxLength, norm_mu: cfg.norm.mu, norm_sigma: cfg.norm.sigma })
    expect(spanStratum(cfg)).toBe(stratumOfB(d.b_prior))
  })

  it('expected block times are 102 s, 64.2 s and 81.6 s, all within 60–120 s', () => {
    expect(spanExpectedTime(SPAN_FWD)).toBeCloseTo(102, 9)
    expect(spanExpectedTime(SPAN_BWD)).toBeCloseTo(64.2, 9)
    expect(spanExpectedTime(SPAN_CORSI)).toBeCloseTo(81.6, 9)
    for (const cfg of SPAN_TASKS) {
      expect(spanExpectedTime(cfg)).toBeGreaterThanOrEqual(SPAN_TIME_RANGE_S[0])
      expect(spanExpectedTime(cfg)).toBeLessThanOrEqual(SPAN_TIME_RANGE_S[1])
    }
  })
})

describe('scoring a block (exact match → state machine → GRM category)', () => {
  it('§14.6 ex. 10: backward, passing lengths 3–5 and failing both at 6 gives y = 3', () => {
    const item = spanBwd.generate('ex10')
    const responses = takerResponses(item, 5)
    expect(responses).toHaveLength(8)
    expect(outcomeOf(item, responses)).toEqual({ longest_passed: 5, category: 3, trials_given: 8, trials_correct: 6, stop: 'failed_length' })
    expect(spanBwd.score(item, responses)).toEqual({ correct: null, value: 3 })
    // Typing the digits in presentation order is wrong on every backward trial.
    expect(spanBwd.score(item, item.spec.trials.slice(0, 2))).toEqual({ correct: null, value: 0 })
  })

  it('§14.6 ex. 11: Corsi positions are compared exactly, in order', () => {
    const item = corsi.generate('ex11')
    const first = item.key.sequences[0] as number[]
    const swapped = [first[1], first[0], ...first.slice(2)]
    expect(runBlock(item, [first])).toMatchObject({ finished: false, trial: 1 })
    expect(outcomeOf(item, [swapped, [...first, first[0]]])).toMatchObject({ longest_passed: 0, category: 0 })
    expect(outcomeOf(item, [swapped, item.key.sequences[1], WRONG, WRONG])).toMatchObject({ longest_passed: 3, category: 1 })
  })

  it('a taker with true span S scores y = min(S, max) − 2 (0 below 3), for every task (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(spanFwd, spanBwd, corsi), fc.integer({ min: 0, max: 12 }), fc.string({ minLength: 1 }), (family, span, seed) => {
        const item = family.generate(seed)
        const max = item.spec.max_length
        const responses = takerResponses(item, span)
        const o = outcomeOf(item, responses)
        const longest = span < 3 ? 0 : Math.min(span, max)
        expect(o.longest_passed).toBe(longest)
        expect(o.category).toBe(longest === 0 ? 0 : longest - 2)
        expect(o.trials_given).toBe(2 * (Math.min(Math.max(span, 2), max - 1) - 1))
        expect(family.score(item, responses)).toEqual({ correct: null, value: o.category })
      }),
      { numRuns: 500 },
    )
  })

  it('scores unfinished blocks with no value and refuses responses after the end', () => {
    const item = spanFwd.generate('partial')
    expect(spanFwd.score(item, [item.key.sequences[0]])).toEqual({ correct: null })
    expect(() => spanFwd.score(item, [WRONG, WRONG, WRONG])).toThrow(RangeError)
    expect(() => spanFwd.score(item, [...item.key.sequences, WRONG])).toThrow(RangeError)
  })

  it('treats malformed trial responses as wrong', () => {
    const item = spanFwd.generate('malformed')
    const k = item.key.sequences[0] as number[]
    expect(spanFwd.score(item, [k.join(''), k.map(String)])).toEqual({ correct: null, value: 0 })
    expect(spanFwd.score(item, [null, { digits: k }])).toEqual({ correct: null, value: 0 })
  })
})

describe('engine observation {kind: grm, axis: WM, a, b, y}', () => {
  it.each([spanFwd, spanBwd, corsi])('$name emits a GRM observation the engine accepts for every category', (family) => {
    const item = family.generate('obs')
    const m = item.spec.max_length - 2
    for (let span = 0; span <= item.spec.max_length; span++) {
      const o = outcomeOf(item, takerResponses(item, span))
      const obs = spanObservation(item, o)
      expect(obs).toEqual({ kind: 'grm', axis: 'WM', a: 1.7, b: grmThresholds(cfgOf(family.name)), y: o.category })
      if (obs.kind !== 'grm') throw new Error('unreachable')
      expect(obs.y).toBeGreaterThanOrEqual(0)
      expect(obs.y).toBeLessThanOrEqual(m)
      expect(Number.isFinite(loglikGrm(0.3, obs.a, obs.b, obs.y))).toBe(true)
      expect(grmProbs(0, obs.a, obs.b).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12)
    }
  })

  it('refuses a non-GRM item or an impossible category', () => {
    const item = spanFwd.generate('obs-bad')
    const o: SpanOutcome = { longest_passed: 10, category: 9, trials_given: 16, trials_correct: 16, stop: 'max_length' }
    expect(() => spanObservation(item, o)).toThrow(RangeError)
    const twoPl = { ...item, params: { model: '2pl', a: 1, b: 0 } } as unknown as SpanItem
    expect(() => spanObservation(twoPl, { ...o, category: 1 })).toThrow(RangeError)
  })
})

function cfgOf(name: string) {
  const cfg = SPAN_TASKS.find((c) => c.name === name)
  if (!cfg) throw new Error(`no span task ${name}`)
  return cfg
}
