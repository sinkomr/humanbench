import { describe, expect, it } from 'vitest'
import { CI, cpuMs, judgedMs, median as medianOf } from '../bench-support'
import { buildBlob, fitLayout, N_FUZZ } from './blob'
import { axisEstimates } from './profile'
import { syntheticProfile } from './synthetic'

/** ROADMAP M1.16: render < 50 ms for K = 17 with 20 fuzz curves (CI-lenient: shared runners). */
const BUDGET_MS = CI ? 200 : 50
const RUNS = 15
const WARMUP = 3

describe('blob bench (ROADMAP M1.16)', () => {
  it(`K = 17 with ${N_FUZZ} fuzz curves: estimates + phone text fit + every path, median of ${RUNS} runs < ${BUDGET_MS} ms`, () => {
    const input = syntheticProfile('full')!.input
    const run = (): number => {
      const t0 = performance.now()
      const est = axisEstimates(input)
      // The worst case: a phone-width chart, where the text layout is searched for (fitLayout).
      const layout = fitLayout(est, 328)
      const model = buildBlob(est, { layout })
      const ms = performance.now() - t0
      expect(model.spokes).toHaveLength(17)
      expect(model.fuzz).toHaveLength(N_FUZZ)
      return ms
    }
    for (let i = 0; i < WARMUP; i++) run()
    // Nothing is cached between runs: each one re-fits the text and re-chooses every curve.
    const c0 = cpuMs()
    const times = Array.from({ length: RUNS }, () => run()).sort((a, b) => a - b)
    const median = judgedMs(medianOf(times), c0, cpuMs(), RUNS)
    console.info(`blob model K=17 + ${N_FUZZ} fuzz: median ${median.toFixed(2)} ms (min ${times[0]!.toFixed(2)}, max ${times.at(-1)!.toFixed(2)})`)
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
