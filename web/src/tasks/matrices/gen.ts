/**
 * Matrices generator (DESIGN §4.2 "Matrices", §14.6 example 1; ROADMAP M1.6, A1, A11).
 *
 * 1. Pick the stratum (requested, else uniform over {@link MATRIX_STRATA}) and, once per item, a
 *    rule set uniformly among those whose v0 prior falls in it (`prior.ts`); steps 2–5 retry with
 *    that rule set, so the draw is not weighted by a rule set's acceptance rate.
 * 2. Sample the full 3×3 grid row by row from the rules (`grammar.ts`): constant rows take a
 *    random value per row, progressions a random valid start per row, distributions a Latin
 *    square over 3 random values, count arithmetic a random (x, y) per row, xor/or random slot
 *    sets per row, every cell with 1–4 objects ({@link MAX_COUNT}). The 9th cell is the key.
 * 3. Accept the grid only if the solver (`solver.ts`) finds a unique 9th cell equal to the key.
 * 4. Distractors, RAVEN-FAIR style (Benny et al. 2021): start from {key}; repeatedly pick a random
 *    existing option and change one component (shape, size, color, orientation, or layout: a new
 *    canonical count in count mode, one slot toggled in position mode, staying within 1–4
 *    objects), preferring values that occur in the visible grid; keep the child if it is new.
 *    This builds a tree of one-change edges rooted at the key, so the key is not the answer every
 *    distractor is "one off" from.
 * 5. Reject the option set if the modal-attribute picker (`heuristic.ts`) picks the key uniquely;
 *    then shuffle the options.
 *
 * Every random draw comes from the seeded `rng` (A11: `generate(item.seed)` rebuilds the item).
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import {
  CANONICAL_LAYOUTS,
  COMPONENTS,
  DOMAIN_SIZE,
  MAX_COUNT,
  OPTIONS_COUNT,
  SCALAR_ATTRS,
  SLOT_COUNT,
  canonicalMask,
  cellEquals,
  popcount,
  structuralParamsOf,
  toSpecCell,
  type Cell,
  type Component,
  type CountRule,
  type MatrixKey,
  type MatrixSpec,
  type PositionRule,
  type RuleSet,
  type ScalarRule,
} from './grammar'
import { modalPicksKeyUniquely } from './heuristic'
import {
  MATRIX_PROVENANCE,
  MATRIX_STRATA,
  RULE_SETS_BY_STRATUM,
  SIGMA_B_DEFAULT,
  TIME_LIMIT_S,
  bPriorOf,
  expectedTimeOf,
  featuresOf,
} from './prior'
import { solve } from './solver'

/** Grids tried per item (all with the item's rule set) before giving up. */
export const MAX_GRID_ATTEMPTS = 2_000
/** Option-growing steps per distractor tree before it is abandoned. */
export const MAX_TREE_STEPS = 200

const range = (n: number, from = 0): number[] => Array.from({ length: n }, (_, i) => from + i)

/** Nine values in a Latin square over `values` (3 distinct): each row and column is a permutation. */
function latinSquare(rng: Rng, values: readonly number[]): number[] {
  const s = rng.shuffle(values)
  const shift = rng.pick([1, 2])
  return range(9).map((i) => s[(Math.floor(i / 3) * shift + (i % 3)) % 3] as number)
}

function rowsOf(row: () => readonly number[]): number[] {
  return [...row(), ...row(), ...row()]
}

/** Nine values of a scalar attribute following `rule` along the rows. */
export function sampleScalar(rng: Rng, rule: ScalarRule, n: number): number[] {
  switch (rule) {
    case 'constant':
      return rowsOf(() => {
        const v = rng.int(0, n - 1)
        return [v, v, v]
      })
    case 'progression+1':
    case 'progression-1': {
      const d = rule === 'progression+1' ? 1 : -1
      return rowsOf(() => {
        const s = d > 0 ? rng.int(0, n - 3) : rng.int(2, n - 1)
        return [s, s + d, s + 2 * d]
      })
    }
    case 'distribution':
      return latinSquare(rng, rng.shuffle(range(n)).slice(0, 3))
  }
}

const ADD_PAIRS: readonly (readonly [number, number])[] = range(MAX_COUNT, 1).flatMap((x) =>
  range(MAX_COUNT, 1).flatMap((y) => (x + y <= MAX_COUNT ? [[x, y] as const] : [])),
)
const SUB_PAIRS: readonly (readonly [number, number])[] = range(MAX_COUNT, 1).flatMap((x) =>
  range(MAX_COUNT, 1).flatMap((y) => (x - y >= 1 ? [[x, y] as const] : [])),
)

/** Nine counts (1–4) following a count-mode rule along the rows. */
export function sampleCounts(rng: Rng, rule: Exclude<CountRule, 'derived'>): number[] {
  switch (rule) {
    case 'constant':
      return rowsOf(() => {
        const c = rng.int(1, MAX_COUNT)
        return [c, c, c]
      })
    case 'progression+1':
    case 'progression-1': {
      const d = rule === 'progression+1' ? 1 : -1
      return rowsOf(() => {
        const s = d > 0 ? rng.int(1, MAX_COUNT - 2) : rng.int(3, MAX_COUNT)
        return [s, s + d, s + 2 * d]
      })
    }
    case 'arithmetic+':
    case 'arithmetic-': {
      const sign = rule === 'arithmetic+' ? 1 : -1
      return rowsOf(() => {
        const [x, y] = rng.pick(sign > 0 ? ADD_PAIRS : SUB_PAIRS)
        return [x, y, x + sign * y]
      })
    }
    case 'distribution':
      return latinSquare(rng, rng.shuffle(range(MAX_COUNT, 1)).slice(0, 3))
  }
}

/** A random slot set of 1–4 objects. */
function randomSet(rng: Rng): number {
  const k = rng.int(1, MAX_COUNT)
  let m = 0
  for (const s of rng.shuffle(range(SLOT_COUNT)).slice(0, k)) m |= 1 << s
  return m
}

/** Nine slot sets following a position-mode rule along the rows. */
export function samplePositions(rng: Rng, rule: Exclude<PositionRule, 'canonical'>): number[] {
  if (rule === 'distribution') {
    const sets: number[] = []
    while (sets.length < 3) {
      const s = randomSet(rng)
      if (!sets.includes(s)) sets.push(s)
    }
    return latinSquare(rng, sets)
  }
  const op = rule === 'xor' ? (x: number, y: number) => x ^ y : (x: number, y: number) => x | y
  return rowsOf(() => {
    for (;;) {
      const x = randomSet(rng)
      const y = randomSet(rng)
      const z = op(x, y)
      if (x !== y && popcount(z) <= MAX_COUNT) return [x, y, z]
    }
  })
}

/** The full grid (9 cells, row-major; the 9th is the key) for a rule set. */
export function sampleGrid(rng: Rng, rules: RuleSet): Cell[] {
  const [shape, size, color, orientation] = SCALAR_ATTRS.map((a) => sampleScalar(rng, rules[a], DOMAIN_SIZE[a])) as [
    number[],
    number[],
    number[],
    number[],
  ]
  const positions =
    rules.position === 'canonical'
      ? sampleCounts(rng, rules.count as Exclude<CountRule, 'derived'>).map(canonicalMask)
      : samplePositions(rng, rules.position)
  return range(9).map((i) => ({
    shape: shape[i] as number,
    size: size[i] as number,
    color: color[i] as number,
    orientation: orientation[i] as number,
    positions: positions[i] as number,
  }))
}

/** Distinct values, ascending. */
const distinctSorted = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => a - b)

/** A child of `parent` with one component changed, or null if this draw gives none. */
function mutate(rng: Rng, parent: Cell, comp: Component, visible: readonly Cell[], countMode: boolean): Cell | null {
  if (comp === 'positions') {
    if (countMode) {
      const n = popcount(parent.positions)
      const seen = distinctSorted(visible.map((c) => popcount(c.positions))).filter((x) => x !== n)
      const pool = seen.length > 0 ? seen : range(CANONICAL_LAYOUTS.length, 1).filter((x) => x !== n)
      return { ...parent, positions: canonicalMask(rng.pick(pool)) }
    }
    const m = parent.positions ^ (1 << rng.int(0, SLOT_COUNT - 1))
    return m === 0 || popcount(m) > MAX_COUNT ? null : { ...parent, positions: m }
  }
  const v = parent[comp]
  const seen = distinctSorted(visible.map((c) => c[comp])).filter((x) => x !== v)
  const pool = seen.length > 0 ? seen : range(DOMAIN_SIZE[comp]).filter((x) => x !== v)
  return { ...parent, [comp]: rng.pick(pool) }
}

/**
 * RAVEN-FAIR option tree: `[key, …5 distractors]` in creation order (the key first), or null if
 * {@link MAX_TREE_STEPS} draws did not give 6 distinct options.
 */
export function fairOptions(rng: Rng, key: Cell, visible: readonly Cell[], countMode: boolean): Cell[] | null {
  const opts: Cell[] = [key]
  for (let step = 0; opts.length < OPTIONS_COUNT; step++) {
    if (step >= MAX_TREE_STEPS) return null
    const child = mutate(rng, rng.pick(opts), rng.pick(COMPONENTS), visible, countMode)
    if (child !== null && !opts.some((o) => cellEquals(o, child))) opts.push(child)
  }
  return opts
}

/** An accepted grid (8 visible cells and the key) and its option tree (key first). */
export interface AcceptedSample {
  readonly visible: readonly Cell[]
  readonly tree: readonly Cell[]
}

/**
 * Steps 2–5 for a fixed rule set: the first grid and option tree that pass the solver and the
 * modal-picker gate, or null after {@link MAX_GRID_ATTEMPTS} grids.
 */
export function sampleAccepted(rng: Rng, rules: RuleSet): AcceptedSample | null {
  for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
    const grid = sampleGrid(rng, rules)
    const visible = grid.slice(0, 8)
    const key = grid[8] as Cell
    const sol = solve(visible)
    if (!sol.cell || !cellEquals(sol.cell, key)) continue
    const tree = fairOptions(rng, key, visible, rules.position === 'canonical')
    if (!tree || modalPicksKeyUniquely(tree, 0)) continue
    return { visible, tree }
  }
  return null
}

/** `build()` of the matrices family (see the module comment). */
export function buildMatrix(rng: Rng, ctx: BuildContext): BuiltItem<MatrixSpec, MatrixKey> {
  const stratum = ctx.stratum ?? rng.pick(MATRIX_STRATA)
  const pool = RULE_SETS_BY_STRATUM.get(stratum)
  if (!pool) throw new RangeError(`matrices cannot generate stratum ${stratum}`)
  const rules = rng.pick(pool)
  const sample = sampleAccepted(rng, rules)
  if (!sample) throw new Error(`matrices: no valid item in ${MAX_GRID_ATTEMPTS} attempts (seed ${ctx.seed})`)
  const { visible, tree } = sample
  const order = rng.shuffle(range(OPTIONS_COUNT))
  const features = featuresOf(rules)
  const spec: MatrixSpec = {
    grid: [visible.slice(0, 3), visible.slice(3, 6), visible.slice(6, 8)].map((row) => row.map(toSpecCell)),
    options: order.map((i) => toSpecCell(tree[i] as Cell)),
  }
  return {
    stratum,
    spec,
    key: { index: order.indexOf(0) },
    structural_params: structuralParamsOf(rules),
    options_count: OPTIONS_COUNT,
    difficulty: { features: { ...features }, b_prior: bPriorOf(features), sd_prior: SIGMA_B_DEFAULT, provenance: MATRIX_PROVENANCE },
    expected_time_s: expectedTimeOf(features.n_rules),
    time_limit_s: TIME_LIMIT_S,
  }
}
