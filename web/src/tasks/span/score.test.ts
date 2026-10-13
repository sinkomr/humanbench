import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { grmCumulative, grmProbs, loglikGrm } from '../../engine'
import { MalformedResponseError } from '../family'
import { B_PRIOR_LIMIT, stratumOfB } from '../priors'
import {
  SPAN_BWD,
  SPAN_CORSI,
  SPAN_FWD,
  SPAN_GRM_A,
  SPAN_LEGACY_FAMILIES,
  SPAN_TASKS,
  SPAN_TIME_RANGE_S,
  SPAN_TIME_V0,
  SPAN_TIME_V1,
  corsi,
  grmThresholds,
  meanLength,
  blockTrials,
  runBlock,
  spanB,
  spanBwd,
  spanDifficulty,
  spanExpectedTime,
  spanFwd,
  spanObservation,
  spanStratum,
  spanTrialP,
  spanTrialTimeS,
  SPAN_UNFINISHED,
  type SpanItem,
  type SpanOutcome,
} from '.'

const WRONG: number[] = []

/** The BlockScore of a finished block with GRM category y (M1.F2). */
const grmScore = (item: SpanItem, y: number) => {
  const p = item.params as unknown as { a: number; b: number[] }
  return { correct: null, observation: { kind: 'grm', axis: 'WM', a: p.a, b: [...p.b], y }, flags: [], reasons: [] }
}
/** The BlockScore of an unfinished block. */
const UNFINISHED = { correct: null, flags: [], reasons: [SPAN_UNFINISHED] }

/** Any seed except one ending in `@s<k>`, which would target a stratum the family may not have. */
const SEEDS = fc.string({ minLength: 1 }).filter((s) => !/@s[1-6]$/.test(s))

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

  it('expected block times are ≈ 113.2 s, 103.0 s and 99.8 s (reactive), all within 60–120 s; the 1.1.0 blocks keep 117.0 s, 87.0 s and 96.2 s', () => {
    expect(spanExpectedTime(SPAN_FWD)).toBeCloseTo(113.20632865597, 9)
    expect(spanExpectedTime(SPAN_BWD)).toBeCloseTo(103.03371401071, 9)
    expect(spanExpectedTime(SPAN_CORSI)).toBeCloseTo(99.81825987997, 9)
    expect(spanExpectedTime(SPAN_FWD, 'fixed')).toBeCloseTo(117.03284212767, 9)
    expect(spanExpectedTime(SPAN_BWD, 'fixed')).toBeCloseTo(86.99549880062, 9)
    expect(spanExpectedTime(SPAN_CORSI, 'fixed')).toBeCloseTo(96.16566943478, 9)
    for (const cfg of SPAN_TASKS) {
      for (const procedure of ['reactive', 'fixed'] as const) {
        expect(spanExpectedTime(cfg, procedure)).toBeGreaterThanOrEqual(SPAN_TIME_RANGE_S[0])
        expect(spanExpectedTime(cfg, procedure)).toBeLessThanOrEqual(SPAN_TIME_RANGE_S[1])
      }
      // On one clock the reactive block is the shorter one, by about a quarter at θ = 0.
      const fixedSameClock = spanExpectedTime(cfg, 'fixed', SPAN_TIME_V1)
      expect(spanExpectedTime(cfg) / fixedSameClock).toBeGreaterThan(0.7)
      expect(spanExpectedTime(cfg) / fixedSameClock).toBeLessThan(0.8)
    }
  })

  it('the time model reproduces the one session on record within 15% (fixed procedure, the trials it gave)', () => {
    // Owner's session of 2026-10-12: forward 12 trials to length 8 in 173 s, backward 14 to 9 in 319 s, Corsi 14 to 9 in 233 s.
    const block = (cfg: (typeof SPAN_TASKS)[number], top: number): number => {
      let t = SPAN_TIME_V1.instructions_s
      for (let length = 3; length <= top; length++) t += 2 * spanTrialTimeS(cfg, length)
      return t
    }
    expect(block(SPAN_FWD, 8)).toBeCloseTo(171.6, 1)
    expect(Math.abs(block(SPAN_FWD, 8) - 173) / 173).toBeLessThan(0.15)
    expect(Math.abs(block(SPAN_BWD, 9) - 319) / 319).toBeLessThan(0.15)
    expect(Math.abs(block(SPAN_CORSI, 9) - 233) / 233).toBeLessThan(0.15)
  })

  it.each([spanFwd, spanBwd, corsi, ...Object.values(SPAN_LEGACY_FAMILIES)])('$name $generatorVersion: E[T] is the expected time of the trials the state machine gives at θ = 0', (family) => {
    // Independent of spanExpectedTime: walk every path of the block's own state machine with the trial-level
    // chances the GRM implies, and add up each trial's time weighted by the chance of reaching it.
    const cfg = cfgOf(family.name)
    const item = family.generate('time')
    const fixed = item.spec.procedure === undefined
    const model = fixed ? SPAN_TIME_V0 : SPAN_TIME_V1
    const p = spanTrialP(0, SPAN_GRM_A, grmThresholds(cfg))
    let expected = model.instructions_s
    let total = 0
    const visit = (responses: number[][], prob: number): void => {
      const s = runBlock(item, responses)
      if (s.finished) {
        total += prob
        return
      }
      expected += prob * spanTrialTimeS(cfg, s.length, model)
      const right = p[s.length - 3] as number
      visit([...responses, [...(item.key.sequences[s.trial] as number[])]], prob * right)
      visit([...responses, WRONG], prob * (1 - right))
    }
    visit([], 1)
    expect(total).toBeCloseTo(1, 9)
    expect(item.expected_time_s).toBeCloseTo(expected, 7)
    expect(spanExpectedTime(cfg, fixed ? 'fixed' : 'reactive')).toBeCloseTo(expected, 7)
  })
})

describe('scoring a block (exact match → state machine → GRM category)', () => {
  it('§14.6 ex. 10: backward, passing lengths 3–5 at the first trial and missing 6 twice gives y = 3 in five trials', () => {
    const item = spanBwd.generate('ex10')
    const responses = takerResponses(item, 5)
    expect(responses).toHaveLength(5)
    expect(outcomeOf(item, responses)).toEqual({ longest_passed: 5, category: 3, trials_given: 5, trials_correct: 3, stop: 'failed_length' })
    expect(blockTrials(item, responses)).toEqual([0, 2, 4, 6, 7])
    expect(spanBwd.score(item, responses)).toEqual(grmScore(item, 3))
    // Typing the digits in presentation order is wrong on every backward trial.
    expect(spanBwd.score(item, item.spec.trials.slice(0, 2))).toEqual(grmScore(item, 0))
  })

  it('a miss gets one second attempt at the same length, with the length\'s second sequence; a correct one moves up', () => {
    const item = spanFwd.generate('second-attempt')
    const k = item.key.sequences as number[][]
    // Length 3 right at once: on to length 4 (sequence 2), never the second sequence of length 3 (sequence 1).
    expect(runBlock(item, [k[0]])).toEqual({ finished: false, trial: 2, length: 4, longest_passed: 3 })
    // Length 4 missed: its second sequence (3) comes next, at the same length.
    expect(runBlock(item, [k[0], WRONG])).toEqual({ finished: false, trial: 3, length: 4, longest_passed: 3 })
    // The second attempt right: length 4 is passed, on to 5.
    expect(runBlock(item, [k[0], WRONG, k[3]])).toEqual({ finished: false, trial: 4, length: 5, longest_passed: 4 })
    // The first sequence's answer does not pass the second attempt: the entry is compared with the sequence shown.
    expect(outcomeOf(item, [k[0], WRONG, k[2]])).toEqual({ longest_passed: 3, category: 1, trials_given: 3, trials_correct: 1, stop: 'failed_length' })
    expect(blockTrials(item, [k[0], WRONG, k[3], k[4]])).toEqual([0, 2, 3, 4])
  })

  it('§14.6 ex. 11: Corsi positions are compared exactly, in order', () => {
    const item = corsi.generate('ex11')
    const first = item.key.sequences[0] as number[]
    const swapped = [first[1], first[0], ...first.slice(2)]
    expect(runBlock(item, [first])).toMatchObject({ finished: false, trial: 2, length: 4 })
    expect(runBlock(item, [swapped])).toMatchObject({ finished: false, trial: 1, length: 3 })
    expect(outcomeOf(item, [swapped, [...first, first[0]]])).toMatchObject({ longest_passed: 0, category: 0 })
    expect(outcomeOf(item, [swapped, item.key.sequences[1], WRONG, WRONG])).toMatchObject({ longest_passed: 3, category: 1 })
  })

  it('a taker with true span S scores y = min(S, max) − 2 (0 below 3) in one trial per length passed and two at the first failed, for every task (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(spanFwd, spanBwd, corsi), fc.integer({ min: 0, max: 12 }), SEEDS, (family, span, seed) => {
        const item = family.generate(seed)
        const max = item.spec.max_length
        const responses = takerResponses(item, span)
        const o = outcomeOf(item, responses)
        const longest = span < 3 ? 0 : Math.min(span, max)
        expect(o.longest_passed).toBe(longest)
        expect(o.category).toBe(longest === 0 ? 0 : longest - 2)
        const passed = longest === 0 ? 0 : longest - 2
        expect(o.trials_given).toBe(passed + (longest === max ? 0 : 2))
        expect(o.trials_correct).toBe(passed)
        expect(family.score(item, responses)).toEqual(grmScore(item, o.category))
      }),
      { numRuns: 500 },
    )
  })

  it('a 1.1.0 block (fixed procedure) is still scored as it was given: both trials of every length (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(SPAN_LEGACY_FAMILIES)), fc.integer({ min: 0, max: 12 }), SEEDS, (family, span, seed) => {
        const item = family.generate(seed)
        expect(item.generator_version).toBe('1.1.0')
        expect('procedure' in item.spec).toBe(false)
        const max = item.spec.max_length
        const responses = takerResponses(item, span)
        const o = outcomeOf(item, responses)
        const longest = span < 3 ? 0 : Math.min(span, max)
        expect(o.longest_passed).toBe(longest)
        expect(o.trials_given).toBe(2 * (Math.min(Math.max(span, 2), max - 1) - 1))
        expect(blockTrials(item, responses)).toEqual(responses.map((_, i) => i))
        expect(family.score(item, responses)).toEqual(grmScore(item, o.category))
        // The reactive family draws the same sequences from the seed, and has the same parameters.
        const now = SPAN_NOW[family.name]!.generate(seed)
        expect(now.spec.trials).toEqual(item.spec.trials)
        expect(now.params).toEqual(item.params)
        expect(now.family_id).toBe(item.family_id)
        expect(now.difficulty).toEqual(item.difficulty)
      }),
      { numRuns: 200 },
    )
  })

  it('scores unfinished blocks with no value and refuses responses after the end', () => {
    const item = spanFwd.generate('partial')
    expect(spanFwd.score(item, [item.key.sequences[0]])).toEqual(UNFINISHED)
    expect(() => spanFwd.score(item, [WRONG, WRONG, WRONG])).toThrow(MalformedResponseError)
    expect(() => spanFwd.score(item, [...item.key.sequences, WRONG])).toThrow(MalformedResponseError)
    // The stream of the fixed procedure (both sequences of length 3, right) is not one this block could give:
    // after the first, the block showed a sequence of length 4.
    expect(spanFwd.score(item, [item.key.sequences[0], item.key.sequences[1]])).toEqual(UNFINISHED)
    expect(runBlock(item, [item.key.sequences[0], item.key.sequences[1]])).toMatchObject({ finished: false, trial: 3, length: 4 })
  })

  it('treats missing trials, blank slots and wrong symbols as wrong; non-array entries and non-symbol elements as malformed (M1.F2)', () => {
    const item = spanFwd.generate('malformed')
    const k = item.key.sequences[0] as number[]
    expect(spanFwd.score(item, [null, undefined])).toEqual(grmScore(item, 0))
    // Well-formed but wrong: other digits, the wrong length, blank (null) slots as JSON writes holes.
    expect(spanFwd.score(item, [[...k].reverse(), k.slice(1)])).toEqual(grmScore(item, 0))
    expect(spanFwd.score(item, [k.map(() => null), [null, ...k.slice(1)]])).toEqual(grmScore(item, 0))
    for (const bad of [k.join(''), { digits: k }, 123, true]) {
      expect(() => spanFwd.score(item, [bad, k]), JSON.stringify(bad)).toThrow(MalformedResponseError)
    }
    for (const bad of ['123', null, undefined, { 0: k }]) expect(() => spanFwd.score(item, bad as never)).toThrow(MalformedResponseError)
    // An element that is not a symbol of the task is a renderer bug, not a wrong answer.
    for (const el of [10, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', {}, [], true]) {
      expect(() => spanFwd.score(item, [[el, ...k.slice(1)], k]), String(el)).toThrow(MalformedResponseError)
      expect(() => spanFwd.score(item, [k, [...k.slice(1), el]]), String(el)).toThrow(MalformedResponseError)
    }
    expect(() => spanFwd.score(item, [k.map(String), null])).toThrow(MalformedResponseError)
  })

  it('checks elements against each task\'s alphabet: digits 1–9, Corsi blocks 0–8 (M1.F2)', () => {
    const c = corsi.generate('alphabet')
    const k = c.key.sequences[0] as number[]
    // Corsi block 0 is a symbol (a well-formed, here wrong, answer); block 9 or 99 is not.
    expect(corsi.score(c, [[0, 0, 0], [0, 0, 0]])).toEqual(grmScore(c, 0))
    for (const el of [9, 99, -5, 1.5]) expect(() => corsi.score(c, [[el, ...k.slice(1)], k]), String(el)).toThrow(MalformedResponseError)
    const b = spanBwd.generate('alphabet')
    expect(spanBwd.score(b, [[9, 9, 9], [1, 1, 1]])).toEqual(grmScore(b, 0))
    for (const el of [0, 10]) expect(() => spanBwd.score(b, [[el, 1, 2], null]), String(el)).toThrow(MalformedResponseError)
  })

  it('property: a stream of well-formed entries never throws; one non-symbol element always does (M1.F2)', () => {
    const entry = (symbols: readonly number[]) =>
      fc.oneof(fc.constant(null), fc.array(fc.oneof(fc.constantFrom(...symbols), fc.constant(null)), { maxLength: 12 }))
    fc.assert(
      fc.property(
        fc.constantFrom(spanFwd, spanBwd, corsi),
        fc.string(),
        fc.integer({ min: 0, max: 1 }),
        fc.oneof(fc.integer({ min: -100, max: 100 }), fc.double(), fc.string(), fc.boolean()),
        (family, seed, pos, el) => {
          const item = family.generate(`p-${seed}`)
          const symbols = SPAN_TASKS.find((c) => c.task === item.spec.task)?.symbols as readonly number[]
          const stream = fc.sample(fc.array(entry(symbols), { minLength: 2, maxLength: 2 }), { numRuns: 1, seed: seed.length })[0] as unknown[][]
          const s = family.score(item, stream)
          expect(s.reasons.length > 0 || s.observation !== undefined).toBe(true)
          if (typeof el === 'number' && symbols.includes(el)) return
          const bad = stream.map((t) => (t === null ? [] : [...t]))
          ;(bad[pos] as unknown[]).push(el)
          expect(() => family.score(item, bad)).toThrow(MalformedResponseError)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('gives no credit for blank or partly filled entry slots (sparse arrays)', () => {
    // A UI that fills slots by index (resp[pos] = digit) leaves holes where nothing was entered.
    for (const family of [spanFwd, spanBwd, corsi]) {
      const item = family.generate('holes')
      const blank = item.key.sequences.map((s) => new Array<number>(s.length))
      expect(family.score(item, blank.slice(0, 2))).toEqual(grmScore(item, 0))
      const lastOnly = item.key.sequences.slice(0, 2).map((s) => {
        const r = new Array<number>(s.length)
        r[s.length - 1] = s[s.length - 1] as number
        return r
      })
      expect(family.score(item, lastOnly)).toEqual(grmScore(item, 0))
      // A hole in the response stream itself is a missing, hence wrong, trial: the second sequence of the length follows.
      expect(runBlock(item, [, item.key.sequences[1]])).toMatchObject({ finished: false, trial: 2, longest_passed: 3 })
      expect(outcomeOf(item, new Array(2))).toMatchObject({ longest_passed: 0, category: 0, trials_given: 2 })
    }
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

const SPAN_NOW: Readonly<Record<string, typeof spanFwd>> = { span_fwd: spanFwd, span_bwd: spanBwd, corsi }

function cfgOf(name: string) {
  const cfg = SPAN_TASKS.find((c) => c.name === name)
  if (!cfg) throw new Error(`no span task ${name}`)
  return cfg
}
