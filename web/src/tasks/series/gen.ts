/**
 * Series generator (DESIGN §4.2 "Series"; ROADMAP M1.7, A11). Draws a stratum, then a key rule
 * family from that stratum's menu and its coefficients, and keeps the draw only if its v0 prior
 * lands in the stratum and it passes the full uniqueness analysis of `rules.ts` (so every
 * generated item verifies by construction). Every random number comes from the seeded `rng`.
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import { seriesDifficulty, seriesExpectedTime, seriesFeatures } from './prior'
import {
  ALPHABET,
  MAX_VISIBLE,
  MIN_VISIBLE,
  TERM_BOUND,
  analyse,
  inRuleDomain,
  keyConfirmations,
  mod,
  positionLetter,
  uniquenessChecks,
  type Coefficients,
  type RuleName,
} from './rules'
import type { SeriesKey, SeriesSpec, SeriesStructure } from './types'

/** Strata the family generates (stratum 6, b ≥ 2.5, is out of reach of the v0 prior's intent). */
export const SERIES_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5] as const)

/** Stratum weights when none is requested (few stratum-1 items: that content space is small). */
const NATURAL_STRATA: readonly (readonly [Stratum, number])[] = [
  [1, 1.2],
  [2, 2],
  [3, 3],
  [4, 2.5],
  [5, 1.5],
]

/** Rule menu per stratum (weights); the prior decides whether a draw lands in the stratum. */
const MENUS: Readonly<Record<number, readonly (readonly [RuleName, number])[]>> = {
  1: [
    ['arithmetic', 9],
    ['letter', 1],
  ],
  2: [
    ['arithmetic', 6],
    ['letter', 1.5],
    ['geometric', 1],
  ],
  3: [
    ['geometric', 1.5],
    ['quadratic', 3],
    ['interleaved', 3],
    ['fibonacci', 3],
    ['arithmetic', 1],
  ],
  4: [
    ['quadratic', 3],
    ['interleaved', 3],
    ['fibonacci', 3],
    ['composite_alt', 3],
    ['composite_aff', 2],
  ],
  5: [
    ['composite_alt', 5],
    ['composite_aff', 3],
    ['quadratic', 1],
    ['interleaved', 1],
    ['fibonacci', 1],
  ],
}

/** Draws per item before giving up (never reached in the 10k property runs). */
export const MAX_ATTEMPTS = 20_000

/** A drawn series: its key rule and t_0 … t_m (visible terms, then the key; letters as positions). */
export interface Draft {
  readonly rule: RuleName
  readonly coefficients: Coefficients
  readonly values: readonly number[]
}

function weighted<T>(rng: Rng, menu: readonly (readonly [T, number])[]): T {
  const total = menu.reduce((s, [, w]) => s + w, 0)
  let u = rng.next() * total
  for (const [v, w] of menu) {
    if (u < w) return v
    u -= w
  }
  return (menu[menu.length - 1] as readonly [T, number])[0]
}

const signed = (rng: Rng, lo: number, hi: number, pNegative: number): number =>
  (rng.next() < pNegative ? -1 : 1) * rng.int(lo, hi)

/** Terms 0 … m of a recurrence t_{i+1} = step(i, t_i). */
function run(t0: number, m: number, step: (i: number, t: number) => number): number[] {
  const out = [t0]
  for (let i = 0; i < m; i++) out.push(step(i, out[i] as number) + 0)
  return out
}

type Sampler = (rng: Rng, m: number) => Draft

const SAMPLERS: Readonly<Record<RuleName, Sampler>> = {
  arithmetic(rng, m) {
    const size = rng.int(0, 2)
    const d = signed(rng, 1, [15, 60, 400][size] as number, 0.3)
    const t0 = [() => rng.int(0, 99), () => rng.int(-60, 999), () => rng.int(-3000, 6000)][size]!()
    return { rule: 'arithmetic', coefficients: { d }, values: run(t0, m, (_, t) => t + d) }
  },
  letter(rng, m) {
    const d = signed(rng, 1, 8, 0.35)
    const p0 = rng.int(1, ALPHABET)
    return { rule: 'letter', coefficients: { d }, values: run(p0, m, (_, p) => mod(p - 1 + d, ALPHABET) + 1) }
  },
  geometric(rng, m) {
    const r = rng.pick([2, 2, 2, 3, 3, 4, 5, -2, -3])
    const feasible = Math.max(1, Math.floor(TERM_BOUND / Math.abs(r) ** m))
    const t0 = signed(rng, 1, rng.next() < 0.5 ? feasible : Math.min(feasible, rng.pick([6, 20, 80])), 0.2)
    return { rule: 'geometric', coefficients: { r }, values: run(t0, m, (_, t) => t * r) }
  },
  quadratic(rng, m) {
    const s = signed(rng, 1, 8, 0.3)
    const d0 = rng.int(-15, 25)
    const t0 = rng.next() < 0.6 ? rng.int(-20, 40) : rng.int(-300, 1500)
    return { rule: 'quadratic', coefficients: { s }, values: run(t0, m, (i, t) => t + d0 + i * s) }
  },
  interleaved(rng, m) {
    const da = signed(rng, 1, 12, 0.3)
    const db = signed(rng, 1, 12, 0.3)
    const big = rng.next() < 0.3
    const t0 = big ? rng.int(-500, 3000) : rng.int(-20, 60)
    const t1 = big ? rng.int(-500, 3000) : rng.int(-20, 60)
    const values = Array.from({ length: m + 1 }, (_, i) => (i % 2 === 0 ? t0 + (i / 2) * da : t1 + ((i - 1) / 2) * db))
    return { rule: 'interleaved', coefficients: { da, db }, values }
  },
  fibonacci(rng, m) {
    const c = rng.int(-5, 5)
    const size = rng.int(0, 2)
    const [lo, hi] = ([[0, 10], [-20, 40], [20, 400]] as const)[size] as readonly [number, number]
    const values = [rng.int(lo, hi), rng.int(lo, hi)]
    while (values.length <= m) values.push((values[values.length - 1] as number) + (values[values.length - 2] as number) + c)
    return { rule: 'fibonacci', coefficients: { c }, values }
  },
  composite_alt(rng, m) {
    const pattern = rng.pick(['mul_add', 'add_mul', 'mul_add', 'add_mul', 'mul_mul', 'add_add'] as const)
    const mul = (): number => rng.pick([2, 2, 3, -2])
    const add = (): number => signed(rng, 1, 20, 0.35)
    let a: [string, number]
    let b: [string, number]
    if (pattern === 'mul_mul') {
      const [k1, k2] = rng.pick([[2, 3], [3, 2], [-2, 2], [2, -2], [-2, 3]] as const)
      a = ['mul', k1]
      b = ['mul', k2]
    } else if (pattern === 'add_add') {
      const p = add()
      let q = add()
      while (q === p) q = add()
      a = ['add', p]
      b = ['add', q]
    } else {
      a = pattern === 'mul_add' ? ['mul', mul()] : ['add', add()]
      b = pattern === 'mul_add' ? ['add', add()] : ['mul', mul()]
    }
    const t0 = rng.next() < 0.7 ? signed(rng, 1, 20, 0.2) : signed(rng, 20, 300, 0.2)
    const [opA, xA] = a
    const [opB, xB] = b
    const values = run(t0, m, (i, t) => {
      const [op, x] = i % 2 === 0 ? a : b
      return op === 'add' ? t + x : t * x
    })
    return { rule: 'composite_alt', coefficients: { op_a: opA, by_a: xA, op_b: opB, by_b: xB }, values }
  },
  composite_aff(rng, m) {
    const k = rng.pick([2, 2, 3, -2])
    const c = signed(rng, 1, 25, 0.4)
    const t0 = rng.next() < 0.7 ? signed(rng, 1, 20, 0.25) : signed(rng, 20, 200, 0.25)
    return { rule: 'composite_aff', coefficients: { m: k, c }, values: run(t0, m, (_, t) => k * t + c) }
  },
}

/** The fewest visible terms a key rule of `rule` may show: its t_m must be confirmed (`keyConfirmations` ≥ 1). */
export function minVisibleFor(rule: RuleName): number {
  let m = MIN_VISIBLE
  while (keyConfirmations(rule, m) < 1) m++
  return m
}

/** Draw one series of `rule` with m visible terms (not yet checked); interleaved shows 6–7. */
export function sampleDraft(rng: Rng, rule: RuleName, m = rng.int(minVisibleFor(rule), MAX_VISIBLE)): Draft {
  return SAMPLERS[rule](rng, m)
}

/** The spec and key of a draft. */
export function renderDraft(draft: Draft): { spec: SeriesSpec; key: SeriesKey } {
  const m = draft.values.length - 1
  const visible = draft.values.slice(0, m)
  const next = draft.values[m] as number
  if (draft.rule === 'letter') {
    return { spec: { input_format: 'letter', terms: visible.map(positionLetter) }, key: { letter: positionLetter(next) } }
  }
  return { spec: { input_format: 'integer', terms: visible }, key: { value: String(next), tol: { abs: 0 } } }
}

/** Whether a draft is in bounds, in its rule's domain and unique under the analysis with its own rule as key. */
export function acceptDraft(draft: Draft): boolean {
  if (!draft.values.every((x) => Number.isSafeInteger(x) && Math.abs(x) <= TERM_BOUND)) return false
  if (!inRuleDomain(draft.rule, draft.coefficients)) return false
  const m = draft.values.length - 1
  const analysis = analyse(draft.values.slice(0, m), draft.rule === 'letter')
  const checks = uniquenessChecks(analysis, draft, draft.values[m] as number)
  return Object.values(checks).every((v) => v !== false)
}

/** `build()` of the series family (see `defineFamily`). */
export function buildSeries(rng: Rng, ctx: BuildContext): BuiltItem<SeriesSpec, SeriesKey> {
  const stratum = ctx.stratum ?? weighted(rng, NATURAL_STRATA)
  const menu = MENUS[stratum]
  if (!menu) throw new RangeError(`series cannot generate stratum ${stratum}`)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const draft = sampleDraft(rng, weighted(rng, menu))
    if (!draft.values.every((x) => Number.isSafeInteger(x) && Math.abs(x) <= TERM_BOUND)) continue
    const features = seriesFeatures(draft.rule, draft.coefficients, draft.values)
    const difficulty = seriesDifficulty(features)
    if (stratumOfB(difficulty.b_prior) !== stratum || !acceptDraft(draft)) continue
    const structure: SeriesStructure = { rule: draft.rule, coefficients: draft.coefficients }
    return {
      stratum,
      ...renderDraft(draft),
      structural_params: { rule: structure.rule, coefficients: { ...structure.coefficients } },
      difficulty,
      expected_time_s: seriesExpectedTime(features),
    }
  }
  throw new Error(`series: no valid item for stratum ${stratum} after ${MAX_ATTEMPTS} draws`)
}
