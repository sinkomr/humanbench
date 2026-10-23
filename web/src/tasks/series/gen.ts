/**
 * Series generator (DESIGN §4.2 "Series"; ROADMAP M1.7, M1.P, A11). Without a requested stratum
 * it draws the natural pool: a key rule family from {@link NATURAL_MENU} and its coefficients,
 * kept if it passes the full uniqueness analysis of `rules.ts` (so every generated item verifies
 * by construction); the stratum is the band of its b, and the pool's mean b is the ICAR anchor
 * (`prior.ts`). A requested stratum draws from that stratum's menu and keeps the draw only if its
 * v0 prior lands in the stratum. Every random number comes from the seeded `rng`.
 *
 * Generator 1.4.0 (M3.12) adds the hard rule families of `rules.ts` (`HARD_RULE_NAMES`), drawn only
 * when stratum 5 or 6 is requested; the natural pool and strata 1–4 draw as 1.3.0 did. The kept
 * 1.3.0 generator (`SERIES_LEGACY_FAMILIES`) is this code with the 1.3.0 fit set and menus.
 *
 * Generator 1.5.0 adds letter templates ({@link LETTER_TEMPLATES}): letter series whose key rule is
 * an integer family drawn on positions 1–26 (`rules.ts`, "Letter series of any family"), plus the
 * rule `letter` with steps of 5–12. They are drawn only for requested strata 2–6, a quarter of each
 * stratum's items ({@link LETTER_MENU_SHARE}); the natural pool and stratum 1 draw as 1.4.0,
 * and the kept 1.4.0 generator is this code with the 1.4.0 menus.
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import { seriesDifficulty, seriesExpectedTime, seriesFeatures } from './prior'
import {
  ALPHABET,
  CURRENT_FIT_SET,
  MAX_VISIBLE,
  MIN_VISIBLE,
  TERM_BOUND,
  analyse,
  inRuleDomain,
  isRuleName,
  keyConfirmations,
  mod,
  positionLetter,
  uniquenessChecks,
  allowsLetterRules,
  type Coefficients,
  type FitSet,
  type Op,
  type RuleName,
} from './rules'
import type { SeriesKey, SeriesSpec, SeriesStructure } from './types'

/** Strata generators 1.4.0 and 1.5.0 generate: 1–6 (the hard families of M3.12 reach strata 5 and 6). */
export const SERIES_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5, 6] as const)
/** Strata generator 1.3.0 generated (kept for its saved items). */
export const LEGACY_SERIES_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5] as const)

/** The strata of a generator version (its fit set). */
export function seriesStrataOf(fitSet: FitSet): readonly Stratum[] {
  return fitSet === '1.3.0' ? LEGACY_SERIES_STRATA : SERIES_STRATA
}

/**
 * The natural pool's key rule families (M1.P), when no stratum is requested: weights close to
 * the rule mix of the pre-1.3.0 stratum-first pool, drawn independently of b, so the pool's
 * feature means (`POOL_FEATURE_MEANS`) and hence its mean b do not depend on the prior.
 */
export const NATURAL_MENU: readonly (readonly [RuleName, number])[] = Object.freeze([
  ['arithmetic', 25],
  ['letter', 5],
  ['geometric', 4],
  ['quadratic', 12],
  ['interleaved', 10],
  ['fibonacci', 11],
  ['composite_alt', 23],
  ['composite_aff', 10],
] as const)

/**
 * The letter templates of generator 1.5.0: a rule family drawn on letter positions 1–26 (the
 * samplers {@link LETTER_SAMPLERS}). `letter_wide` is the rule `letter` with steps of 5–12 (it
 * wraps past Z or A); the others are letter series of an integer family (`letters: true`), every
 * position and the key in 1–26 without wrapping.
 */
export const LETTER_TEMPLATES = [
  'letter_wide',
  'letter_quadratic',
  'letter_interleaved',
  'letter_fibonacci',
  'letter_alt',
  'letter_cycle3',
] as const
export type LetterTemplate = (typeof LETTER_TEMPLATES)[number]
/** A menu entry: a rule family drawn as numbers (or `letter`), or a letter template (1.5.0). */
export type Template = RuleName | LetterTemplate

type Menu = readonly (readonly [Template, number])[]

/** Rule menu per stratum of generator 1.3.0 (weights); the prior decides whether a draw lands in the stratum. */
const LEGACY_MENUS: Readonly<Record<number, Menu>> = {
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

/**
 * Rule menus of generator 1.4.0: strata 1–4 as 1.3.0; stratum 5 adds the hard families to the
 * 1.3.0 menu (about half the draws), and stratum 6 draws only hard families (the 1.3.0 families
 * top out at b ≈ 2.0). `tribonacci` and `interleaved_ops` cannot reach b ≥ 2.5 under the v0
 * prior, and `diff_fibonacci` only at 5 terms of 4 digits, negative and descending, so stratum 6
 * draws `linear_rec`, `affine_index` and `cycle3`.
 */
const MENUS: Readonly<Record<number, Menu>> = {
  ...LEGACY_MENUS,
  5: [
    ...(LEGACY_MENUS[5] as Menu),
    ['tribonacci', 3],
    ['diff_fibonacci', 2],
    ['interleaved_ops', 3],
    ['linear_rec', 2],
    ['affine_index', 2],
    ['cycle3', 1],
  ],
  6: [
    ['linear_rec', 3],
    ['affine_index', 3],
    ['cycle3', 3],
  ],
}

/**
 * Share of the items of a requested stratum 2–6 that are letter templates in 1.5.0 ([SPEC] v0):
 * one item in four. The choice is made once per item, before its draws, so the share holds
 * whatever the acceptance rates of the two menus.
 */
export const LETTER_MENU_SHARE = 0.25

/**
 * Letter templates per requested stratum of 1.5.0 (weights): each where its v0 prior lands
 * (`prior.ts`). A letter item of stratum k draws only from this menu, the others from the 1.4.0 menu.
 * No ×2 strand (`interleaved_ops`) on letters: inside 1–26 a doubling strand shows at most three
 * terms (A B D), which a person may as well read as growing additions (A B D → G, not H); the
 * blind panel flagged it, so 1.5.0 never draws it.
 */
export const LETTER_MENUS: Readonly<Record<number, readonly (readonly [LetterTemplate, number])[]>> = Object.freeze({
  2: [
    ['letter_wide', 1],
    ['letter_quadratic', 1],
    ['letter_interleaved', 1],
    ['letter_fibonacci', 1],
  ],
  3: [
    ['letter_quadratic', 1],
    ['letter_alt', 1],
  ],
  4: [['letter_alt', 1]],
  5: [['letter_cycle3', 1]],
  6: [['letter_cycle3', 1]],
})

/** The stratum menus of a generator version (1.5.0: those of 1.4.0, and {@link LETTER_MENUS}). */
const menusOf = (fitSet: FitSet): Readonly<Record<number, Menu>> => (fitSet === '1.3.0' ? LEGACY_MENUS : MENUS)

/** Draws per item before giving up (never reached in the 10k property runs). */
export const MAX_ATTEMPTS = 20_000

/** A drawn series: its key rule and t_0 … t_m (visible terms, then the key; letters as positions). */
export interface Draft {
  readonly rule: RuleName
  readonly coefficients: Coefficients
  readonly values: readonly number[]
  /** A letter series of an integer family (1.5.0; `structural_params.letters`). */
  readonly letters?: true
}

/** Whether a draft is a letter series (the rule `letter`, or `letters: true`). */
export const isLetterDraft = (draft: Draft): boolean => draft.rule === 'letter' || draft.letters === true

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
  // Generator 1.4.0 (M3.12): the hard families, drawn only for requested strata 5 and 6.
  tribonacci(rng, m) {
    const c = rng.int(-4, 4)
    const [lo, hi] = rng.pick([[0, 6], [-8, 15], [-40, 90]] as const)
    const values = [rng.int(lo, hi), rng.int(lo, hi), rng.int(lo, hi)]
    while (values.length <= m) values.push(values.slice(-3).reduce((s, x) => s + x, 0) + c)
    return { rule: 'tribonacci', coefficients: { c }, values }
  },
  diff_fibonacci(rng, m) {
    const c = rng.pick([0, 0, 0, 1, -1, 2, -2])
    const diffs = [signed(rng, 1, 6, 0.35), signed(rng, 1, 9, 0.3)]
    while (diffs.length < m) diffs.push((diffs[diffs.length - 1] as number) + (diffs[diffs.length - 2] as number) + c)
    const t0 = rng.next() < 0.6 ? rng.int(-20, 40) : rng.int(-600, 2500)
    return { rule: 'diff_fibonacci', coefficients: { c }, values: run(t0, m, (i, t) => t + (diffs[i] as number)) }
  },
  interleaved_ops(rng, m) {
    const pattern = rng.pick(['mul_add', 'add_mul', 'mul_mul'] as const)
    const mul = (): number => rng.pick([2, 2, 3, -2, -3])
    const add = (): number => signed(rng, 1, 25, 0.35)
    const a: [Op, number] = pattern === 'add_mul' ? ['add', add()] : ['mul', mul()]
    const b: [Op, number] = pattern === 'mul_add' ? ['add', add()] : ['mul', mul()]
    const start = (op: Op): number => (op === 'mul' ? signed(rng, 1, rng.pick([5, 12, 40]), 0.25) : rng.int(-60, 400))
    const values = [start(a[0]), start(b[0])]
    while (values.length <= m) {
      const [op, x] = values.length % 2 === 0 ? a : b
      const prev = values[values.length - 2] as number
      values.push((op === 'add' ? prev + x : prev * x) + 0)
    }
    return { rule: 'interleaved_ops', coefficients: { op_a: a[0], by_a: a[1], op_b: b[0], by_b: b[1] }, values }
  },
  linear_rec(rng, m) {
    const a = rng.pick([1, 2, 3, -1, -2, -3, 0])
    const b = rng.pick([2, 3, -1, -2, -3, 1, 4])
    const big = rng.next() < 0.3
    const values = [signed(rng, 1, big ? 40 : 9, 0.25), signed(rng, 1, big ? 60 : 12, 0.25)]
    while (values.length <= m) values.push(a * (values[values.length - 1] as number) + b * (values[values.length - 2] as number) + 0)
    return { rule: 'linear_rec', coefficients: { a, b }, values }
  },
  affine_index(rng, m) {
    const k = rng.pick([2, 2, 3, -2, -1])
    const c = rng.int(-9, 9)
    const d = signed(rng, 1, 7, 0.35)
    const t0 = rng.next() < 0.7 ? signed(rng, 1, 12, 0.25) : signed(rng, 12, 150, 0.25)
    return { rule: 'affine_index', coefficients: { m: k, c, d }, values: run(t0, m, (i, t) => k * t + c + d * i) }
  },
  cycle3(rng, m) {
    const kinds = rng.pick([
      ['add', 'mul', 'add'],
      ['mul', 'add', 'add'],
      ['add', 'add', 'mul'],
      ['mul', 'mul', 'add'],
      ['mul', 'add', 'mul'],
      ['add', 'mul', 'mul'],
    ] as const)
    const ops = kinds.map((k): [Op, number] => (k === 'mul' ? ['mul', rng.pick([2, 2, 3, -2, -1])] : ['add', signed(rng, 1, 15, 0.4)]))
    const t0 = signed(rng, 1, rng.pick([6, 12, 30]), 0.2)
    const [[opA, xA], [opB, xB], [opC, xC]] = ops as [[Op, number], [Op, number], [Op, number]]
    const values = run(t0, m, (i, t) => {
      const [op, x] = ops[i % 3] as [Op, number]
      return op === 'add' ? t + x : t * x
    })
    return { rule: 'cycle3', coefficients: { op_a: opA, by_a: xA, op_b: opB, by_b: xB, op_c: opC, by_c: xC }, values }
  },
}

const inAlphabet = (v: readonly number[]): boolean => v.every((p) => p >= 1 && p <= ALPHABET)

/** Redraws per letter template before it gives up and returns its last (out-of-range) draw. */
const LETTER_REDRAWS = 200

/**
 * Positions p0 + offsets[i] for a start drawn so that all lie in 1–26, or null when the offsets
 * span more than the alphabet.
 */
function place(rng: Rng, offsets: readonly number[]): number[] | null {
  const lo = Math.min(...offsets)
  const hi = Math.max(...offsets)
  if (hi - lo > ALPHABET - 1) return null
  const p0 = rng.int(1 - lo, ALPHABET - hi)
  return offsets.map((o) => p0 + o)
}

/** Draws `draw` until it gives a draft inside the alphabet (at most {@link LETTER_REDRAWS} times). */
function redraw(draw: () => Draft | null): Draft {
  let last: Draft | null = null
  for (let i = 0; i < LETTER_REDRAWS; i++) {
    const d = draw()
    if (d !== null && inAlphabet(d.values)) return d
    last = d ?? last
  }
  return last ?? { rule: 'letter', coefficients: { d: 0 }, values: [0, 0, 0, 0, 0, 0] }
}

/** Terms 0 … m of t_{i+1} = op_{i mod k}(t_i), the k ops (+x or ×x) taken in turn. */
const runOps = (t0: number, m: number, ops: readonly (readonly [Op, number])[]): number[] =>
  run(t0, m, (i, t) => {
    const [op, x] = ops[i % ops.length] as readonly [Op, number]
    return op === 'add' ? t + x : t * x
  })

/**
 * Samplers of the letter templates (generator 1.5.0): each draws its own number of terms and a
 * series on positions 1–26 (redrawing until every position and the key are in range).
 */
const LETTER_SAMPLERS: Readonly<Record<LetterTemplate, (rng: Rng) => Draft>> = {
  letter_wide(rng) {
    const m = rng.int(MIN_VISIBLE, MAX_VISIBLE)
    const d = signed(rng, 5, 12, 0.45)
    const p0 = rng.int(1, ALPHABET)
    return { rule: 'letter', coefficients: { d }, values: run(p0, m, (_, p) => mod(p - 1 + d, ALPHABET) + 1) }
  },
  letter_quadratic(rng) {
    const m = rng.int(MIN_VISIBLE, MAX_VISIBLE)
    return redraw(() => {
      const s = signed(rng, 1, 3, 0.3)
      const d0 = rng.int(-4, 5)
      const values = place(rng, run(0, m, (i, t) => t + d0 + i * s))
      return values && { rule: 'quadratic', coefficients: { s }, values, letters: true }
    })
  },
  letter_interleaved(rng) {
    const m = rng.int(minVisibleFor('interleaved'), MAX_VISIBLE)
    return redraw(() => {
      const da = signed(rng, 1, 5, 0.4)
      const db = signed(rng, 1, 5, 0.5)
      const a = place(rng, Array.from({ length: Math.floor(m / 2) + 1 }, (_, j) => j * da))
      const b = place(rng, Array.from({ length: Math.floor((m + 1) / 2) }, (_, j) => j * db))
      if (!a || !b) return null
      const values = Array.from({ length: m + 1 }, (_, i) => (i % 2 === 0 ? a[i / 2] : b[(i - 1) / 2]) as number)
      return { rule: 'interleaved', coefficients: { da, db }, values, letters: true }
    })
  },
  letter_fibonacci(rng) {
    const m = rng.int(MIN_VISIBLE, MAX_VISIBLE)
    return redraw(() => {
      const c = rng.pick([-1, 0, 0, 1, 1, 2])
      const values = [rng.int(1, 6), rng.int(1, 6)]
      while (values.length <= m) values.push((values[values.length - 1] as number) + (values[values.length - 2] as number) + c)
      return { rule: 'fibonacci', coefficients: { c }, values, letters: true }
    })
  },
  letter_alt(rng) {
    const m = rng.int(minVisibleFor('composite_alt'), MAX_VISIBLE)
    return redraw(() => {
      const xa = signed(rng, 1, 7, 0.4)
      let xb = signed(rng, 1, 7, 0.5)
      while (xb === xa) xb = signed(rng, 1, 7, 0.5)
      const values = place(rng, runOps(0, m, [['add', xa], ['add', xb]]))
      return values && { rule: 'composite_alt', coefficients: { op_a: 'add', by_a: xa, op_b: 'add', by_b: xb }, values, letters: true }
    })
  },
  letter_cycle3(rng) {
    const m = rng.int(minVisibleFor('cycle3'), MAX_VISIBLE)
    return redraw(() => {
      // The blank (term 8) comes from the first op, so it is a +x: a ×2 seen on two steps of
      // small letters could also be read as growing additions (blind panel, series 1.5.0).
      const kinds = rng.pick([
        ['add', 'add', 'mul'],
        ['add', 'mul', 'add'],
      ] as const)
      const ops = kinds.map((k): [Op, number] => (k === 'mul' ? ['mul', rng.pick([2, 2, 2, 3])] : ['add', signed(rng, 1, 12, 0.55)]))
      const values = runOps(rng.int(1, 12), m, ops)
      const [[opA, xA], [opB, xB], [opC, xC]] = ops as [[Op, number], [Op, number], [Op, number]]
      return { rule: 'cycle3', coefficients: { op_a: opA, by_a: xA, op_b: opB, by_b: xB, op_c: opC, by_c: xC }, values, letters: true }
    })
  },
}

/** Draw one series of a menu entry: a rule family as numbers (as {@link sampleDraft}) or a letter template. */
export function sampleTemplate(rng: Rng, template: Template): Draft {
  return template in LETTER_SAMPLERS ? LETTER_SAMPLERS[template as LetterTemplate](rng) : sampleDraft(rng, template as RuleName)
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
  if (isLetterDraft(draft)) {
    return { spec: { input_format: 'letter', terms: visible.map(positionLetter) }, key: { letter: positionLetter(next) } }
  }
  return { spec: { input_format: 'integer', terms: visible }, key: { value: String(next), tol: { abs: 0 } } }
}

/**
 * Whether a draft is in bounds, in its rule's domain and unique under the analysis of `fitSet`
 * (its generator version) with its own rule as key. A letter series of an integer family
 * (`letters`, 1.5.0 only) keeps every position and the key in 1–26.
 */
export function acceptDraft(draft: Draft, fitSet: FitSet = CURRENT_FIT_SET): boolean {
  if (!draft.values.every((x) => Number.isSafeInteger(x) && Math.abs(x) <= TERM_BOUND)) return false
  if (!isRuleName(draft.rule, fitSet) || !inRuleDomain(draft.rule, draft.coefficients)) return false
  if (draft.letters !== undefined && (draft.letters !== true || !allowsLetterRules(fitSet) || draft.rule === 'letter' || !inAlphabet(draft.values))) return false
  const m = draft.values.length - 1
  const analysis = analyse(draft.values.slice(0, m), isLetterDraft(draft), fitSet)
  const checks = uniquenessChecks(analysis, draft, draft.values[m] as number)
  return Object.values(checks).every((v) => v !== false)
}

/**
 * `build()` of the series family (see `defineFamily`) for the generator version `fitSet`. Without a
 * requested stratum, and for strata 1–4, 1.3.0 and 1.4.0 take the same draws; they differ in the
 * fit set of the analysis (1.4.0 lets the hard families compete, which rejects a few natural
 * draws 1.3.0 kept) and in the menus of strata 5 and 6. 1.5.0 has the fit set of 1.4.0, so its
 * natural pool and stratum 1 are those of 1.4.0; its menus of strata 2–6 add letter templates.
 */
export function buildSeries(rng: Rng, ctx: BuildContext, fitSet: FitSet = CURRENT_FIT_SET): BuiltItem<SeriesSpec, SeriesKey> {
  const requested = ctx.stratum
  const strata = seriesStrataOf(fitSet)
  let menu: Menu | undefined = requested === undefined ? NATURAL_MENU : menusOf(fitSet)[requested]
  if (!menu) throw new RangeError(`series cannot generate stratum ${String(requested)}`)
  // 1.5.0: one item in four of a requested stratum 2–6 is a letter template (decided once, first).
  const letterMenu = requested !== undefined && allowsLetterRules(fitSet) ? LETTER_MENUS[requested] : undefined
  if (letterMenu && rng.next() < LETTER_MENU_SHARE) menu = letterMenu
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const draft = sampleTemplate(rng, weighted(rng, menu))
    if (!draft.values.every((x) => Number.isSafeInteger(x) && Math.abs(x) <= TERM_BOUND)) continue
    const features = seriesFeatures(draft.rule, draft.coefficients, draft.values, isLetterDraft(draft))
    const difficulty = seriesDifficulty(features)
    const stratum = stratumOfB(difficulty.b_prior)
    if ((requested === undefined ? !strata.includes(stratum) : stratum !== requested) || !acceptDraft(draft, fitSet)) continue
    const structure: SeriesStructure = { rule: draft.rule, coefficients: draft.coefficients }
    const structuralParams = draft.letters ? { ...structure, coefficients: { ...structure.coefficients }, letters: true } : { rule: structure.rule, coefficients: { ...structure.coefficients } }
    return {
      stratum,
      ...renderDraft(draft),
      structural_params: structuralParams,
      difficulty,
      expected_time_s: seriesExpectedTime(features),
    }
  }
  throw new Error(`series: no valid item for stratum ${String(requested)} after ${MAX_ATTEMPTS} draws`)
}
