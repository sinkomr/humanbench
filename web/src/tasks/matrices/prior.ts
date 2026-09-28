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
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import { allRuleSets, nonConstantRules, type RuleSet } from './grammar'

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

export const MATRIX_PROVENANCE =
  '[SPEC] v0 matrices prior (M1.P): b = -0.08 (ICAR matrix p = .52, the pool mean) + 0.45(n_progression - 3230/1655) + ' +
  '0.75(n_distribution - 1790/1655) + 1.05(n_arithmetic - 350/1655) + 1.05(n_logic - 350/1655), centred at the rule-type ' +
  'means of the natural pool (rule sets uniform); rule-type order after Carpenter, Just & Shell (1990)'

export const EXPECTED_TIME_BASE_S = 30
export const EXPECTED_TIME_PER_RULE_S = 10

/** Named inputs of the v0 prior (`difficulty.features`). */
export interface MatrixFeatures {
  readonly n_rules: number
  readonly n_progression: number
  readonly n_distribution: number
  readonly n_arithmetic: number
  readonly n_logic: number
}

export function featuresOf(rules: RuleSet): MatrixFeatures {
  const types = nonConstantRules(rules)
  const n = (t: string): number => types.filter((x) => x === t).length
  return {
    n_rules: types.length,
    n_progression: n('progression'),
    n_distribution: n('distribution'),
    n_arithmetic: n('arithmetic'),
    n_logic: n('logic'),
  }
}

export function bPriorOf(features: MatrixFeatures): number {
  return clampPrior(linearB(MATRIX_PRIOR, { ...features }))
}

/** E[T] in seconds: 30 + 10·(n_rules − 1). */
export function expectedTimeOf(nRules: number): number {
  return EXPECTED_TIME_BASE_S + EXPECTED_TIME_PER_RULE_S * (nRules - 1)
}

export { SIGMA_B_DEFAULT }

/** Every rule set (1,655), in enumeration order: the natural pool draws uniformly from it (M1.P). */
export const ALL_RULE_SETS: readonly RuleSet[] = Object.freeze(allRuleSets())

/** Every rule set (1,655) grouped by the stratum of its prior b (`stratumOfB`). */
export const RULE_SETS_BY_STRATUM: ReadonlyMap<Stratum, readonly RuleSet[]> = (() => {
  const m = new Map<Stratum, RuleSet[]>()
  for (const rules of ALL_RULE_SETS) {
    const s = stratumOfB(bPriorOf(featuresOf(rules)))
    const list = m.get(s) ?? []
    list.push(rules)
    m.set(s, list)
  }
  return m
})()

/** The strata the family can target (every stratum with at least one rule set). */
export const MATRIX_STRATA: readonly Stratum[] = Object.freeze([...RULE_SETS_BY_STRATUM.keys()].sort((a, b) => a - b))
