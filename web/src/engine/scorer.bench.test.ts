import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, initialSigma, N_AXES } from './axes'
import { grmProbs, logistic } from './irt'
import { createRng } from './prng'
import { mapTheta } from './scorer'
import type { Observation } from './types'

/** The CI flag, read without Node typings (the app tsconfig has none); '', '0' and 'false' are unset. */
const CI_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI
const CI = CI_ENV !== undefined && !['', '0', 'false'].includes(CI_ENV.trim().toLowerCase())
/** ROADMAP M1.3 acceptance: MAP with K = 17 and 150 observations < 10 ms in Node (50 ms on CI runners). */
const BUDGET_MS = CI ? 50 : 10
const N_OBS = 150
const RUNS = 20
const WARMUP = 5

/** A simulated full session: 150 observations spread over all 17 axes, kind by the axis's model. */
function session(seed: string): Observation[] {
  const rng = createRng(seed)
  const theta = AXIS_CODES.map(() => rng.normal())
  return Array.from({ length: N_OBS }, (_, i): Observation => {
    const k = i % N_AXES
    const axis = AXIS_CODES[k]!
    const t = theta[k]!
    const a = 0.7 + 1.5 * rng.next()
    const b = rng.normal(0, 1.2)
    switch (AXES[k]!.modelKind) {
      case 'grm': {
        const bs = [b - 0.8, b, b + 0.8]
        const probs = grmProbs(t, a, bs)
        let u = rng.next()
        let y = 0
        while (y < bs.length && u >= probs[y]!) u -= probs[y++]!
        return { kind: 'grm', axis, a, b: bs, y }
      }
      case 'gaussian': {
        const lam = axis === 'RT' ? -1 : 1
        const d = rng.normal(0, 0.5)
        return { kind: 'gaussian', axis, lam, d, sigma: 0.5, x: lam * t + d + rng.normal(0, 0.5) }
      }
      default: {
        if (axis === 'SPA') {
          const c = 0.25 // 4-option items (A9)
          return { kind: '3pl', axis, a, b, c, y: rng.next() < c + (1 - c) * logistic(a * (t - b)) ? 1 : 0 }
        }
        return { kind: '2pl', axis, a, b, y: rng.next() < logistic(a * (t - b)) ? 1 : 0 }
      }
    }
  })
}

describe('scorer bench (ROADMAP M1.3)', () => {
  it(`MAP with K = ${N_AXES} and ${N_OBS} observations: median of ${RUNS} runs < ${BUDGET_MS} ms`, () => {
    const obs = session('m1.3-bench')
    const mu = new Array<number>(N_AXES).fill(0)
    const sigma = initialSigma()
    for (let i = 0; i < WARMUP; i++) mapTheta(obs, mu, sigma)
    const times: number[] = []
    let nIter = 0
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      nIter = mapTheta(obs, mu, sigma).nIter
      times.push(performance.now() - t0)
    }
    times.sort((x, y) => x - y)
    const median = (times[RUNS / 2 - 1]! + times[RUNS / 2]!) / 2
    if (CI) console.info(`scorer bench: median ${median.toFixed(3)} ms over ${RUNS} runs (${nIter} iterations)`)
    expect(nIter).toBeLessThan(50)
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
