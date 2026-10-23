import { describe, expect, it } from 'vitest'
import { logistic } from './irt'
import { createRng } from './prng'
import { selectNext, selectionRng, sessionPosterior, type AdministeredItem, type SelectorState } from './selector'
import type { Observation } from './types'
import { CI, cpuMs, judgedMs, loadAdjusted, median as medianOf } from '../bench-support'
import { quant } from '../tasks/quant'
import { rotation } from '../tasks/rotation'
import { series } from '../tasks/series'

/**
 * ROADMAP M1.14: one selection (posterior + pool + pick) < 20 ms in Node (100 ms on CI runners, as
 * M1.3's bench). This is the steady state, after {@link WARMUP} discarded runs.
 *
 * Raised to 30 ms with the scope-variety families (M3.13, 2026-10-23): a selection draws up to twelve candidates per
 * family of every eligible axis, and the device's CAT families went from four to eight (Spatial four, Quantitative
 * two), so a selection generates twice the items. Measured on the dev Mac at a load of about 70 from other worktrees:
 * 23–27 ms (the base branch under 20 ms at the same load); the generators were sped up first (paper folding 0.9 →
 * 0.18 ms an item, 2D figures 1.8 → 0.33 ms, the matrices template pool built per stratum on first use). The pick
 * itself and the selection rules are unchanged, and 30 ms between two questions is still not perceptible.
 */
const BUDGET_MS = loadAdjusted('selector bench', CI ? 100 : 30)
const RUNS = 20
const WARMUP = 5
/**
 * The first selection of a process also pays JIT warm-up (family roles come from the `kind`
 * marker, M1.F2, so there are no probes), about 30 ms in Node. It is bounded loosely here.
 */
const COLD_BUDGET_MS = loadAdjusted('selector bench (cold)', CI ? 1000 : 250)
// Raised from 150 to 250 ms with the scope-variety families (M3.13, 2026-10-23): the first selection now also builds
// the tables the new generators keep (the matrices 1.4.0 template candidates of the three nearest strata, about 10 ms
// each; the folding configurations and fold plans; the 2D figures' shape cache), measured 80–190 ms here at loads of
// 35–70. A next step, not built: warm these in idle time before the first question part (runtime-loader.ts).

/**
 * A realistic mid-session state: 24 CAT items already administered over MAT, QR and SPA with
 * simulated responses (plus the 7 fixed blocks' worth of RT/WM/PS observations), and 60
 * families seen in two earlier sessions, so exclusion and the sibling rule are live.
 */
function midSession(): { state: SelectorState; obs: Observation[] } {
  const seed = 'm1.14-bench'
  const resp = createRng(`${seed}/responses`)
  const obs: Observation[] = [
    { kind: 'gaussian', axis: 'RT', lam: -0.15, d: 5.7, sigma: 0.05, x: 5.65 },
    { kind: 'gaussian', axis: 'RT', lam: -0.15, d: 6.1, sigma: 0.05, x: 6.02 },
    { kind: 'grm', axis: 'WM', a: 1.7, b: [-2, -1, 0, 1, 2], y: 3 },
    { kind: 'grm', axis: 'WM', a: 1.7, b: [-1.5, -0.5, 0.5, 1.5], y: 2 },
    { kind: 'grm', axis: 'WM', a: 1.7, b: [-2, -1, 0, 1, 2], y: 2 },
    { kind: 'gaussian', axis: 'PS', lam: 0.25, d: 3.69, sigma: 0.14, x: 3.8 },
    { kind: 'gaussian', axis: 'PS', lam: 0.25, d: 5.37, sigma: 0.16, x: 5.4 },
  ]
  const seenFamilies = [rotation, series, quant].flatMap((f) => Array.from({ length: 20 }, (_, i) => f.generate(`earlier/${i}`).family_id))
  const administered: AdministeredItem[] = []
  for (let n = 0; n < 24; n++) {
    const state: SelectorState = { sessionSeed: seed, posterior: sessionPosterior(obs), administered, seenFamilies }
    const sel = selectNext(state, selectionRng(seed, n))
    if (sel.kind !== 'item') throw new Error(`bench setup: ${sel.reason}`)
    const p = sel.item.params
    if (p.model !== '2pl' && p.model !== '3pl') throw new Error('bench setup: not a CAT item')
    const pc = p.model === '3pl' ? p.c + (1 - p.c) * logistic(p.a * (0.7 - p.b)) : logistic(p.a * (0.7 - p.b))
    const y = resp.next() < pc ? 1 : 0
    obs.push(p.model === '3pl' ? { kind: '3pl', axis: sel.axis, a: p.a, b: p.b, c: p.c, y } : { kind: '2pl', axis: sel.axis, a: p.a, b: p.b, y })
    administered.push(sel.item)
  }
  return { state: { sessionSeed: seed, posterior: sessionPosterior(obs), administered, seenFamilies, remainingS: 600 }, obs }
}

describe('selector bench (ROADMAP M1.14)', () => {
  // Must stay the first test of this file: the module graph is fresh per file, so this is cold.
  it(`the first (cold) selection over every CAT axis < ${COLD_BUDGET_MS} ms`, () => {
    const c0 = cpuMs()
    const t0 = performance.now()
    const sel = selectNext({ sessionSeed: 'cold', posterior: sessionPosterior([]), administered: [] }, selectionRng('cold', 0))
    const wallMs = performance.now() - t0
    const c1 = cpuMs()
    // Wall time counts the time this process waited for a core: on a machine running other suites (a load
    // of 100+ was seen with several worktrees) one cold selection took 185–219 ms of wall time. The CPU time it
    // used is not inflated by that, and a real regression raises both, so the smaller of the two is judged.
    const ms = judgedMs(wallMs, c0, c1, 1)
    if (CI) console.info(`selector bench: cold first selection ${ms.toFixed(1)} ms`)
    expect(sel.kind).toBe('item')
    expect(ms).toBeLessThan(COLD_BUDGET_MS)
  })

  // Wall-clock: a load spike from parallel test files (e.g. the M1.4b simulation) or other processes
  // can push one median over; a real regression fails every attempt (M1.4b review).
  it(`one selection over every CAT axis (steady state): median of ${RUNS} runs < ${BUDGET_MS} ms`, { retry: 2 }, () => {
    const { state, obs } = midSession()
    const once = () => selectNext({ ...state, posterior: sessionPosterior(obs) }, selectionRng(state.sessionSeed, state.administered.length))
    for (let i = 0; i < WARMUP; i++) once()
    const times: number[] = []
    let poolSize = 0
    const c0 = cpuMs()
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      const sel = once()
      times.push(performance.now() - t0)
      if (sel.kind === 'item') poolSize = sel.poolSize
    }
    const c1 = cpuMs()
    // 43 ms against the 20 ms budget was seen at a load of about 100, and it passes alone (bench-support.ts).
    const median = judgedMs(medianOf(times), c0, c1, RUNS)
    if (CI) console.info(`selector bench: median ${median.toFixed(3)} ms over ${RUNS} runs (pool ${poolSize})`)
    expect(poolSize).toBeGreaterThanOrEqual(20) // a realistic pool, not a trivially small one
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
