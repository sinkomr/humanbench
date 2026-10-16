/**
 * Matrices generator (DESIGN §4.2 "Matrices", §14.6 example 1; ROADMAP M1.6, A1, A11).
 *
 * 1. Pick the rule set once per item: without a requested stratum uniformly among all 1,655
 *    (the natural pool, whose mean b is the ICAR anchor, M1.P; the stratum is the band of its b),
 *    else uniformly among those whose v0 prior falls in the requested stratum (`prior.ts`); steps
 *    2–5 retry with that rule set, so the draw is not weighted by its acceptance rate.
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
 * Hard strata 5 and 6 (generator 1.3.0, M3.12), only when one of them is requested: the rule
 * set comes from the hard templates (`grammar.ts` {@link isHardRuleSet}: all five attributes
 * ruled, or an outer frame with its own rules), the grid is sampled the same way (the frame's
 * shade and pattern like any scalar), the solver check also covers the frame, and the
 * distractors are **single-rule lures** ({@link lureOptions}): each option is grown from an
 * existing one by setting one *ruled* attribute to a value a plausible wrong rule gives for the
 * missing cell ({@link lureValues}: the right rule applied in the wrong row or column, a
 * neighbour copied, a progression overshot or read down the third column, the other set or
 * count operation). So a distractor differs from the key in 1–3 ruled attributes (mostly one or
 * two), each by a lure value, and two distractors often differ from each other in two only. Gates:
 * the modal picker and the hub picker (`heuristic.ts`) must not single out the key; a tree that
 * fails is regrown up to {@link HARD_TREE_TRIES} times on the same grid. Every other draw path
 * (the natural pool, strata 1–4) is the 1.2.0 code unchanged, so generator 1.2.0 is this code
 * with its version string and strata 1–4 (`index.ts` MATRICES_LEGACY_FAMILIES).
 *
 * Every random draw comes from the seeded `rng` (A11: `generate(item.seed)` rebuilds the item).
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import { stratumOfB } from '../priors'
import {
  CANONICAL_LAYOUTS,
  COMPONENTS,
  DOMAIN_SIZE,
  FRAME_DOMAIN_SIZE,
  componentValue,
  differingComponents,
  isHardRuleSet,
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
  type InnerComponent,
  type MatrixKey,
  type MatrixSpec,
  type PositionRule,
  type RuleSet,
  type ScalarRule,
} from './grammar'
import { hubPicksKeyUniquely, modalPicksKeyUniquely } from './heuristic'
import {
  ALL_RULE_SETS,
  RULE_SETS_BY_STRATUM,
  SIGMA_B_DEFAULT,
  bPriorOf,
  expectedTimeOfFeatures,
  featuresOf,
  provenanceOf,
} from './prior'
import { solve } from './solver'

/** Grids tried per item (all with the item's rule set) before giving up. */
export const MAX_GRID_ATTEMPTS = 2_000
/** Option-growing steps per distractor tree before it is abandoned. */
export const MAX_TREE_STEPS = 200
/** Lure trees tried per accepted hard grid before a new grid is drawn (M3.12). */
export const HARD_TREE_TRIES = 8
/**
 * Most ruled components a hard distractor differs from the key in (M3.12). With 1 the key would be
 * the hub of a star; with 3 about 43% of distractors are one lure from the key, 45% two and 12%
 * three, and both option-only pickers stay below chance (≈ 12% against 1/6).
 */
export const MAX_LURE_CHANGES = 3

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
function mutate(rng: Rng, parent: Cell, comp: InnerComponent, visible: readonly Cell[], countMode: boolean): Cell | null {
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


// --- hard templates (M3.12) ------------------------------------------------------------------------

/** The full grid of a rule set (9 cells, the 9th the key): the inner grid, then the frame if the set has one. */
export function sampleHardGrid(rng: Rng, rules: RuleSet): Cell[] {
  const grid = sampleGrid(rng, rules)
  if (rules.frame_shade === undefined || rules.frame_pattern === undefined) return grid
  const shade = sampleScalar(rng, rules.frame_shade, FRAME_DOMAIN_SIZE.frameShade)
  const pattern = sampleScalar(rng, rules.frame_pattern, FRAME_DOMAIN_SIZE.framePattern)
  return grid.map((c, i) => ({ ...c, frameShade: shade[i] as number, framePattern: pattern[i] as number }))
}

/** The components a rule set rules (non-constant), in {@link Component} order: what hard distractors may change. */
export function ruledComponents(rules: RuleSet): Component[] {
  const out: Component[] = []
  for (const a of SCALAR_ATTRS) if (rules[a] !== 'constant') out.push(a)
  if (rules.position !== 'canonical' || rules.count !== 'constant') out.push('positions')
  if (rules.frame_shade !== undefined && rules.frame_shade !== 'constant') out.push('frameShade')
  if (rules.frame_pattern !== undefined && rules.frame_pattern !== 'constant') out.push('framePattern')
  return out
}

const ruleOf = (rules: RuleSet, comp: Exclude<Component, 'positions'>): ScalarRule | undefined =>
  comp === 'frameShade' ? rules.frame_shade : comp === 'framePattern' ? rules.frame_pattern : rules[comp]

const domainOf = (comp: Exclude<Component, 'positions'>): number =>
  comp === 'frameShade' || comp === 'framePattern' ? FRAME_DOMAIN_SIZE[comp] : DOMAIN_SIZE[comp]

/**
 * Lure values of one ruled component for the missing cell (M3.12), ascending, never the key's:
 * - a scalar or frame attribute: the values of the third column's visible cells (the right rule's
 *   answer in rows 1 and 2) and of the bottom row's two cells (a neighbour copied; for a
 *   progression also the progression run the wrong way); for a progression with step d also
 *   key + d (overshot) and 2·v₅ − v₂ (the third column read as a progression), inside the domain;
 * - the layout in count mode: the counts of those four cells, a + b and a − b of the bottom row
 *   (the other arithmetic), and key ± 1, within 1–4, as canonical layouts;
 * - the layout in position mode: those four cells' slot sets and a △ b, a ∪ b, a ∩ b, a ∖ b, b ∖ a
 *   of the bottom row (the other set operations), with 1–4 objects.
 * If that leaves nothing, every other value of the component (count mode: counts 1–4; position
 * mode: one slot toggled) is a lure. The verifier recomputes this set (`distractors_are_lures`).
 */
export function lureValues(comp: Component, key: Cell, visible: readonly Cell[], rules: RuleSet): number[] {
  const at = (i: number): Cell => visible[i] as Cell
  const k = componentValue(key, comp)
  const finish = (xs: Iterable<number>, ok: (x: number) => boolean): number[] =>
    [...new Set(xs)].filter((x) => x !== k && ok(x)).sort((a, b) => a - b)
  if (comp !== 'positions') {
    const n = domainOf(comp)
    const v = [2, 5, 6, 7].map((i) => componentValue(at(i), comp))
    const rule = ruleOf(rules, comp)
    const extra: number[] = []
    if (rule === 'progression+1' || rule === 'progression-1') {
      const d = rule === 'progression+1' ? 1 : -1
      extra.push(k + d, 2 * (v[1] as number) - (v[0] as number))
    }
    const inDomain = (x: number): boolean => Number.isInteger(x) && x >= 0 && x < n
    const out = finish([...v, ...extra], inDomain)
    return out.length > 0 ? out : finish(range(n), inDomain)
  }
  if (rules.position === 'canonical') {
    const c = [2, 5, 6, 7].map((i) => popcount(at(i).positions))
    const kc = popcount(key.positions)
    const [a, b] = [c[2] as number, c[3] as number]
    const counts = [...new Set([...c, a + b, a - b, kc + 1, kc - 1])].filter((x) => x !== kc && x >= 1 && x <= MAX_COUNT)
    const pool = counts.length > 0 ? counts : range(MAX_COUNT, 1).filter((x) => x !== kc)
    return finish(pool.map(canonicalMask), () => true)
  }
  const [a, b] = [at(6).positions, at(7).positions]
  const okSet = (m: number): boolean => m !== 0 && popcount(m) <= MAX_COUNT
  const sets = [at(2).positions, at(5).positions, a, b, a ^ b, a | b, a & b, a & ~b, b & ~a]
  const out = finish(sets, okSet)
  return out.length > 0 ? out : finish(range(SLOT_COUNT).map((s) => key.positions ^ (1 << s)), okSet)
}

/** A copy of `c` with one component set to `v`. */
export function withComponent(c: Cell, comp: Component, v: number): Cell {
  return { ...c, [comp]: v }
}

/**
 * Single-rule lure options (M3.12): `[key, …5 distractors]` in creation order, or null if
 * {@link MAX_TREE_STEPS} draws did not give 6 distinct options. Each step picks the key or a
 * distractor fewer than {@link MAX_LURE_CHANGES} changes from it, and a ruled component, and sets
 * that component to another of the key's {@link lureValues} for it; so every distractor differs
 * from the key in 1–3 ruled components, each holding a lure value.
 */
export function lureOptions(rng: Rng, key: Cell, visible: readonly Cell[], rules: RuleSet): Cell[] | null {
  const comps = ruledComponents(rules)
  const lures = new Map(comps.map((c) => [c, lureValues(c, key, visible, rules)]))
  const opts: Cell[] = [key]
  /** The options fewer than MAX_LURE_CHANGES changes from the key: the parents, so no distractor is further. */
  const parents: Cell[] = [key]
  for (let step = 0; opts.length < OPTIONS_COUNT; step++) {
    if (step >= MAX_TREE_STEPS) return null
    const parent = rng.pick(parents)
    const comp = rng.pick(comps)
    const pool = (lures.get(comp) as number[]).filter((v) => v !== componentValue(parent, comp))
    if (pool.length === 0) continue
    const child = withComponent(parent, comp, rng.pick(pool))
    if (opts.some((o) => cellEquals(o, child))) continue
    opts.push(child)
    if (differingComponents(child, key).length < MAX_LURE_CHANGES) parents.push(child)
  }
  return opts
}

/**
 * Steps 2–5 for a hard rule set: the first grid the solver completes uniquely with its key whose
 * lure tree neither option-only picker solves (up to {@link HARD_TREE_TRIES} trees per grid), or
 * null after {@link MAX_GRID_ATTEMPTS} grids.
 */
export function sampleAcceptedHard(rng: Rng, rules: RuleSet): AcceptedSample | null {
  for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
    const grid = sampleHardGrid(rng, rules)
    const visible = grid.slice(0, 8)
    const key = grid[8] as Cell
    const sol = solve(visible)
    if (!sol.cell || !cellEquals(sol.cell, key)) continue
    for (let t = 0; t < HARD_TREE_TRIES; t++) {
      const tree = lureOptions(rng, key, visible, rules)
      if (!tree) break
      if (modalPicksKeyUniquely(tree, 0) || hubPicksKeyUniquely(tree, 0)) continue
      return { visible, tree }
    }
  }
  return null
}

/** `build()` of the matrices family (see the module comment). */
export function buildMatrix(rng: Rng, ctx: BuildContext): BuiltItem<MatrixSpec, MatrixKey> {
  let rules: RuleSet
  if (ctx.stratum === undefined) {
    rules = rng.pick(ALL_RULE_SETS)
  } else {
    const pool = RULE_SETS_BY_STRATUM.get(ctx.stratum)
    if (!pool) throw new RangeError(`matrices cannot generate stratum ${ctx.stratum}`)
    rules = rng.pick(pool)
  }
  const stratum = stratumOfB(bPriorOf(featuresOf(rules)))
  const hard = isHardRuleSet(rules)
  const sample = hard ? sampleAcceptedHard(rng, rules) : sampleAccepted(rng, rules)
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
    difficulty: { features: { ...features }, b_prior: bPriorOf(features), sd_prior: SIGMA_B_DEFAULT, provenance: provenanceOf(features) },
    expected_time_s: expectedTimeOfFeatures(features),
  }
}
