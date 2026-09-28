/**
 * Difficulty and time priors for matrices (ROADMAP M1.P, DESIGN §6.ii, §7.4).
 *
 * [SPEC] v0 regression on the rule structure, anchored at the ICAR matrix mean p = .52
 * (b = −logit(.52) ≈ −0.08, `ICAR_ANCHOR_B.matrix`), which stands for a typical 3-rule item:
 *
 *   b = −0.08 + 0.45·(n_progression − 1) + 0.75·(n_distribution − 1)
 *             + 1.05·(n_arithmetic − 0.5) + 1.05·(n_logic − 0.5)
 *
 * i.e. each non-constant rule adds 0.45 (progression), 0.75 (distribution-of-3) or 1.05
 * (arithmetic, xor/or), relative to the anchor's mix (1 progression, 1 distribution, ½ arithmetic,
 * ½ logic). The number of rules is the main driver and the type order follows Carpenter, Just &
 * Shell (1990): pairwise progression < distribution-of-3 < figure addition/subtraction and
 * distribution-of-two (xor). The weights are guesses to be replaced by M4 calibration; σ_b = 1.0.
 * They put 1 progression at b ≈ −1.9, two progressions (§14.6 example 1) at −1.4, the anchor mix
 * at −0.08 and the hardest 4-rule sets at ≈ 1.0, so the family spans strata 1–4. §14.6 example 1
 * says "b prior −1.2"; that figure is illustrative, and this v0 model gives it −1.43 (both in
 * stratum 2, "easy"). The model, not the example's figure, is the [SPEC] v0 value.
 *
 * Time ([SPEC] v0, §7.4 E[T]): 30 s for one rule + 10 s per further rule (30–60 s); a generous
 * 180 s cap for this power item (§13: no limits on power items beyond a generous cap).
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, POWER_TIME_LIMIT_S, SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import { allRuleSets, nonConstantRules, type RuleSet } from './grammar'

export const MATRIX_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.matrix,
  terms: Object.freeze({
    n_progression: Object.freeze({ beta: 0.45, centre: 1 }),
    n_distribution: Object.freeze({ beta: 0.75, centre: 1 }),
    n_arithmetic: Object.freeze({ beta: 1.05, centre: 0.5 }),
    n_logic: Object.freeze({ beta: 1.05, centre: 0.5 }),
  }),
})

export const MATRIX_PROVENANCE =
  '[SPEC] v0 matrices prior (M1.P): b = -0.08 (ICAR matrix p = .52) + 0.45(n_progression - 1) + ' +
  '0.75(n_distribution - 1) + 1.05(n_arithmetic - 0.5) + 1.05(n_logic - 0.5); rule-type order after ' +
  'Carpenter, Just & Shell (1990)'

export const EXPECTED_TIME_BASE_S = 30
export const EXPECTED_TIME_PER_RULE_S = 10
/** Hard time limit per item: the shared power-item cap (§13, {@link POWER_TIME_LIMIT_S}). */
export const TIME_LIMIT_S = POWER_TIME_LIMIT_S

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

/** Every rule set (1,655) grouped by the stratum of its prior b (`stratumOfB`). */
export const RULE_SETS_BY_STRATUM: ReadonlyMap<Stratum, readonly RuleSet[]> = (() => {
  const m = new Map<Stratum, RuleSet[]>()
  for (const rules of allRuleSets()) {
    const s = stratumOfB(bPriorOf(featuresOf(rules)))
    const list = m.get(s) ?? []
    list.push(rules)
    m.set(s, list)
  }
  return m
})()

/** The strata the family can target (every stratum with at least one rule set). */
export const MATRIX_STRATA: readonly Stratum[] = Object.freeze([...RULE_SETS_BY_STRATUM.keys()].sort((a, b) => a - b))
