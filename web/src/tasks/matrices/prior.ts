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
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import { allHardRuleSets, allRuleSets, isFramed, isHardRuleSet, nonConstantRules, type RuleSet } from './grammar'

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

export const MATRIX_PROVENANCE =
  '[SPEC] v0 matrices prior (M1.P): b = -0.08 (ICAR matrix p = .52, the pool mean) + 0.45(n_progression - 3230/1655) + ' +
  '0.75(n_distribution - 1790/1655) + 1.05(n_arithmetic - 350/1655) + 1.05(n_logic - 350/1655), centred at the rule-type ' +
  'means of the natural pool (rule sets uniform); rule-type order after Carpenter, Just & Shell (1990)'

export const MATRIX_HARD_PROVENANCE =
  MATRIX_PROVENANCE +
  '; hard templates (M3.12): + 0.35(n_extra_rules = rules beyond 4) + 0.60(two_components: an outer frame with its own rules), ' +
  'frame rules counted by type; rule-token load after Carpenter, Just & Shell (1990), component segmentation after Primi (2001)'

export const EXPECTED_TIME_BASE_S = 30
export const EXPECTED_TIME_PER_RULE_S = 10
/** E[T] added for the second (frame) component (M3.12). */
export const EXPECTED_TIME_FRAME_S = 15

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
  if (!isHardRuleSet(rules)) return base
  return { ...base, n_extra_rules: Math.max(0, types.length - 4), two_components: isFramed(rules) ? 1 : 0 }
}

/** True for the features of a hard-template rule set. */
export function isHardFeatures(features: MatrixFeatures): boolean {
  return features.two_components !== undefined
}

export function bPriorOf(features: MatrixFeatures): number {
  return clampPrior(linearB(isHardFeatures(features) ? MATRIX_HARD_PRIOR : MATRIX_PRIOR, { ...features }))
}

/** E[T] in seconds: 30 + 10·(n_rules − 1), + 15 with a frame (M3.12). */
export function expectedTimeOf(nRules: number, framed = false): number {
  return EXPECTED_TIME_BASE_S + EXPECTED_TIME_PER_RULE_S * (nRules - 1) + (framed ? EXPECTED_TIME_FRAME_S : 0)
}

/** E[T] of an item with these features. */
export function expectedTimeOfFeatures(features: MatrixFeatures): number {
  return expectedTimeOf(features.n_rules, features.two_components === 1)
}

/** The provenance string of an item with these features. */
export function provenanceOf(features: MatrixFeatures): string {
  return isHardFeatures(features) ? MATRIX_HARD_PROVENANCE : MATRIX_PROVENANCE
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
