import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, initialSigma, N_AXES } from './axes'
import { CI, cpuMs, judgedMs, loadAdjusted, median as medianOf } from '../bench-support'
import { grmProbs, logistic } from './irt'
import { createRng } from './prng'
import { mapTheta, testletObservation } from './scorer'
import type { Observation, TestletItem } from './types'

/** ROADMAP M1.3 acceptance: MAP with K = 17 and 150 observations < 10 ms in Node (50 ms on CI runners). */
const BUDGET_MS = loadAdjusted('scorer bench', CI ? 50 : 10)
const N_OBS = 150
const RUNS = 20
const WARMUP = 5

/** A simulated full session: 150 observations spread over all 17 axes, kind by the axis's default model. */
function session(seed: string): Observation[] {
  const rng = createRng(seed)
  const theta = AXIS_CODES.map(() => rng.normal())
  return Array.from({ length: N_OBS }, (_, i): Observation => {
    const k = i % N_AXES
    const axis = AXIS_CODES[k]!
    const t = theta[k]!
    const a = 0.7 + 1.5 * rng.next()
    const b = rng.normal(0, 1.2)
    switch (AXES[k]!.defaultModelKind) {
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
      case '3pl': {
        const c = 0.25 // 4-option items (A9)
        return { kind: '3pl', axis, a, b, c, y: rng.next() < c + (1 - c) * logistic(a * (t - b)) ? 1 : 0 }
      }
      default:
        return { kind: '2pl', axis, a, b, y: rng.next() < logistic(a * (t - b)) ? 1 : 0 }
    }
  })
}

/**
 * A session with testlets (M3.9): the plain session's terms on the other axes, and six 4-item
 * testlets (the DESIGN §3 size) on each of LG and RC, whose responses follow the §7.1 model
 * (a passage effect γ ~ N(0, 0.3²) per testlet).
 */
function sessionWithTestlets(seed: string): Observation[] {
  const rng = createRng(`${seed}-testlets`)
  const rest = session(seed).filter((o) => o.axis !== 'LG' && o.axis !== 'RC')
  const testlets: Observation[] = []
  for (const axis of ['LG', 'RC'] as const) {
    const t = rng.normal()
    for (let p = 0; p < 6; p++) {
      const gamma = rng.normal(0, 0.3)
      const items: TestletItem[] = Array.from({ length: 4 }, () => {
        const a = 0.7 + 1.5 * rng.next()
        const b = rng.normal(0, 1.2)
        return { a, b, y: rng.next() < logistic(a * (t + gamma - b)) ? 1 : 0 }
      })
      testlets.push(testletObservation(axis, items))
    }
  }
  return [...rest, ...testlets]
}

describe('scorer bench (ROADMAP M1.3)', () => {
  it(`MAP with K = ${N_AXES} and ${N_OBS} observations: median of ${RUNS} runs < ${BUDGET_MS} ms`, { retry: 2 }, () => {
    const obs = session('m1.3-bench')
    const mu = new Array<number>(N_AXES).fill(0)
    const sigma = initialSigma()
    for (let i = 0; i < WARMUP; i++) mapTheta(obs, mu, sigma)
    const times: number[] = []
    let nIter = 0
    const c0 = cpuMs()
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      nIter = mapTheta(obs, mu, sigma).nIter
      times.push(performance.now() - t0)
    }
    const median = judgedMs(medianOf(times), c0, cpuMs(), RUNS)
    if (CI) console.info(`scorer bench: median ${median.toFixed(3)} ms over ${RUNS} runs (${nIter} iterations)`)
    expect(nIter).toBeLessThan(50)
    expect(median).toBeLessThan(BUDGET_MS)
  })
  it(`MAP with K = ${N_AXES} and twelve 4-item testlets (M3.9): median of ${RUNS} runs < ${BUDGET_MS} ms`, { retry: 2 }, () => {
    const obs = sessionWithTestlets('m3.9-bench')
    expect(obs.filter((o) => o.kind === 'testlet')).toHaveLength(12)
    const mu = new Array<number>(N_AXES).fill(0)
    const sigma = initialSigma()
    for (let i = 0; i < WARMUP; i++) mapTheta(obs, mu, sigma)
    const times: number[] = []
    let nIter = 0
    const c0 = cpuMs()
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      nIter = mapTheta(obs, mu, sigma).nIter
      times.push(performance.now() - t0)
    }
    const median = judgedMs(medianOf(times), c0, cpuMs(), RUNS)
    if (CI) console.info(`scorer bench (testlets): median ${median.toFixed(3)} ms over ${RUNS} runs (${nIter} iterations)`)
    expect(nIter).toBeLessThan(50)
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
