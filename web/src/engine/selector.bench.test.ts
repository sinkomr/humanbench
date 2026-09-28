import { describe, expect, it } from 'vitest'
import { logistic } from './irt'
import { createRng } from './prng'
import { selectNext, selectionRng, sessionPosterior, type AdministeredItem, type SelectorState } from './selector'
import type { Observation } from './types'
import { quant } from '../tasks/quant'
import { rotation } from '../tasks/rotation'
import { series } from '../tasks/series'

/** The CI flag, read without Node typings (the app tsconfig has none); '', '0' and 'false' are unset. */
const CI_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI
const CI = CI_ENV !== undefined && !['', '0', 'false'].includes(CI_ENV.trim().toLowerCase())
/**
 * ROADMAP M1.14: one selection (posterior + pool + pick) < 20 ms in Node (100 ms on CI runners, as
 * M1.3's bench). This is the steady state, after {@link WARMUP} discarded runs.
 */
const BUDGET_MS = CI ? 100 : 20
const RUNS = 20
const WARMUP = 5
/**
 * The first selection of a process also pays the family-role probes (`isCatFamily` generates one
 * item per CAT family) and JIT warm-up, about 30 ms in Node. It is bounded loosely here; the
 * session flow (M1.15) can move the probes off the first item by calling `catFamilies()` early.
 */
const COLD_BUDGET_MS = CI ? 1000 : 150

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
    const t0 = performance.now()
    const sel = selectNext({ sessionSeed: 'cold', posterior: sessionPosterior([]), administered: [] }, selectionRng('cold', 0))
    const ms = performance.now() - t0
    if (CI) console.info(`selector bench: cold first selection ${ms.toFixed(1)} ms`)
    expect(sel.kind).toBe('item')
    expect(ms).toBeLessThan(COLD_BUDGET_MS)
  })

  it(`one selection over every CAT axis (steady state): median of ${RUNS} runs < ${BUDGET_MS} ms`, () => {
    const { state, obs } = midSession()
    const once = () => selectNext({ ...state, posterior: sessionPosterior(obs) }, selectionRng(state.sessionSeed, state.administered.length))
    for (let i = 0; i < WARMUP; i++) once()
    const times: number[] = []
    let poolSize = 0
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      const sel = once()
      times.push(performance.now() - t0)
      if (sel.kind === 'item') poolSize = sel.poolSize
    }
    times.sort((x, y) => x - y)
    const median = (times[RUNS / 2 - 1]! + times[RUNS / 2]!) / 2
    if (CI) console.info(`selector bench: median ${median.toFixed(3)} ms over ${RUNS} runs (pool ${poolSize})`)
    expect(poolSize).toBeGreaterThanOrEqual(20) // a realistic pool, not a trivially small one
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
