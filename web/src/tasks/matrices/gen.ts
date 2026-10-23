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
 * Directions and diagonals (generator 1.4.0), only when a stratum 2–6 is requested: one draw in
 * three ({@link TEMPLATE_ODDS}) takes a template instead (`prior.ts` {@link templateCodes}): the
 * kind uniformly among column, mixed and diagonal (those with candidates in the stratum), then a
 * candidate uniformly. The grid is the 1.3.0 grid of the set's base ({@link sampleTemplateGrid}):
 * a group ruled down the columns is mirrored across the main diagonal (the missing cell is its own
 * mirror), and a diagonal attribute takes five values, one per diagonal, neighbours different. It
 * is accepted when the 1.4.0 solver (diagonals included) completes it uniquely with its key and
 * the direction is needed ({@link directionsNeeded}: some column-ruled attribute fits no row rule,
 * and for a mixed set also some row-ruled one no column rule; every diagonal attribute fits no
 * row or column rule), and no ruled attribute has a second reading ({@link noSecondReading}). Distractors:
 * lures (as for the hard sets, with the lures read in the declared direction and, for a diagonal, the values a row or column reading gives) for a hard or
 * diagonal set, else the 1.2.0 one-change tree. Stratum 1, the natural pool and generator 1.3.0
 * draw exactly as before ({@link buildMatrix} with the version).
 *
 * Every random draw comes from the seeded `rng` (A11: `generate(item.seed)` rebuilds the item).
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import {
  CANONICAL_LAYOUTS,
  COMPONENTS,
  DIAGONAL_RULE,
  baseRuleSet,
  diagonalAttrs,
  diagonalOf,
  directionOf,
  groupOf,
  groupsOf,
  isTemplateRuleSet,
  transposeIndex,
  type DirectionGroup,
  type LineDirection,
  type ScalarAttr,
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
  TEMPLATE_KINDS,
  directionKind,
  sensitiveGroups,
  templateCodes,
  templateRulesOf,
  bPriorOf,
  expectedTimeOfFeatures,
  featuresOf,
  provenanceOf,
} from './prior'
import { DIAGONAL_FIT, solve, type Solution } from './solver'

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
  const [shape, size, color, orientation] = SCALAR_ATTRS.map((a) => sampleScalar(rng, rules[a] as ScalarRule, DOMAIN_SIZE[a])) as [
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
 * modal-picker gate, or null after {@link MAX_GRID_ATTEMPTS} grids. `diagonal`: solve with the
 * 1.4.0 analysis (diagonal rule included), which accepts exactly the same row grids (`solver.ts`).
 */
export function sampleAccepted(rng: Rng, rules: RuleSet, diagonal = false): AcceptedSample | null {
  for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
    const grid = sampleGrid(rng, rules)
    const visible = grid.slice(0, 8)
    const key = grid[8] as Cell
    const sol = solve(visible, diagonal)
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

const ruleOf = (rules: RuleSet, comp: Exclude<Component, 'positions'>): string | undefined =>
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
  if (comp !== 'positions' && isDiagonalComp(rules, comp)) return diagonalLureValues(comp, key, visible)
  // A column-ruled component: the same lures read on the mirrored grid (rows ↔ columns, 1.4.0).
  if (directionOf(rules, groupOf(comp)) === 'col') visible = transposeVisible(visible)
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

/** The 8 visible cells mirrored across the main diagonal (row-major; the missing 9th is its own mirror). */
export function transposeVisible(visible: readonly Cell[]): Cell[] {
  return range(8).map((i) => visible[transposeIndex(i)] as Cell)
}

const isDiagonalComp = (rules: RuleSet, comp: Component): comp is ScalarAttr =>
  (comp === 'shape' || comp === 'size' || comp === 'color' || comp === 'orientation') && rules[comp] === DIAGONAL_RULE

/**
 * Lure values of a diagonal attribute (1.4.0), ascending, never the key's: the values of the
 * missing cell's four neighbours (cells 2, 5, 6, 7: a row or column neighbour copied) and the
 * completion a row reading gives (the value of row 1 that the bottom row lacks, when one is
 * missing) and a column reading (the value of column 1 the right column lacks); if none is left,
 * every other value.
 */
export function diagonalLureValues(attr: ScalarAttr, key: Cell, visible: readonly Cell[]): number[] {
  const v = (i: number): number => (visible[i] as Cell)[attr]
  const k = key[attr]
  const completion = (line: readonly number[], pair: readonly number[]): number[] => {
    const rest = [...new Set(line)].filter((x) => !pair.includes(x))
    return rest.length === 1 ? rest : []
  }
  const xs = [v(2), v(5), v(6), v(7), ...completion([v(0), v(1), v(2)], [v(6), v(7)]), ...completion([v(0), v(3), v(6)], [v(2), v(5)])]
  const out = [...new Set(xs)].filter((x) => x !== k).sort((a, b) => a - b)
  return out.length > 0 ? out : range(DOMAIN_SIZE[attr]).filter((x) => x !== k)
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
export function sampleAcceptedHard(rng: Rng, rules: RuleSet, diagonal = false): AcceptedSample | null {
  for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
    const grid = sampleHardGrid(rng, rules)
    const visible = grid.slice(0, 8)
    const key = grid[8] as Cell
    const sol = solve(visible, diagonal)
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

// --- directions and diagonals (generator 1.4.0) --------------------------------------------------

/** One requested draw in TEMPLATE_ODDS (strata 2–6) takes a 1.4.0 template. */
export const TEMPLATE_ODDS = 3

/** The components of a direction group (what is mirrored when the group runs down the columns). */
const GROUP_COMPONENTS: Readonly<Record<DirectionGroup, readonly Component[]>> = {
  shape: ['shape'],
  size: ['size'],
  color: ['color'],
  orientation: ['orientation'],
  layout: ['positions'],
  frame: ['frameShade', 'framePattern'],
}

/**
 * The full grid of a template set (9 cells, the 9th the key): the 1.3.0 grid of its base
 * ({@link baseRuleSet}), each column-ruled group mirrored across the main diagonal, then each
 * diagonal attribute set to five values drawn one per diagonal (column − row = −2 … 2), each
 * different from its neighbour diagonal.
 */
export function sampleTemplateGrid(rng: Rng, rules: RuleSet): Cell[] {
  let grid = sampleHardGrid(rng, baseRuleSet(rules))
  for (const g of groupsOf(rules)) {
    if (directionOf(rules, g) !== 'col') continue
    const comps = GROUP_COMPONENTS[g]
    const src = grid
    grid = src.map((c, i) => {
      const m = src[transposeIndex(i)] as Cell
      return Object.fromEntries([...Object.entries(c), ...comps.map((k) => [k, m[k]])]) as unknown as Cell
    })
  }
  for (const attr of diagonalAttrs(rules)) {
    const n = DOMAIN_SIZE[attr]
    const diag: number[] = [rng.int(0, n - 1)]
    while (diag.length < 5) {
      const prev = diag[diag.length - 1] as number
      diag.push(rng.pick(range(n).filter((x) => x !== prev)))
    }
    grid = grid.map((c, i) => ({ ...c, [attr]: diag[diagonalOf(i) + 2] as number }))
  }
  return grid
}

/** The fits of the attribute a group's direction is judged on (count in count mode, the slot sets in position mode). */
function groupFits(sol: Solution, rules: RuleSet, g: DirectionGroup): readonly string[] {
  switch (g) {
    case 'layout':
      return (rules.position === 'canonical' ? sol.count : sol.positions).fits.map((f) => f.rule)
    case 'frame':
      return [...(sol.frameShade?.fits ?? []), ...(sol.framePattern?.fits ?? [])].map((f) => f.rule)
    default:
      return sol[g].fits.map((f) => f.rule)
  }
}

/** True if a group's fits include its declared direction and none of the other one. */
function needsDirection(sol: Solution, rules: RuleSet, g: DirectionGroup, dir: LineDirection): boolean {
  const fits = groupFits(sol, rules, g)
  const other: LineDirection = dir === 'row' ? 'col' : 'row'
  return fits.some((f) => f.endsWith(`@${dir}`)) && !fits.some((f) => f.endsWith(`@${other}`))
}

/**
 * The direction of a 1.4.0 template is needed to solve it (generator gate and verifier check
 * `directions_needed`): column template, some direction-sensitive group fits down the columns and
 * not along the rows; mixed, that and some sensitive group fits along the rows and not down the
 * columns; diagonal, every diagonal attribute fits only the diagonal rule. True for any other set.
 */
export function directionsNeeded(sol: Solution, rules: RuleSet): boolean {
  const diag = diagonalAttrs(rules)
  if (diag.length > 0) return diag.every((a) => sol[a].fits.length > 0 && sol[a].fits.every((f) => f.rule === DIAGONAL_FIT))
  const kind = directionKind(rules)
  if (kind === 'row') return true
  const needed = (dir: LineDirection): boolean =>
    sensitiveGroups(rules).some((g) => directionOf(rules, g) === dir && needsDirection(sol, rules, g, dir))
  return needed('col') && (kind === 'col' || needed('row'))
}

/** The line values of one component of the 8 visible cells and the key (row-major), and the key's value. */
function componentValues(cells: readonly Cell[], comp: Component | 'count'): number[] {
  return cells.map((c) => (comp === 'count' ? popcount(c.positions) : componentValue(c, comp)))
}

/** A line rule a person may read, as a per-line test and a prediction from the third line's visible pair. */
interface Reading {
  readonly name: string
  /** Holds on the two complete lines (distribution compares them with each other). */
  readonly holds: (l1: readonly number[], l2: readonly number[]) => boolean
  /** The third line's completion from its visible pair (a, b), or null if the pair breaks the rule. */
  readonly predict: (a: number, b: number, l1: readonly number[]) => number | null
}

const each = (f: (t: readonly number[]) => boolean) => (l1: readonly number[], l2: readonly number[]): boolean => f(l1) && f(l2)

/** The simple readings of one attribute kind: the solver's line rules plus "copy" (the third repeats the first / second). */
function readingsOf(kind: 'scalar' | 'orientation' | 'count' | 'set', n: number): Reading[] {
  const lo = kind === 'count' ? 1 : 0
  const hi = kind === 'count' ? SLOT_COUNT : n - 1
  const inDomain = (x: number): boolean => x >= lo && x <= hi
  const out: Reading[] = [
    { name: 'constant', holds: each((t) => t[0] === t[1] && t[1] === t[2]), predict: (a, b) => (a === b ? b : null) },
    {
      // "Each line holds the same three values in another order" (two equal lines are the repeat reading).
      name: 'distribution',
      holds: (l1, l2) => new Set(l1).size === 3 && l2.every((x) => l1.includes(x)) && new Set(l2).size === 3 && l1.some((x, i) => x !== l2[i]),
      predict: (a, b, l1) => (a !== b && l1.includes(a) && l1.includes(b) ? (l1.find((x) => x !== a && x !== b) as number) : null),
    },
    {
      // "Every line is the same line": the third line repeats the first two.
      name: 'repeat-line',
      holds: (l1, l2) => l1.every((x, i) => x === l2[i]),
      predict: (a, b, l1) => (a === l1[0] && b === l1[1] ? (l1[2] as number) : null),
    },
    { name: 'copy-first', holds: each((t) => t[2] === t[0]), predict: (a) => a },
    { name: 'copy-second', holds: each((t) => t[2] === t[1]), predict: (_a, b) => b },
  ]
  if (kind === 'set') {
    const ops: readonly [string, (x: number, y: number) => number][] = [
      ['xor', (x, y) => x ^ y],
      ['or', (x, y) => x | y],
      ['and', (x, y) => x & y],
    ]
    for (const [name, op] of ops) {
      out.push({ name, holds: each((t) => t[2] === op(t[0] as number, t[1] as number)), predict: (a, b) => (op(a, b) !== 0 ? op(a, b) : null) })
    }
    return out
  }
  for (const d of [1, -1]) {
    out.push({
      name: `progression${d > 0 ? '+' : '-'}1`,
      holds: each((t) => t[1] === (t[0] as number) + d && t[2] === (t[1] as number) + d),
      predict: (a, b) => (b === a + d && inDomain(b + d) ? b + d : null),
    })
    if (kind === 'orientation') {
      const next = (x: number): number => (((x + d) % n) + n) % n
      out.push({ name: `cyclic${d > 0 ? '+' : '-'}1`, holds: each((t) => t[1] === next(t[0] as number) && t[2] === next(t[1] as number)), predict: (a, b) => (b === next(a) ? next(b) : null) })
    }
    if (kind === 'count') {
      out.push({
        name: `arithmetic${d > 0 ? '+' : '-'}`,
        holds: each((t) => t[2] === (t[0] as number) + d * (t[1] as number)),
        predict: (a, b) => (inDomain(a + d * b) ? a + d * b : null),
      })
    }
  }
  return out
}

/**
 * True if no ruled attribute of a template set has a **second reading** (generator gate and
 * verifier check `no_second_reading`, 1.4.0 templates only). A second reading is a simple line
 * rule — the solver's line rules (constant, progression ±1, cyclic orientation, distribution,
 * count arithmetic, xor / or / and on the slots) or a copy ("the third repeats the first / the
 * second") — that holds on both complete lines of the attribute, along the rows or down the
 * columns, and completes the third line with another value than the key; or, on a diagonal
 * attribute, is broken by the third line's visible pair (the declared rule of a line-ruled
 * attribute holds on all three lines, so a person who meets a contradicted two-line pattern
 * still finds it; a diagonal rule is not a line rule, so a strong two-line pattern misleads).
 * "Distribution" here needs the two lines in different orders; two equal lines are the
 * "repeat the line" reading. The solver has no copy or repeat rule and ignores rules broken by
 * the pair, so none of this shows in its uniqueness; a person sees it. The declared rule in its
 * declared direction always passes (it completes with the key). Examples the panel found: x − y = z down the columns with
 * x = 2y in both columns (the copy-second reading gives another count); a diagonal orientation
 * whose first two rows are permutations of the same three turns while the third row holds a
 * fourth (the distribution reading, broken). Checked on every ruled attribute: the four scalars
 * (diagonal ones included), the count in count mode or the slot set in position mode, and the frame.
 */
export function noSecondReading(visible: readonly Cell[], key: Cell, rules: RuleSet): boolean {
  const cells = [...visible, key]
  const comps: { comp: Component | 'count'; kind: 'scalar' | 'orientation' | 'count' | 'set'; n: number }[] = []
  for (const a of SCALAR_ATTRS) if (rules[a] !== 'constant') comps.push({ comp: a, kind: a === 'orientation' ? 'orientation' : 'scalar', n: DOMAIN_SIZE[a] })
  if (rules.position === 'canonical') {
    if (rules.count !== 'constant') comps.push({ comp: 'count', kind: 'count', n: SLOT_COUNT })
  } else comps.push({ comp: 'positions', kind: 'set', n: 0 })
  if (rules.frame_shade !== undefined && rules.frame_shade !== 'constant') comps.push({ comp: 'frameShade', kind: 'scalar', n: FRAME_DOMAIN_SIZE.frameShade })
  if (rules.frame_pattern !== undefined && rules.frame_pattern !== 'constant') comps.push({ comp: 'framePattern', kind: 'scalar', n: FRAME_DOMAIN_SIZE.framePattern })
  return comps.every(({ comp, kind, n }) => {
    // A broken reading misleads only where the declared rule is not itself a line rule a person
    // can check on all three lines: a diagonal attribute.
    const diagonal = comp !== 'count' && comp !== 'positions' && comp !== 'frameShade' && comp !== 'framePattern' && rules[comp] === DIAGONAL_RULE
    const v = componentValues(cells, comp)
    const readings = readingsOf(kind, n)
    return (['row', 'col'] as const).every((dir) => {
      const line = (i: number): number[] => [0, 1, 2].map((k) => v[dir === 'row' ? i * 3 + k : k * 3 + i] as number)
      const [l1, l2, l3] = [line(0), line(1), line(2)]
      const [a, b, key3] = l3 as [number, number, number]
      return readings.every((r) => {
        const p = r.holds(l1, l2) ? r.predict(a, b, l1) : key3
        return p === key3 || (p === null && !diagonal)
      })
    })
  })
}

/** True if a template set takes lure distractors (a hard-sized or a diagonal set), else the 1.2.0 one-change tree. */
export function takesLures(rules: RuleSet): boolean {
  return isHardRuleSet(rules) || diagonalAttrs(rules).length > 0
}

/**
 * Steps 2–5 for a 1.4.0 template set: the first grid the 1.4.0 solver completes uniquely with its
 * key whose direction is needed, with an option set that passes the option-only gates (lures and
 * both pickers, up to {@link HARD_TREE_TRIES} trees, or the one-change tree and the modal picker);
 * null after {@link MAX_GRID_ATTEMPTS} grids.
 */
export function sampleAcceptedTemplate(rng: Rng, rules: RuleSet): AcceptedSample | null {
  const lures = takesLures(rules)
  for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
    const grid = sampleTemplateGrid(rng, rules)
    const visible = grid.slice(0, 8)
    const key = grid[8] as Cell
    const sol = solve(visible, true)
    if (!sol.cell || !cellEquals(sol.cell, key) || !directionsNeeded(sol, rules) || !noSecondReading(visible, key, rules)) continue
    if (!lures) {
      const tree = fairOptions(rng, key, visible, rules.position === 'canonical')
      if (!tree || modalPicksKeyUniquely(tree, 0)) continue
      return { visible, tree }
    }
    for (let t = 0; t < HARD_TREE_TRIES; t++) {
      const tree = lureOptions(rng, key, visible, rules)
      if (!tree) break
      if (modalPicksKeyUniquely(tree, 0) || hubPicksKeyUniquely(tree, 0)) continue
      return { visible, tree }
    }
  }
  return null
}

/**
 * Draw the directions of a mixed-template base: every direction-sensitive group row or column
 * uniformly, redrawn until both occur; every other group row or column uniformly.
 */
export function drawMixedDirections(rng: Rng, base: RuleSet): RuleSet {
  const sensitive = sensitiveGroups(base)
  let dirs: LineDirection[]
  do dirs = sensitive.map(() => rng.pick(['row', 'col'] as const))
  while (!dirs.includes('row') || !dirs.includes('col'))
  const directions = Object.fromEntries(
    groupsOf(base).map((g) => {
      const i = sensitive.indexOf(g)
      return [g, i >= 0 ? (dirs[i] as LineDirection) : rng.pick(['row', 'col'] as const)]
    }),
  )
  return { ...base, directions }
}

/** The generator versions this build makes: 1.2.0 and 1.3.0 never draw a template (`index.ts`). */
export type MatricesVersion = '1.2.0' | '1.3.0' | '1.4.0'
export const CURRENT_MATRICES_VERSION: MatricesVersion = '1.4.0'

/** True if items of this generator version are analysed with the diagonal rule (1.4.0 on). */
export function usesDiagonalAnalysis(version: string): boolean {
  const [major, minor] = version.split(/[.+]/).map(Number)
  return (major as number) > 1 || (minor as number) >= 4
}

/** A 1.4.0 template set for a requested stratum, or null for this draw to stay on the 1.3.0 path. */
function drawTemplate(rng: Rng, stratum: Stratum): RuleSet | null {
  const pool = templateCodes(stratum)
  const kinds = TEMPLATE_KINDS.filter((k) => (pool.get(k)?.length ?? 0) > 0)
  if (kinds.length === 0 || rng.int(0, TEMPLATE_ODDS - 1) !== 0) return null
  const kind = rng.pick(kinds)
  // The same draw as rng.pick(list) (pick = list[int(0, length − 1)]), on the packed list.
  const codes = pool.get(kind) as Int32Array
  const cand = templateRulesOf(codes[rng.int(0, codes.length - 1)] as number)
  if (kind === 'col') return { ...cand, directions: Object.fromEntries(groupsOf(cand).map((g) => [g, 'col'])) }
  if (kind === 'mixed') return drawMixedDirections(rng, cand)
  return cand
}

/** `build()` of the matrices family for generator `version` (see the module comment). */
export function buildMatrix(rng: Rng, ctx: BuildContext, version: MatricesVersion = CURRENT_MATRICES_VERSION): BuiltItem<MatrixSpec, MatrixKey> {
  let rules: RuleSet
  if (ctx.stratum === undefined) {
    rules = rng.pick(ALL_RULE_SETS)
  } else {
    const pool = RULE_SETS_BY_STRATUM.get(ctx.stratum)
    if (!pool) throw new RangeError(`matrices cannot generate stratum ${ctx.stratum}`)
    const template = version === '1.4.0' && ctx.stratum >= 2 ? drawTemplate(rng, ctx.stratum) : null
    rules = template ?? rng.pick(pool)
  }
  const stratum = stratumOfB(bPriorOf(featuresOf(rules)))
  const diagonal = usesDiagonalAnalysis(version)
  const sample = isTemplateRuleSet(rules)
    ? sampleAcceptedTemplate(rng, rules)
    : isHardRuleSet(rules)
      ? sampleAcceptedHard(rng, rules, diagonal)
      : sampleAccepted(rng, rules, diagonal)
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
