import { describe, expect, it } from 'vitest'
import { buildBlob } from './blob'
import { axisEstimates, axisSamples, N_FUZZ } from './profile'
import { syntheticProfile } from './synthetic'

/** The CI flag, read without Node typings (the app tsconfig has none); '', '0' and 'false' are unset. */
const CI_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI
const CI = CI_ENV !== undefined && !['', '0', 'false'].includes(CI_ENV.trim().toLowerCase())
/** ROADMAP M1.16: render < 50 ms for K = 17 with 20 fuzz curves (CI-lenient: shared runners). */
const BUDGET_MS = CI ? 200 : 50
const RUNS = 15
const WARMUP = 3

describe('blob bench (ROADMAP M1.16)', () => {
  it(`K = 17 with ${N_FUZZ} fuzz curves: estimates + posterior draws + every path, median of ${RUNS} runs < ${BUDGET_MS} ms`, () => {
    const input = syntheticProfile('full')!.input
    const run = (seed: string): number => {
      const t0 = performance.now()
      const est = axisEstimates(input)
      const model = buildBlob(est, axisSamples(input, est, N_FUZZ, seed))
      const ms = performance.now() - t0
      expect(model.spokes).toHaveLength(17)
      expect(model.fuzz).toHaveLength(N_FUZZ)
      return ms
    }
    for (let i = 0; i < WARMUP; i++) run(`warm-${i}`)
    // A new seed per run, so every run redraws and re-chooses every curve.
    const times = Array.from({ length: RUNS }, (_, i) => run(`bench-${i}`)).sort((a, b) => a - b)
    const median = times[Math.floor(RUNS / 2)]!
    console.info(`blob model K=17 + ${N_FUZZ} fuzz: median ${median.toFixed(2)} ms (min ${times[0]!.toFixed(2)}, max ${times.at(-1)!.toFixed(2)})`)
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
