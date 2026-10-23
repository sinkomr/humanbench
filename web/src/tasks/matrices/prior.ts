/**
 * Difficulty and time priors for matrices (ROADMAP M1.P, DESIGN §6.ii, §7.4).
 *
 * [SPEC] v0 regression on the rule structure, anchored at the ICAR matrix mean p = .52
 * (b = −logit(.52) ≈ −0.08, `ICAR_ANCHOR_B.matrix`) as the POOL mean (M1.P):
 *
 *   b = −0.08 + 0.45·(n_progression − 646/331) + 0.75·(n_distribution − 358/331)
 *             + 1.05·(n_arithmetic − 70/331) + 1.05·(n_logic − 70/331)
 *
 * i.e. each non-constant rule adds 0.45 (progression), 0.75 (distribution-of-3) or 1.05
 * (arithmetic, xor/or), centred at the rule-type means of the natural pool: the family draws its
 * rule set uniformly among the 1,655 valid ones (so every family_id equally often, A11) when no
 * stratum is requested, and those means are 3230/1655 progressions, 1790/1655 distributions and
 * 350/1655 each of arithmetic and logic. So the pool mean b is the anchor exactly; before
 * generator 1.2.0 the anchor sat at a reference mix (1, 1, ½, ½) and the pool (uniform over
 * strata) had mean ≈ −0.46. The number of rules is the main driver and the type order follows
 * Carpenter, Just & Shell (1990): pairwise progression < distribution-of-3 < figure
 * addition/subtraction and distribution-of-two (xor). The weights are guesses to be replaced by
 * M4 calibration; σ_b = 1.0. They put 1 progression at b ≈ −1.76, two progressions (§14.6
 * example 1) at −1.31 and the hardest 4-rule sets at ≈ 1.09, so the family spans strata 1–4
 * (10, 368, 1,156 and 121 rule sets). §14.6 example 1 says "b prior −1.2"; that figure is
 * illustrative, and this v0 model gives it −1.31 (both in stratum 2, "easy").
 *
 * Time ([SPEC] v0, §7.4 E[T]): 30 s for one rule + 10 s per further rule (30–60 s); the cap is
 * the shared power-item rule `powerTimeLimit` (§13), here always 180 s.
 *
 * Hard strata (generator 1.3.0, M3.12). The hard templates (`grammar.ts` {@link allHardRuleSets}:
 * all five attributes ruled, or an outer frame with its own rules on top of 3–5 inner rules) use
 * the same model with two more terms, centred at 0 so that a 1.2.0 rule set keeps its b exactly
 * (its features do not even carry them; {@link MATRIX_HARD_PRIOR}):
 *
 *   b_hard = b + 0.35·n_extra_rules + 0.60·two_components
 *
 * where frame rules count in n_progression / n_distribution like inner rules, `n_extra_rules` =
 * max(0, n_rules − 4) and `two_components` is 1 for a framed item. Rationale: Carpenter, Just &
 * Shell (1990) found the number of rule tokens to be held at once the main source of APM item
 * difficulty, with the hardest APM items (4–5 tokens) failed by most of a university sample; past
 * the 1.2.0 ceiling of 4 rules each further token is charged a working-memory surcharge on top of
 * its type weight. A second figure per cell adds a correspondence / segmentation step (which
 * elements belong to which rule system: Carpenter et al.'s "correspondence finding", and the
 * perceptual-organization effects of Primi 2001 and Embretson 1998), and the out-in
 * configurations of RAVEN (Zhang et al. 2019) were among the hardest for people. Only the hard
 * candidates with b ≥ 1.5 are drawn (strata 5 and 6, on request only; the natural pool and strata
 * 1–4 are the 1.2.0 ones): 6,184 rule sets in stratum 5 (b 1.59–2.49) and 3,995 in stratum 6
 * (b 2.69–3.89). E[T] adds 15 s for the frame: 70 s (5 rules, no frame) to 95 s (6 rules with a
 * frame), so caps of 180–238 s. Every hard item's distractors are single-rule lures (`gen.ts`).
 *
 * Directions and diagonals (generator 1.4.0). The three templates of `grammar.ts`
 * ({@link isTemplateRuleSet}) take the hard model with three more terms, all centred at 0:
 *
 *   b_dir = b_hard + 0.25·col_direction + 0.45·mixed_direction + 0.60·n_diagonal
 *
 * where `col_direction` is 1 when every group is ruled down the columns, `mixed_direction` 1 when
 * some ruled groups run along the rows and some down the columns, and `n_diagonal` the number of
 * `diagonal_constant` attributes (1–2); a diagonal rule counts in `n_rules` (so in
 * `n_extra_rules` past 4) but in no other type term: its weight is the 0.60. Rationale: rows are
 * the default reading direction of matrix items, so a pattern that holds only down the columns
 * costs a search across directions (Carpenter, Just & Shell 1990 describe solvers inducing rules
 * row by row and checking columns after); keeping two directions apart at once is a second
 * correspondence problem (Primi 2001); a diagonal rule is a distribution read on the
 * diagonals, the least salient direction of the grid, so it is weighted near the distribution
 * rule plus the column surcharge. E[T] adds {@link EXPECTED_TIME_DIAGONAL_S} s per diagonal rule.
 * The features of a template set always carry all five extra terms (`n_extra_rules`,
 * `two_components`, `col_direction`, `mixed_direction`, `n_diagonal`), so a 1.2.0/1.3.0 set keeps
 * its b exactly. Template candidates ({@link templatePool}): every 1.2.0 set and every hard
 * candidate, all down the columns (needs one direction-sensitive group, {@link isDirectionSensitive})
 * or mixed (needs two); and, for the diagonal template, every 1.2.0 set, the all-constant set and
 * every hard candidate with one or two constant scalar attributes turned diagonal (at most
 * {@link HARD_MAX_RULES} rules). Only requested strata 2–6 draw them (`gen.ts`).
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import {
  DIAGONAL_RULE,
  FRAME_PATTERN_RULES,
  HARD_FRAMED_MIN_RULES,
  HARD_MAX_RULES,
  LAYOUT_RULES,
  SCALAR_ATTRS,
  SCALAR_RULES,
  allHardRuleSets,
  allRuleSets,
  baseRuleSet,
  diagonalAttrs,
  groupsOf,
  isFramed,
  isHardRuleSet,
  isTemplateRuleSet,
  nonConstantRules,
  type DirectionGroup,
  type LineDirection,
  type RuleSet,
} from './grammar'

/**
 * The natural pool's mean count of each rule type (M1.P): exact fractions over the 1,655 rule
 * sets (the bank uses the same fractions, so both repos compute the same double).
 */
export const POOL_RULE_MEANS = Object.freeze({
  n_progression: 3230 / 1655,
  n_distribution: 1790 / 1655,
  n_arithmetic: 350 / 1655,
  n_logic: 350 / 1655,
})

export const MATRIX_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.matrix,
  terms: Object.freeze({
    n_progression: Object.freeze({ beta: 0.45, centre: POOL_RULE_MEANS.n_progression }),
    n_distribution: Object.freeze({ beta: 0.75, centre: POOL_RULE_MEANS.n_distribution }),
    n_arithmetic: Object.freeze({ beta: 1.05, centre: POOL_RULE_MEANS.n_arithmetic }),
    n_logic: Object.freeze({ beta: 1.05, centre: POOL_RULE_MEANS.n_logic }),
  }),
})

/** Hard templates (M3.12): the 1.2.0 terms unchanged plus two terms centred at 0 (module comment). */
export const MATRIX_HARD_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.matrix,
  terms: Object.freeze({
    ...MATRIX_PRIOR.terms,
    n_extra_rules: Object.freeze({ beta: 0.35, centre: 0 }),
    two_components: Object.freeze({ beta: 0.6, centre: 0 }),
  }),
})

/** Directions and diagonals (generator 1.4.0): the hard model plus three terms centred at 0 (module comment). */
export const MATRIX_DIR_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.matrix,
  terms: Object.freeze({
    ...MATRIX_HARD_PRIOR.terms,
    col_direction: Object.freeze({ beta: 0.25, centre: 0 }),
    mixed_direction: Object.freeze({ beta: 0.45, centre: 0 }),
    n_diagonal: Object.freeze({ beta: 0.6, centre: 0 }),
  }),
})

export const MATRIX_PROVENANCE =
  '[SPEC] v0 matrices prior (M1.P): b = -0.08 (ICAR matrix p = .52, the pool mean) + 0.45(n_progression - 3230/1655) + ' +
  '0.75(n_distribution - 1790/1655) + 1.05(n_arithmetic - 350/1655) + 1.05(n_logic - 350/1655), centred at the rule-type ' +
  'means of the natural pool (rule sets uniform); rule-type order after Carpenter, Just & Shell (1990)'

export const MATRIX_HARD_PROVENANCE =
  MATRIX_PROVENANCE +
  '; hard templates (M3.12): + 0.35(n_extra_rules = rules beyond 4) + 0.60(two_components: an outer frame with its own rules), ' +
  'frame rules counted by type; rule-token load after Carpenter, Just & Shell (1990), component segmentation after Primi (2001)'

export const MATRIX_DIR_PROVENANCE =
  MATRIX_HARD_PROVENANCE +
  '; directions and diagonals (generator 1.4.0): + 0.25(col_direction: every rule down the columns) + 0.45(mixed_direction: ' +
  'rules along rows and down columns at once) + 0.60(n_diagonal: rules constant along the diagonals), a diagonal rule counted in ' +
  'n_rules only; reading direction after Carpenter, Just & Shell (1990), correspondence load after Primi (2001)'

export const EXPECTED_TIME_BASE_S = 30
export const EXPECTED_TIME_PER_RULE_S = 10
/** E[T] added for the second (frame) component (M3.12). */
export const EXPECTED_TIME_FRAME_S = 15
/** E[T] added per diagonal rule (generator 1.4.0). */
export const EXPECTED_TIME_DIAGONAL_S = 5

/** Named inputs of the v0 prior (`difficulty.features`). */
export interface MatrixFeatures {
  readonly n_rules: number
  readonly n_progression: number
  readonly n_distribution: number
  readonly n_arithmetic: number
  readonly n_logic: number
  /** Hard templates only (M3.12): rules beyond 4. */
  readonly n_extra_rules?: number
  /** Hard templates only (M3.12): 1 with an outer frame, else 0. */
  readonly two_components?: number
  /** Generator 1.4.0 templates only: 1 when every group is ruled down the columns. */
  readonly col_direction?: number
  /** Generator 1.4.0 templates only: 1 when ruled groups run along rows and down columns. */
  readonly mixed_direction?: number
  /** Generator 1.4.0 templates only: the number of diagonal rules. */
  readonly n_diagonal?: number
}

/** The direction template of a set: all rows (no directions), all columns, or mixed. */
export function directionKind(rules: RuleSet): 'row' | 'col' | 'mixed' {
  const d = rules.directions
  if (d === undefined) return 'row'
  const dirs = groupsOf(rules).map((g) => d[g] ?? 'row')
  return dirs.every((x) => x === 'col') ? 'col' : dirs.every((x) => x === 'row') ? 'row' : 'mixed'
}

/** The features of a rule set: the five 1.2.0 ones, plus the two hard ones for a hard rule set. */
export function featuresOf(rules: RuleSet): MatrixFeatures {
  const types = nonConstantRules(rules)
  const n = (t: string): number => types.filter((x) => x === t).length
  const base = {
    n_rules: types.length,
    n_progression: n('progression'),
    n_distribution: n('distribution'),
    n_arithmetic: n('arithmetic'),
    n_logic: n('logic'),
  }
  const hard = { n_extra_rules: Math.max(0, types.length - 4), two_components: isFramed(rules) ? 1 : 0 }
  if (isTemplateRuleSet(rules)) {
    const kind = directionKind(rules)
    return {
      ...base,
      ...hard,
      col_direction: kind === 'col' ? 1 : 0,
      mixed_direction: kind === 'mixed' ? 1 : 0,
      n_diagonal: diagonalAttrs(rules).length,
    }
  }
  if (!isHardRuleSet(rules)) return base
  return { ...base, ...hard }
}

/** True for the features of a generator 1.4.0 template set. */
export function isTemplateFeatures(features: MatrixFeatures): boolean {
  return features.n_diagonal !== undefined
}

/** True for the features of a hard-template rule set. */
export function isHardFeatures(features: MatrixFeatures): boolean {
  return features.two_components !== undefined
}

export function bPriorOf(features: MatrixFeatures): number {
  const model = isTemplateFeatures(features) ? MATRIX_DIR_PRIOR : isHardFeatures(features) ? MATRIX_HARD_PRIOR : MATRIX_PRIOR
  return clampPrior(linearB(model, { ...features }))
}

/** E[T] in seconds: 30 + 10·(n_rules − 1), + 15 with a frame (M3.12), + 5 per diagonal rule (1.4.0). */
export function expectedTimeOf(nRules: number, framed = false, nDiagonal = 0): number {
  return EXPECTED_TIME_BASE_S + EXPECTED_TIME_PER_RULE_S * (nRules - 1) + (framed ? EXPECTED_TIME_FRAME_S : 0) + EXPECTED_TIME_DIAGONAL_S * nDiagonal
}

/** E[T] of an item with these features. */
export function expectedTimeOfFeatures(features: MatrixFeatures): number {
  return expectedTimeOf(features.n_rules, features.two_components === 1, features.n_diagonal ?? 0)
}

/** The provenance string of an item with these features. */
export function provenanceOf(features: MatrixFeatures): string {
  return isTemplateFeatures(features) ? MATRIX_DIR_PROVENANCE : isHardFeatures(features) ? MATRIX_HARD_PROVENANCE : MATRIX_PROVENANCE
}

export { SIGMA_B_DEFAULT }

/** Every rule set (1,655), in enumeration order: the natural pool draws uniformly from it (M1.P). */
export const ALL_RULE_SETS: readonly RuleSet[] = Object.freeze(allRuleSets())

/** Lowest stratum the hard templates serve (M3.12); below it a request draws a 1.2.0 rule set. */
export const HARD_MIN_STRATUM = 5

const byStratum = (sets: readonly RuleSet[], keep: (s: Stratum) => boolean): Map<Stratum, RuleSet[]> => {
  const m = new Map<Stratum, RuleSet[]>()
  for (const rules of sets) {
    const s = stratumOfB(bPriorOf(featuresOf(rules)))
    if (!keep(s)) continue
    const list = m.get(s) ?? []
    list.push(rules)
    m.set(s, list)
  }
  return m
}

/** The 1.2.0 rule sets (1,655) grouped by the stratum of their prior b: strata 1–4. */
export const BASE_RULE_SETS_BY_STRATUM: ReadonlyMap<Stratum, readonly RuleSet[]> = byStratum(ALL_RULE_SETS, () => true)

/** The hard-template rule sets whose prior b falls in stratum 5 or 6 (M3.12; drawn on request only). */
export const HARD_RULE_SETS_BY_STRATUM: ReadonlyMap<Stratum, readonly RuleSet[]> = byStratum(allHardRuleSets(), (s) => s >= HARD_MIN_STRATUM)

/** Every targetable rule set by stratum: 1–4 from the 1.2.0 sets, 5–6 from the hard templates. */
export const RULE_SETS_BY_STRATUM: ReadonlyMap<Stratum, readonly RuleSet[]> = new Map([...BASE_RULE_SETS_BY_STRATUM, ...HARD_RULE_SETS_BY_STRATUM])

/** The strata the family can target (every stratum with at least one rule set): 1–6. */
export const MATRIX_STRATA: readonly Stratum[] = Object.freeze([...RULE_SETS_BY_STRATUM.keys()].sort((a, b) => a - b))

/** The strata of generator 1.2.0 (no hard templates): 1–4. */
export const MATRIX_LEGACY_STRATA: readonly Stratum[] = Object.freeze([...BASE_RULE_SETS_BY_STRATUM.keys()].sort((a, b) => a - b))

// --- directions and diagonals (generator 1.4.0) -------------------------------------------------

/** The template kinds of generator 1.4.0, in draw order. */
export const TEMPLATE_KINDS = Object.freeze(['col', 'mixed', 'diagonal'] as const)
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

/** Requested strata that may draw a 1.4.0 template (stratum 1 and the natural pool never do). */
export const TEMPLATE_STRATA: readonly Stratum[] = Object.freeze([2, 3, 4, 5, 6] as const)

/**
 * True if a group's line rule can hold along one direction and fail along the other, so that the
 * direction matters: a progression on shape, color or orientation (4–5 values; on size, with 3
 * values, every row runs small → large, so its columns are constant), a count progression or
 * arithmetic, xor / or on the positions. A distribution is a Latin square, which reads the same
 * both ways, and the frame's rules are 3-valued or nominal, so neither is.
 */
export function isDirectionSensitive(rules: RuleSet, group: DirectionGroup): boolean {
  const prog = (r: string | undefined): boolean => r === 'progression+1' || r === 'progression-1'
  switch (group) {
    case 'shape':
    case 'color':
    case 'orientation':
      return prog(rules[group])
    case 'size':
    case 'frame':
      return false
    case 'layout':
      return rules.position === 'canonical' ? prog(rules.count) || rules.count === 'arithmetic+' || rules.count === 'arithmetic-' : rules.position !== 'distribution'
  }
}

/** The direction-sensitive groups of a set ({@link isDirectionSensitive}). */
export function sensitiveGroups(rules: RuleSet): DirectionGroup[] {
  return groupsOf(rules).filter((g) => isDirectionSensitive(rules, g))
}

const withDirections = (rules: RuleSet, pick: (g: DirectionGroup, i: number) => LineDirection): RuleSet => ({
  ...rules,
  directions: Object.fromEntries(groupsOf(rules).map((g, i) => [g, pick(g, i)])),
})

/** A column-template set: every group down the columns. */
export function columnSet(base: RuleSet): RuleSet {
  return withDirections(base, () => 'col')
}

/**
 * A representative mixed-template set of `base` (the first sensitive group along the rows, every
 * other group down the columns): the prior is the same for every mixed assignment, so the pools
 * hold the base and `gen.ts` draws the actual directions.
 */
export function mixedRepresentative(base: RuleSet): RuleSet {
  const first = sensitiveGroups(base)[0]
  return withDirections(base, (g) => (g === first ? 'row' : 'col'))
}

/**
 * The features of a template candidate from its base's features (what {@link featuresOf} gives the
 * full set; computed from the counts so the pools build fast; `prior.test`/`dir.test` check the
 * equality): a mixed candidate's features do not depend on which groups run which way.
 */
export function templateFeaturesOf(base: MatrixFeatures, framed: boolean, kind: TemplateKind, nDiagonal: number): MatrixFeatures {
  const n = base.n_rules + nDiagonal
  return {
    n_rules: n,
    n_progression: base.n_progression,
    n_distribution: base.n_distribution,
    n_arithmetic: base.n_arithmetic,
    n_logic: base.n_logic,
    n_extra_rules: Math.max(0, n - 4),
    two_components: framed ? 1 : 0,
    col_direction: kind === 'col' ? 1 : 0,
    mixed_direction: kind === 'mixed' ? 1 : 0,
    n_diagonal: nDiagonal,
  }
}

/**
 * Highest b of a template candidate kept: the top of the 1.3.0 hard sets (3.89), so no template
 * reaches the prior's clamp.
 */
export const TEMPLATE_MAX_B = 3.9

const ALL_CONSTANT: RuleSet = Object.freeze({
  shape: 'constant',
  size: 'constant',
  color: 'constant',
  orientation: 'constant',
  count: 'constant',
  position: 'canonical',
})

/** The diagonal-template sets of a base with `n` rules: one or two of its constant scalar attributes turned diagonal (≤ 6 rules). */
function diagonalSets(base: RuleSet, n: number): RuleSet[] {
  const free = SCALAR_ATTRS.filter((a) => base[a] === 'constant')
  const out: RuleSet[] = []
  for (let i = 0; i < free.length; i++) {
    const one = { ...base, [free[i] as string]: DIAGONAL_RULE } as RuleSet
    if (n + 1 <= HARD_MAX_RULES) out.push(one)
    for (let j = i + 1; j < free.length; j++) {
      if (n + 2 <= HARD_MAX_RULES) out.push({ ...one, [free[j] as string]: DIAGONAL_RULE } as RuleSet)
    }
  }
  return out
}

/** Template candidates per requested stratum and kind (col / mixed hold base sets; diagonal holds full sets). */
export type TemplatePool = ReadonlyMap<TemplateKind, readonly RuleSet[]>

/**
 * Every template candidate of every stratum, built from the rule-set objects (the definition).
 * Slow (≈ 0.7 s: it materialises ≈ 80,000 sets); kept as the reference that `dir.test.ts` checks
 * {@link templatePool} against, entry by entry and in order.
 */
export function referenceTemplatePools(): ReadonlyMap<Stratum, TemplatePool> {
  const bases = [...ALL_RULE_SETS, ...allHardRuleSets()]
  const pools = new Map<Stratum, Map<TemplateKind, RuleSet[]>>(TEMPLATE_STRATA.map((s) => [s, new Map()]))
  const add = (kind: TemplateKind, rules: RuleSet, b: number): void => {
    if (b > TEMPLATE_MAX_B) return
    const pool = pools.get(stratumOfB(b))
    if (pool === undefined) return
    const list = pool.get(kind) ?? []
    list.push(rules)
    pool.set(kind, list)
  }
  const bOf = (f: MatrixFeatures): number => clampPrior(linearB(MATRIX_DIR_PRIOR, { ...f }))
  for (const base of bases) {
    const f = featuresOf(base)
    const framed = isFramed(base)
    const sensitive = sensitiveGroups(base).length
    if (sensitive >= 1) add('col', base, bOf(templateFeaturesOf(f, framed, 'col', 0)))
    if (sensitive >= 2) add('mixed', base, bOf(templateFeaturesOf(f, framed, 'mixed', 0)))
  }
  for (const base of [ALL_CONSTANT, ...bases]) {
    const f = featuresOf(base)
    const framed = isFramed(base)
    for (const rules of diagonalSets(base, f.n_rules)) {
      add('diagonal', rules, bOf(templateFeaturesOf(f, framed, 'diagonal', diagonalAttrs(rules).length)))
    }
  }
  return pools
}

// Fast per-stratum enumeration. The same walk as {@link referenceTemplatePools} (bases: the 1.2.0
// sets in `allRuleSets` order, then the hard candidates in `allHardRuleSets` order; then the
// diagonal sets of [all-constant, ...bases]), over rule indices instead of objects: a base is
// (4 scalar rule indices into SCALAR_RULES, a LAYOUT_RULES index, a frame pair or none). The b of a
// candidate depends only on its rule-type counts, frame, kind and diagonal count, so it is computed
// once per signature with the same `templateFeaturesOf` + `linearB` (identical doubles), and only
// the requested stratum's sets are materialised. Same lists, same order, so every draw is unchanged.

/** Per SCALAR_RULES index (a 2-bit field): 1 for a progression / for the distribution. */
const prog2 = (r: number): number => (r === 1 || r === 2 ? 1 : 0)
const dist2 = (r: number): number => (r === 3 ? 1 : 0)
/** Rule type of a LAYOUT_RULES index: 0 none, 1 progression, 2 distribution, 3 arithmetic, 4 logic. */
const LAYOUT_TYPE = [0, 1, 1, 3, 3, 2, 4, 4, 2] as const
/** LAYOUT_RULES indices whose rule is direction-sensitive (count progression / arithmetic, xor, or). */
const LAYOUT_SENSITIVE = [false, true, true, true, true, false, true, true, false] as const
/** Frame pairs in `allHardRuleSets` order (shade outer, pattern inner); pattern type 2 = distribution. */
const FRAME_PAIRS: readonly (readonly [number, number])[] = SCALAR_RULES.flatMap((_, sh) => FRAME_PATTERN_RULES.map((_p, pa) => [sh, pa] as const))

/**
 * The bases in reference order as packed integers (built once, ≈ 16,000 entries, ~1 ms):
 * `code` = scalar indices (2 bits each, shape lowest) | layout << 8 | (frame pair + 1) << 12;
 * `counts` = n_progression | n_distribution << 4 | n_arithmetic << 8 | n_logic << 12;
 * `sensitive` = number of direction-sensitive groups.
 */
interface BaseTable {
  readonly code: Int32Array
  readonly counts: Int32Array
  readonly sensitive: Int8Array
  readonly length: number
}

let baseTable: BaseTable | null = null

function buildBaseTable(): BaseTable {
  const cap = 4 * 4 * 4 * 4 * LAYOUT_RULES.length * (1 + FRAME_PAIRS.length) + 1
  const code = new Int32Array(cap)
  const counts = new Int32Array(cap)
  const sensitive = new Int8Array(cap)
  let n = 0
  const emit = (a: number, b: number, c: number, d: number, l: number, f: number, pass: 0 | 1): void => {
    let np = 0
    let nd = 0
    let na = 0
    let nl = 0
    np += prog2(a) + prog2(b) + prog2(c) + prog2(d)
    nd += dist2(a) + dist2(b) + dist2(c) + dist2(d)
    const lt = LAYOUT_TYPE[l] as number
    if (lt === 1) np++
    else if (lt === 2) nd++
    else if (lt === 3) na++
    else if (lt === 4) nl++
    if (f >= 0) {
      const [sh, pa] = FRAME_PAIRS[f] as readonly [number, number]
      if (sh === 1 || sh === 2) np++
      else if (sh === 3) nd++
      if (pa === 1) nd++
    }
    const k = np + nd + na + nl
    const ok =
      pass === 0
        ? k >= 1 && k <= 4
        : f < 0
          ? k === 5
          : f > 0 && k >= HARD_FRAMED_MIN_RULES && k <= HARD_MAX_RULES // pair 0 is constant / constant
    if (!ok) return
    code[n] = a | (b << 2) | (c << 4) | (d << 6) | (l << 8) | ((f + 1) << 12)
    counts[n] = np | (nd << 4) | (na << 8) | (nl << 12)
    sensitive[n] = prog2(a) + prog2(c) + prog2(d) + (LAYOUT_SENSITIVE[l] ? 1 : 0)
    n++
  }
  for (let pass = 0 as 0 | 1; pass <= 1; pass++) {
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        for (let c = 0; c < 4; c++)
          for (let d = 0; d < 4; d++)
            for (let l = 0; l < LAYOUT_RULES.length; l++) {
              emit(a, b, c, d, l, -1, pass)
              if (pass === 1) for (let f = 0; f < FRAME_PAIRS.length; f++) emit(a, b, c, d, l, f, 1)
            }
  }
  return { code, counts, sensitive, length: n }
}

/** The rule set of a packed base code, with `diag` (bit i = scalar attribute i) turned diagonal. */
function rulesOfCode(code: number, diag = 0): RuleSet {
  const sc = (i: number): RuleSet['shape'] => ((diag >> i) & 1 ? DIAGONAL_RULE : SCALAR_RULES[(code >> (2 * i)) & 3]) as RuleSet['shape']
  const l = LAYOUT_RULES[(code >> 8) & 15] as (typeof LAYOUT_RULES)[number]
  const rules: RuleSet = { shape: sc(0), size: sc(1), color: sc(2), orientation: sc(3), count: l.count, position: l.position }
  const f = (code >> 12) - 1
  if (f < 0) return rules
  const [sh, pa] = FRAME_PAIRS[f] as readonly [number, number]
  return { ...rules, frame_shade: SCALAR_RULES[sh], frame_pattern: FRAME_PATTERN_RULES[pa] }
}

/**
 * The template candidates of one stratum as packed codes per kind: base code (`BaseTable.code`)
 * | diagonal mask (bit i = scalar attribute i) << 16. Decode one with {@link templateRulesOf}.
 */
export type TemplateCodes = ReadonlyMap<TemplateKind, Int32Array>

const templateCodeCache = new Map<Stratum, TemplateCodes>()

/** Decode a packed template candidate (see {@link TemplateCodes}). */
export function templateRulesOf(code: number): RuleSet {
  return rulesOfCode(code & 0xffff, code >>> 16)
}

/** Build one stratum's candidate codes by the fast walk (the comment above {@link LAYOUT_TYPE}). */
function buildTemplateCodes(stratum: Stratum): TemplateCodes {
  const out = new Map<TemplateKind, Int32Array>()
  if (!(TEMPLATE_STRATA as readonly number[]).includes(stratum)) return out
  baseTable ??= buildBaseTable()
  const t = baseTable
  const memo = new Map<number, boolean>()
  /** Whether a (counts, framed, kind, diagonals) signature lands in this stratum (b ≤ 3.9); memoised. */
  const keep = (counts: number, framed: boolean, kind: TemplateKind, nDiag: number): boolean => {
    const key = counts * 64 + (framed ? 32 : 0) + TEMPLATE_KINDS.indexOf(kind) * 4 + nDiag
    let hit = memo.get(key)
    if (hit === undefined) {
      const np = counts & 15
      const nd = (counts >> 4) & 15
      const na = (counts >> 8) & 15
      const nl = (counts >> 12) & 15
      const base = { n_rules: np + nd + na + nl, n_progression: np, n_distribution: nd, n_arithmetic: na, n_logic: nl }
      const b = clampPrior(linearB(MATRIX_DIR_PRIOR, { ...templateFeaturesOf(base, framed, kind, nDiag) }))
      hit = b <= TEMPLATE_MAX_B && stratumOfB(b) === stratum
      memo.set(key, hit)
    }
    return hit
  }
  const col: number[] = []
  const mixed: number[] = []
  const diagonal: number[] = []
  for (let i = 0; i < t.length; i++) {
    const code = t.code[i] as number
    const counts = t.counts[i] as number
    const framed = code >> 12 !== 0
    const sens = t.sensitive[i] as number
    if (sens >= 1 && keep(counts, framed, 'col', 0)) col.push(code)
    if (sens >= 2 && keep(counts, framed, 'mixed', 0)) mixed.push(code)
  }
  // Diagonal sets of [all-constant, ...bases]: one or two constant scalars turned diagonal, in reference order.
  for (let i = -1; i < t.length; i++) {
    const code = i < 0 ? 0 : (t.code[i] as number)
    const counts = i < 0 ? 0 : (t.counts[i] as number)
    const framed = code >> 12 !== 0
    const n = (counts & 15) + ((counts >> 4) & 15) + ((counts >> 8) & 15) + ((counts >> 12) & 15)
    const one = n + 1 <= HARD_MAX_RULES && keep(counts, framed, 'diagonal', 1)
    const two = n + 2 <= HARD_MAX_RULES && keep(counts, framed, 'diagonal', 2)
    if (!one && !two) continue
    const free: number[] = []
    for (let a = 0; a < 4; a++) if (((code >> (2 * a)) & 3) === 0) free.push(a)
    for (let x = 0; x < free.length; x++) {
      const fx = 1 << (free[x] as number)
      if (one) diagonal.push(code | (fx << 16))
      if (two) for (let y = x + 1; y < free.length; y++) diagonal.push(code | ((fx | (1 << (free[y] as number))) << 16))
    }
  }
  if (col.length > 0) out.set('col', Int32Array.from(col))
  if (mixed.length > 0) out.set('mixed', Int32Array.from(mixed))
  if (diagonal.length > 0) out.set('diagonal', Int32Array.from(diagonal))
  return out
}

/**
 * The 1.4.0 template candidates of a requested stratum 2–6 as packed codes by kind (kinds
 * without candidates are absent; empty for any other stratum). Built on first use per stratum
 * by a fast walk over rule indices (a few ms; no rule-set objects), entry by entry and in order
 * the lists of {@link referenceTemplatePools}. `gen.ts` draws an index and decodes one set.
 */
export function templateCodes(stratum: Stratum): TemplateCodes {
  let codes = templateCodeCache.get(stratum)
  if (codes === undefined) {
    codes = buildTemplateCodes(stratum)
    templateCodeCache.set(stratum, codes)
  }
  return codes
}

/** The candidates of a stratum as rule sets (decoded; for tests and tools, not the draw path). */
export function templatePool(stratum: Stratum): TemplatePool {
  return new Map([...templateCodes(stratum)].map(([k, codes]) => [k, Array.from(codes, templateRulesOf)]))
}

/**
 * True if a template set has one of the 1.4.0 template shapes (the verifier's structure check):
 * its base ({@link baseRuleSet}: diagonals read as constant, no directions) is a 1.2.0 set, a hard
 * candidate or (diagonal template only) the all-constant set; and
 * - column: no diagonal, every group `col`, a direction-sensitive group;
 * - mixed: no diagonal, two sensitive groups or more, one of them along the rows and one down the columns;
 * - diagonal: no directions, 1–2 diagonal attributes, at most {@link HARD_MAX_RULES} rules in all.
 */
export function isTemplateShape(rules: RuleSet): boolean {
  const base = baseRuleSet(rules)
  const n = nonConstantRules(base).length
  const baseOk = isHardRuleSet(base) || (!isFramed(base) && n <= 4)
  const nDiag = diagonalAttrs(rules).length
  if (!baseOk) return false
  if (nDiag > 0) return rules.directions === undefined && nDiag <= 2 && n + nDiag <= HARD_MAX_RULES
  if (n === 0) return false
  const sensitive = sensitiveGroups(rules)
  const kind = directionKind(rules)
  const dirs = sensitive.map((g) => rules.directions?.[g] ?? 'row')
  if (kind === 'col') return sensitive.length >= 1
  return kind === 'mixed' && dirs.includes('row') && dirs.includes('col')
}
