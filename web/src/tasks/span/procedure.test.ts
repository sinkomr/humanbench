/**
 * The reactive span procedure against the fixed one it replaces (owner decision 2026-10-13;
 * DESIGN §3 row 8, §7.1; ROADMAP A10, M1.P; `prior.ts`, "Why the scoring model stands").
 *
 * The claim under test: the graded outcome of a block (the longest passed length, the thing that is
 * scored) has the same distribution under both procedures, so the GRM, its thresholds, the block's
 * information and SE and the provisional parameters carry over unchanged. Shown three ways: exactly,
 * by walking every response path of both state machines for arbitrary trial-level chances; by
 * simulation with the families' own GRM; and by θ recovery through the engine's scorer.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng, eapByAxis, grmProbs, infoGrm, initialSigma, N_AXES, type Observation } from '../../engine'
import {
  SPAN_GRM_A,
  SPAN_LEGACY_FAMILIES,
  SPAN_TASKS,
  SPAN_TIME_V1,
  corsi,
  grmThresholds,
  runBlock,
  spanBwd,
  spanFwd,
  spanStatus,
  spanTrialP,
  spanTrialTimeS,
  type SpanItem,
  type SpanOutcome,
  type SpanProtocol,
} from '.'

/** P(outcome) of a protocol when a trial at length L is right with `p[L − start]`: every path of the state machine. */
function outcomeDistribution(proto: SpanProtocol, p: readonly number[]): { category: number[]; trials: number; correct: number } {
  const m = proto.max_length - proto.start_length + 1
  const category = new Array<number>(m + 1).fill(0)
  let trials = 0
  let correct = 0
  const visit = (results: boolean[], prob: number): void => {
    if (prob === 0) return
    const s = spanStatus(proto, results)
    if (s.finished) {
      category[s.outcome.category]! += prob
      trials += prob * s.outcome.trials_given
      correct += prob * s.outcome.trials_correct
      return
    }
    const right = p[s.length - proto.start_length]!
    visit([...results, true], prob * right)
    visit([...results, false], prob * (1 - right))
  }
  visit([], 1)
  return { category, trials, correct }
}

describe('the reactive procedure keeps the distribution of the graded outcome (exact)', () => {
  it('for arbitrary trial-level chances, P(category) is the same under the fixed and the reactive machine (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 6 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 6, maxLength: 6 }), (start, nLengths, p) => {
        const base = { start_length: start, trials_per_length: 2, max_length: start + nLengths - 1 }
        const fixed = outcomeDistribution({ ...base, procedure: 'fixed' }, p)
        const reactive = outcomeDistribution({ ...base, procedure: 'reactive' }, p)
        fixed.category.forEach((x, k) => expect(reactive.category[k]).toBeCloseTo(x, 12))
        expect(reactive.category.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
        // The closed form: P(longest ≥ L) = Π (1 − (1 − p_l)²) over the lengths up to L.
        let reach = 1
        for (let k = 0; k < nLengths; k++) {
          reach *= 1 - (1 - p[k]!) ** 2
          expect(reactive.category.slice(k + 1).reduce((a, b) => a + b, 0)).toBeCloseTo(reach, 12)
        }
        // The reactive block never gives more trials than the fixed one, on average.
        expect(reactive.trials).toBeLessThanOrEqual(fixed.trials + 1e-12)
      }),
      { numRuns: 300 },
    )
  })

  it.each(SPAN_TASKS)('$name: with the trial-level chances its GRM implies, both machines give exactly the GRM category probabilities at any θ', (cfg) => {
    const b = grmThresholds(cfg)
    for (const theta of [-3, -1.5, -0.4, 0, 0.7, 1.9, 3]) {
      const p = spanTrialP(theta, SPAN_GRM_A, b)
      const want = grmProbs(theta, SPAN_GRM_A, b)
      for (const procedure of ['fixed', 'reactive'] as const) {
        const got = outcomeDistribution({ start_length: 3, trials_per_length: 2, max_length: cfg.maxLength, procedure }, p)
        want.forEach((x, k) => expect(got.category[k], `${cfg.name} ${procedure} θ = ${theta} category ${k}`).toBeCloseTo(x, 10))
      }
    }
  })

  it('the information of the block observation, so its SE, is a function of the GRM alone: the same for a 1.1.0 and a 1.2.0 block', () => {
    for (const [now, name] of [[spanFwd, 'span_fwd'], [spanBwd, 'span_bwd'], [corsi, 'corsi']] as const) {
      const a = now.generate('info').params
      const b = SPAN_LEGACY_FAMILIES[name]!.generate('info').params
      expect(a).toEqual(b)
      if (a.model !== 'grm') throw new Error('span must be GRM')
      for (const theta of [-2, 0, 2]) expect(infoGrm(theta, a.a, a.b)).toBeGreaterThan(0)
    }
  })
})

describe('what the reactive procedure changes: the trials given', () => {
  it.each(SPAN_TASKS)('$name: expected trials and time at θ = 0, 1 and 2, fixed against reactive on one clock', (cfg) => {
    const b = grmThresholds(cfg)
    const rows = [0, 1, 2].map((theta) => {
      const p = spanTrialP(theta, SPAN_GRM_A, b)
      const time = (procedure: 'fixed' | 'reactive'): { trials: number; s: number } => {
        // Expected time of the trials given: each length's trial time by the chance of reaching it and the trials it takes.
        let reach = 1
        let s = SPAN_TIME_V1.instructions_s
        let trials = 0
        for (let k = 0; k < b.length; k++) {
          const n = procedure === 'fixed' ? 2 : 2 - p[k]!
          trials += reach * n
          s += reach * n * spanTrialTimeS(cfg, 3 + k)
          reach *= 1 - (1 - p[k]!) ** 2
        }
        return { trials, s }
      }
      const fixed = time('fixed')
      const reactive = time('reactive')
      // The closed form agrees with the walk of the state machines.
      expect(outcomeDistribution({ start_length: 3, trials_per_length: 2, max_length: cfg.maxLength, procedure: 'reactive' }, p).trials).toBeCloseTo(reactive.trials, 9)
      expect(outcomeDistribution({ start_length: 3, trials_per_length: 2, max_length: cfg.maxLength, procedure: 'fixed' }, p).trials).toBeCloseTo(fixed.trials, 9)
      return { theta, fixed, reactive, savedS: fixed.s - reactive.s }
    })
    // A median taker saves 25 to 50 s a block, about a quarter; a strong one more, about a third.
    expect(rows[0]!.savedS).toBeGreaterThan(25)
    expect(rows[0]!.savedS).toBeLessThan(50)
    expect(rows[0]!.savedS / rows[0]!.fixed.s).toBeGreaterThan(0.2)
    expect(rows[2]!.savedS).toBeGreaterThan(rows[0]!.savedS)
    expect(rows[2]!.savedS / rows[2]!.fixed.s).toBeGreaterThan(0.28)
    for (const r of rows) expect(r.reactive.trials).toBeLessThan(r.fixed.trials)
  })

  it('the trial record: the likelihood needs no correction, a plain proportion correct does', () => {
    // One length, p = ½. Fixed: two trials, E[correct/given] = ½. Reactive: stop at the first success, so the
    // proportion reads 1 half the time, ½ a quarter and 0 a quarter: its mean is 0.625, not 0.5.
    const p = [0.5]
    const proto = { start_length: 3, trials_per_length: 2, max_length: 3 }
    const mean = (procedure: 'fixed' | 'reactive'): number => {
      let m = 0
      for (const path of [[true], [false, true], [false, false], [true, true], [true, false]] as boolean[][]) {
        let s
        try {
          s = spanStatus({ ...proto, procedure }, path)
        } catch {
          continue // not a path of this procedure
        }
        if (!s.finished) continue
        const prob = path.reduce((q, r) => q * (r ? p[0]! : 1 - p[0]!), 1)
        m += (prob * s.outcome.trials_correct) / s.outcome.trials_given
      }
      return m
    }
    expect(mean('fixed')).toBeCloseTo(0.5, 12)
    expect(mean('reactive')).toBeCloseTo(0.625, 12)
    // The likelihood of a reactive path is p^correct (1 − p)^wrong, as for a fixed one: its maximum over the
    // three paths is at correct/given too, but the estimator to use across blocks is the pooled one,
    // Σ correct / Σ given, whose expectation of numerator and denominator are in the ratio p: 0.75 / 1.5.
    const dist = outcomeDistribution({ ...proto, procedure: 'reactive' }, p)
    expect(dist.correct / dist.trials).toBeCloseTo(0.5, 12)
  })
})

describe('re-simulation with the families: θ recovery is the same under both procedures', () => {
  /** A taker at θ takes the block trial by trial with the GRM's trial-level chances; the outcome is scored by the family. */
  function takeBlock(item: SpanItem, theta: number, seed: string): { outcome: SpanOutcome; observation: Observation } {
    const params = item.params
    if (params.model !== 'grm') throw new Error('span must be GRM')
    const p = spanTrialP(theta, params.a, params.b)
    const rng = createRng(seed)
    const out: number[][] = []
    for (;;) {
      const s = runBlock(item, out)
      if (s.finished) return { outcome: s.outcome, observation: { kind: 'grm', axis: 'WM', a: params.a, b: [...params.b], y: s.outcome.category } }
      out.push(rng.next() < p[s.length - 3]! ? [...(item.key.sequences[s.trial] as number[])] : [])
    }
  }

  it('three blocks a session (forward, backward, Corsi): r and RMSE of the WM estimate agree, and the reactive session gives about a third fewer trials', () => {
    const n = 1500
    const mu = new Array<number>(N_AXES).fill(0)
    const sigma = initialSigma()
    const people = createRng('procedure-recovery')
    const stats = { fixed: { sx: 0, sxx: 0, sxy: 0, se2: 0, trials: 0, sd: 0 }, reactive: { sx: 0, sxx: 0, sxy: 0, se2: 0, trials: 0, sd: 0 } }
    let st = 0
    let stt = 0
    for (let i = 0; i < n; i++) {
      const theta = people.normal()
      st += theta
      stt += theta * theta
      for (const procedure of ['fixed', 'reactive'] as const) {
        const obs: Observation[] = []
        for (const now of [spanFwd, spanBwd, corsi]) {
          const family = procedure === 'fixed' ? SPAN_LEGACY_FAMILIES[now.name]! : now
          const r = takeBlock(family.generate(`rec.${i}`), theta, `rec.${procedure}.${now.name}.${i}`)
          obs.push(r.observation)
          stats[procedure].trials += r.outcome.trials_given
        }
        const post = eapByAxis(obs, mu, sigma).WM!
        const s = stats[procedure]
        s.sx += post.mean
        s.sxx += post.mean * post.mean
        s.sxy += post.mean * theta
        s.se2 += (post.mean - theta) ** 2
        s.sd += post.sd
      }
    }
    const summary = (s: (typeof stats)['fixed']) => {
      const cov = s.sxy / n - (s.sx / n) * (st / n)
      const r = cov / Math.sqrt((s.sxx / n - (s.sx / n) ** 2) * (stt / n - (st / n) ** 2))
      return { r, rmse: Math.sqrt(s.se2 / n), sd: s.sd / n, trials: s.trials / n }
    }
    const fixed = summary(stats.fixed)
    const reactive = summary(stats.reactive)
    // Same model, independent draws: the two agree within sampling error. Measured at N = 6,000, three
    // replications each: r .842 / .846 / .851 fixed and .855 / .846 / .850 reactive; RMSE .52 to .54 and mean
    // posterior SD .525 under both. (At N = 1,500 the sampling SE of r is about .007, of a difference .01.)
    expect(Math.abs(fixed.r - reactive.r)).toBeLessThan(0.04)
    expect(Math.abs(fixed.rmse - reactive.rmse)).toBeLessThan(0.05)
    expect(Math.abs(fixed.sd - reactive.sd)).toBeLessThan(0.01)
    expect(reactive.r).toBeGreaterThan(0.82)
    expect(fixed.r).toBeGreaterThan(0.82)
    // The posterior SD the scorer reports is honest under the reactive procedure: it matches the realised error.
    expect(Math.abs(reactive.rmse - reactive.sd)).toBeLessThan(0.04)
    expect(reactive.trials / fixed.trials).toBeGreaterThan(0.6)
    expect(reactive.trials / fixed.trials).toBeLessThan(0.75)
  })
})
