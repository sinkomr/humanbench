/**
 * Rule-inference solver for matrices (DESIGN §4.2 "Matrices": "a rule-inference solver enumerates
 * *all* rule assignments consistent with the 8 visible cells. Accept only if every consistent
 * assignment predicts the same 9th cell and exactly one option equals it").
 *
 * A rule relates the three values (x, y, z) of a line of cells. Rows 1 and 2 are complete and
 * must satisfy it; row 3 has (a, b) visible, and the rule predicts its third value (or rules
 * itself out). The solver tries every rule of the attribute's rule set along the rows **and**
 * along the columns (the transpose; the missing cell is its own mirror), which is a superset of
 * what the generator uses (rows only), so it can only reject more items, never fewer.
 *
 * Solver rule sets (values are ordinal indices; count is the number of positions):
 * - shape, size, color, orientation: constant (x = y = z); progression ±1 (y = x ± 1,
 *   z = y ± 1, the prediction inside the domain); distribution (each line a permutation of the
 *   same 3 distinct values). Orientation is also tried as a cyclic progression ±1 mod 4
 *   (mod 180°), which a viewer may see for 180°-symmetric shapes.
 * - count (domain 1–9): constant; progression ±1; arithmetic ± (z = x ± y); distribution. The
 *   domain is deliberately wider than the grammar's 1–4: a count rule that extrapolates to 5–9
 *   objects is still a pattern a viewer may follow, so it counts as a lure (and rejects the grid).
 * - position (non-empty slot sets): constant; xor (z = x △ y); or (z = x ∪ y); and (z = x ∩ y,
 *   solver only); distribution; and canonical: every visible cell uses the canonical layout of
 *   its count and a count rule predicts n ≤ 4, which predicts the canonical layout of n.
 *
 * The 9th cell is unique iff every scalar attribute has exactly one predicted value, the position
 * rules predict exactly one set P*, and every consistent count rule predicts |P*| (so a count
 * pattern cannot lure a viewer to another number of objects). Rules are independent per
 * attribute, so this is exactly "every consistent assignment predicts the same cell".
 */

import {
  DOMAIN_SIZE,
  MAX_COUNT,
  SCALAR_ATTRS,
  SLOT_COUNT,
  canonicalMask,
  isCanonical,
  popcount,
  type Cell,
  type CountRule,
  type PositionRule,
  type RuleAttr,
  type RuleSet,
  type ScalarAttr,
  type ScalarRule,
} from './grammar'

export type Direction = 'row' | 'col'
export const DIRECTIONS: readonly Direction[] = Object.freeze(['row', 'col'] as const)

type Triple = readonly [number, number, number]

/** Lines of one attribute along a direction: two complete lines and the visible pair (a, b) of the third. */
export interface Lines {
  readonly l1: Triple
  readonly l2: Triple
  readonly a: number
  readonly b: number
}

/** Lines of the 8 visible values (row-major; the missing 9th is index 8) along `dir`. */
export function linesOf(values: readonly number[], dir: Direction): Lines {
  if (values.length !== 8) throw new RangeError(`linesOf needs the 8 visible values, got ${values.length}`)
  const at = (r: number, c: number): number => (dir === 'row' ? values[r * 3 + c] : values[c * 3 + r]) as number
  return {
    l1: [at(0, 0), at(0, 1), at(0, 2)],
    l2: [at(1, 0), at(1, 1), at(1, 2)],
    a: at(2, 0),
    b: at(2, 1),
  }
}

/** A candidate rule: predicts the missing value from the lines, or null if the rule does not fit. */
export interface SolverRule {
  readonly name: string
  predict(lines: Lines): number | null
}

const constant: SolverRule = {
  name: 'constant',
  predict: ({ l1, l2, a, b }) => {
    const ok = (t: Triple): boolean => t[0] === t[1] && t[1] === t[2]
    return ok(l1) && ok(l2) && a === b ? b : null
  },
}

function progression(delta: 1 | -1, lo: number, hi: number): SolverRule {
  return {
    name: delta > 0 ? 'progression+1' : 'progression-1',
    predict: ({ l1, l2, a, b }) => {
      const ok = (t: Triple): boolean => t[1] === t[0] + delta && t[2] === t[1] + delta
      if (!ok(l1) || !ok(l2) || b !== a + delta) return null
      const p = b + delta
      return p >= lo && p <= hi ? p : null
    },
  }
}

function cyclic(delta: 1 | -1, m: number): SolverRule {
  const next = (x: number): number => (((x + delta) % m) + m) % m
  return {
    name: delta > 0 ? 'cyclic+1' : 'cyclic-1',
    predict: ({ l1, l2, a, b }) => {
      const ok = (t: Triple): boolean => t[1] === next(t[0]) && t[2] === next(t[1])
      return ok(l1) && ok(l2) && b === next(a) ? next(b) : null
    },
  }
}

function arithmetic(sign: 1 | -1, lo: number, hi: number): SolverRule {
  return {
    name: sign > 0 ? 'arithmetic+' : 'arithmetic-',
    predict: ({ l1, l2, a, b }) => {
      const ok = (t: Triple): boolean => t[2] === t[0] + sign * t[1]
      if (!ok(l1) || !ok(l2)) return null
      const p = a + sign * b
      return p >= lo && p <= hi ? p : null
    },
  }
}

const distribution: SolverRule = {
  name: 'distribution',
  predict: ({ l1, l2, a, b }) => {
    const [s0, s1, s2] = l1
    if (s0 === s1 || s0 === s2 || s1 === s2) return null
    const inS = (x: number): boolean => x === s0 || x === s1 || x === s2
    const [t0, t1, t2] = l2
    if (!(inS(t0) && inS(t1) && inS(t2)) || t0 === t1 || t0 === t2 || t1 === t2) return null
    if (a === b || !inS(a) || !inS(b)) return null
    return l1.find((x) => x !== a && x !== b) as number
  },
}

function setOp(name: 'xor' | 'or' | 'and', op: (x: number, y: number) => number): SolverRule {
  return {
    name,
    predict: ({ l1, l2, a, b }) => {
      if (l1[2] !== op(l1[0], l1[1]) || l2[2] !== op(l2[0], l2[1])) return null
      const p = op(a, b)
      return p !== 0 ? p : null
    },
  }
}

const scalarRules = (n: number): SolverRule[] => [constant, progression(1, 0, n - 1), progression(-1, 0, n - 1), distribution]

/** The solver's rule set per scalar attribute. */
export const SCALAR_SOLVER_RULES: Readonly<Record<ScalarAttr, readonly SolverRule[]>> = Object.freeze({
  shape: scalarRules(DOMAIN_SIZE.shape),
  size: scalarRules(DOMAIN_SIZE.size),
  color: scalarRules(DOMAIN_SIZE.color),
  orientation: [...scalarRules(DOMAIN_SIZE.orientation), cyclic(1, DOMAIN_SIZE.orientation), cyclic(-1, DOMAIN_SIZE.orientation)],
})

/** The solver's count rules (domain 1–9, any number of objects a sub-grid can hold; see the module comment). */
export const COUNT_SOLVER_RULES: readonly SolverRule[] = Object.freeze([
  constant,
  progression(1, 1, SLOT_COUNT),
  progression(-1, 1, SLOT_COUNT),
  arithmetic(1, 1, SLOT_COUNT),
  arithmetic(-1, 1, SLOT_COUNT),
  distribution,
])

/** The solver's set rules on positions (canonical layouts are handled in {@link solve}). */
export const POSITION_SOLVER_RULES: readonly SolverRule[] = Object.freeze([
  constant,
  setOp('xor', (x, y) => x ^ y),
  setOp('or', (x, y) => x | y),
  setOp('and', (x, y) => x & y),
  distribution,
])

/** One consistent (rule, direction) and its prediction. */
export interface Fit {
  readonly rule: string
  readonly value: number
}

export interface AttributeSolution {
  /** Every consistent rule, as `<rule>@<row|col>`, with its prediction. */
  readonly fits: readonly Fit[]
  /** The distinct predicted values, ascending. */
  readonly predictions: readonly number[]
}

function fitAll(values: readonly number[], rules: readonly SolverRule[]): AttributeSolution {
  const fits: Fit[] = []
  for (const dir of DIRECTIONS) {
    const lines = linesOf(values, dir)
    for (const r of rules) {
      const p = r.predict(lines)
      if (p !== null) fits.push({ rule: `${r.name}@${dir}`, value: p })
    }
  }
  return { fits, predictions: [...new Set(fits.map((f) => f.value))].sort((x, y) => x - y) }
}

export interface Solution {
  readonly shape: AttributeSolution
  readonly size: AttributeSolution
  readonly color: AttributeSolution
  readonly orientation: AttributeSolution
  /** Count rules (the count-lure check and the canonical layouts). */
  readonly count: AttributeSolution
  /** Set rules plus canonical layouts. */
  readonly positions: AttributeSolution
  /** Every scalar attribute and the positions have at least one consistent rule. */
  readonly consistent: boolean
  /** Every consistent rule assignment predicts the same 9th cell. */
  readonly unique: boolean
  /** The count rules do not predict a count other than that of the predicted positions. */
  readonly noCountLure: boolean
  /** The predicted 9th cell when {@link unique}, else null. */
  readonly cell: Cell | null
  /**
   * Number of consistent (rule, direction) assignments: the product of the per-attribute fit
   * counts. Row and column fits of the same prediction count separately, so this is large even
   * for a unique item (192 for §14.6 example 1); {@link predictedCells} is the §14.6 "1".
   */
  readonly consistentRuleFits: number
  /**
   * Number of distinct 9th cells the consistent assignments predict: the product of the distinct
   * predictions of the scalar attributes and the positions (0 if inconsistent, 1 if they agree;
   * a count lure additionally makes the item non-unique, see {@link noCountLure}).
   */
  readonly predictedCells: number
}

/** Enumerate every rule assignment consistent with the 8 visible cells (row-major). */
export function solve(visible: readonly Cell[]): Solution {
  if (visible.length !== 8) throw new RangeError(`solve needs the 8 visible cells, got ${visible.length}`)
  const [shape, size, color, orientation] = SCALAR_ATTRS.map((attr) =>
    fitAll(
      visible.map((c) => c[attr]),
      SCALAR_SOLVER_RULES[attr],
    ),
  ) as [AttributeSolution, AttributeSolution, AttributeSolution, AttributeSolution]
  const count = fitAll(
    visible.map((c) => popcount(c.positions)),
    COUNT_SOLVER_RULES,
  )
  const sets = fitAll(
    visible.map((c) => c.positions),
    POSITION_SOLVER_RULES,
  )
  const posFits = [...sets.fits]
  if (visible.every((c) => isCanonical(c.positions))) {
    for (const f of count.fits) if (f.value <= MAX_COUNT) posFits.push({ rule: `canonical(${f.rule})`, value: canonicalMask(f.value) })
  }
  const positions: AttributeSolution = {
    fits: posFits,
    predictions: [...new Set(posFits.map((f) => f.value))].sort((x, y) => x - y),
  }
  const scalars = [shape, size, color, orientation]
  const consistent = scalars.every((s) => s.predictions.length > 0) && positions.predictions.length > 0
  const onlyP = positions.predictions.length === 1 ? (positions.predictions[0] as number) : null
  const noCountLure = onlyP !== null && count.predictions.every((n) => n === popcount(onlyP))
  const unique = consistent && scalars.every((s) => s.predictions.length === 1) && onlyP !== null && noCountLure
  const cell: Cell | null = unique
    ? {
        shape: shape.predictions[0] as number,
        size: size.predictions[0] as number,
        color: color.predictions[0] as number,
        orientation: orientation.predictions[0] as number,
        positions: onlyP as number,
      }
    : null
  const consistentRuleFits = [...scalars, positions].reduce((p, s) => p * s.fits.length, 1)
  const predictedCells = [...scalars, positions].reduce((p, s) => p * s.predictions.length, 1)
  return { shape, size, color, orientation, count, positions, consistent, unique, noCountLure, cell, consistentRuleFits, predictedCells }
}

// --- declared (generator) rules -------------------------------------------------------------------

const GEN_SCALAR: Readonly<Record<ScalarRule, (n: number) => SolverRule>> = {
  constant: () => constant,
  'progression+1': (n) => progression(1, 0, n - 1),
  'progression-1': (n) => progression(-1, 0, n - 1),
  distribution: () => distribution,
}

const GEN_COUNT: Readonly<Record<Exclude<CountRule, 'derived'>, SolverRule>> = {
  constant,
  'progression+1': progression(1, 1, SLOT_COUNT),
  'progression-1': progression(-1, 1, SLOT_COUNT),
  'arithmetic+': arithmetic(1, 1, SLOT_COUNT),
  'arithmetic-': arithmetic(-1, 1, SLOT_COUNT),
  distribution,
}

const GEN_POSITION: Readonly<Record<Exclude<PositionRule, 'canonical'>, SolverRule>> = {
  xor: setOp('xor', (x, y) => x ^ y),
  or: setOp('or', (x, y) => x | y),
  distribution,
}

const holdsAlongRows = (rule: SolverRule, values: readonly number[]): boolean =>
  rule.predict(linesOf(values.slice(0, 8), 'row')) === values[8]

/**
 * The attributes whose declared rule does NOT hold along the rows of a complete 9-cell grid
 * (row-major). Empty for the keyed grid; non-empty for a grid completed by a distractor.
 */
export function violatedRules(grid: readonly Cell[], rules: RuleSet): RuleAttr[] {
  if (grid.length !== 9) throw new RangeError(`violatedRules needs 9 cells, got ${grid.length}`)
  const out: RuleAttr[] = []
  for (const attr of SCALAR_ATTRS) {
    const rule = GEN_SCALAR[rules[attr]](DOMAIN_SIZE[attr])
    if (!holdsAlongRows(rule, grid.map((c) => c[attr]))) out.push(attr)
  }
  if (rules.count !== 'derived') {
    if (!holdsAlongRows(GEN_COUNT[rules.count], grid.map((c) => popcount(c.positions)))) out.push('count')
  }
  if (rules.position === 'canonical') {
    if (!grid.every((c) => isCanonical(c.positions))) out.push('position')
  } else if (!holdsAlongRows(GEN_POSITION[rules.position], grid.map((c) => c.positions))) {
    out.push('position')
  }
  return out
}
