/**
 * Difficulty and time priors of the syllogism family (M1.P, DESIGN §6.ii, §7.4). [SPEC] v0, uncalibrated until M4;
 * the bank's `hb.gen.syllogism` uses the same numbers in the same order.
 *
 * b regression v0 (`linearB`; booleans count 0/1; every centre 0 except n_premises, centred at 2):
 *
 *     b = −2 + 0.10·conditional + 0.60·(n_premises − 2) + 0.30·negative_premises + 0.45·particular_premises
 *           + 0.35·bent_links + 0.30·scrambled + 0.70·could_true + 1.00·must_false + 0.25·key_particular
 *           + 0.20·key_negative + 0.35·key_conditional + 0.45·only_if + 0.50·unless + 0.30·either_or
 *           + 0.15·negated_literals
 *
 * Features (all recomputed by the verifier from the item's text):
 * - `conditional`: the everyday propositional template (vs made-up category words);
 * - `n_premises` (2–5): each extra statement is another step to hold and combine;
 * - categorical and chain: `negative_premises` (No / Some … not), `particular_premises` (Some), `bent_links` (the
 *   shared term is the subject of both premises or the predicate of both: figures 2 and 3, the harder ones in the
 *   syllogism literature), `scrambled` (the statements are not listed along the chain);
 * - the question: must be true < could be true (`could_true`) < must be false (`must_false`), the brief's order;
 * - the key: `key_particular` (a "Some" conclusion), `key_negative`, `key_conditional` (an "If …, then …" conclusion);
 * - conditional: `only_if`, `unless`, `either_or` (statements in those forms, the ones most often misread),
 *   `negated_literals` (each "not" inside a statement), `scrambled` (a plain fact is not listed last).
 * Informational features (not in the regression): `template`, `question`, `n_terms`, `figure`, `key_form`,
 * `inference_steps` (n_premises − 1), `distractor_types` (the sorted reasons of the four wrong options).
 *
 * Anchors: stratum 1 is "All A are B. All B are C." with a must-be-true question (b = −2.0) and the one-step
 * conditional (modus ponens, b = −1.9); a 5-statement chain with negative and particular statements and a
 * must-be-false question, or a 4-statement conditional with "only if" / "unless", reaches stratum 6 (b ≥ 2.5).
 *
 * Expected time v0: E[T] = `expectedTimeFromWords(words of the intro, statements, question and options)` (25 s + 4 s
 * per 50 words, §7.4) + 10 s per statement (reasoning): about 50 s for a two-statement syllogism and 90–100 s for a
 * five-statement chain, around the authored LR items' ~60 s. The shared cap max(180, ⌈2.5·E[T]⌉) then gives 180–250 s.
 */

import { SIGMA_B_DEFAULT, clampPrior, countWords, expectedTimeFromWords, linearB, type LinearPriorModel } from '../priors'
import type { Feature } from '../family'

/** [SPEC v0] The b regression (see the module comment). The term order is the bank's too. */
export const SYLLOGISM_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -2.0,
  terms: Object.freeze({
    conditional: { beta: 0.1, centre: 0 },
    n_premises: { beta: 0.6, centre: 2 },
    negative_premises: { beta: 0.3, centre: 0 },
    particular_premises: { beta: 0.45, centre: 0 },
    bent_links: { beta: 0.35, centre: 0 },
    scrambled: { beta: 0.3, centre: 0 },
    could_true: { beta: 0.7, centre: 0 },
    must_false: { beta: 1.0, centre: 0 },
    key_particular: { beta: 0.25, centre: 0 },
    key_negative: { beta: 0.2, centre: 0 },
    key_conditional: { beta: 0.35, centre: 0 },
    only_if: { beta: 0.45, centre: 0 },
    unless: { beta: 0.5, centre: 0 },
    either_or: { beta: 0.3, centre: 0 },
    negated_literals: { beta: 0.15, centre: 0 },
  }),
})

/** [SPEC v0] Seconds of reasoning per statement, on top of the §7.4 word term. */
export const SECONDS_PER_PREMISE = 10

export const SYLLOGISM_PROVENANCE =
  'syllogism v0 [SPEC]: b = -2 + 0.10*conditional + 0.60*(n_premises - 2) + 0.30*negative_premises + 0.45*particular_premises ' +
  '+ 0.35*bent_links + 0.30*scrambled + 0.70*could_true + 1.00*must_false + 0.25*key_particular + 0.20*key_negative ' +
  '+ 0.35*key_conditional + 0.45*only_if + 0.50*unless + 0.30*either_or + 0.15*negated_literals; uncalibrated until M4'

export const SYLLOGISM_SD_PRIOR = SIGMA_B_DEFAULT

export function syllogismBPrior(features: Readonly<Record<string, Feature>>): number {
  return clampPrior(linearB(SYLLOGISM_PRIOR, features))
}

/** E[T] of a spec: the §7.4 word term over every text shown, plus {@link SECONDS_PER_PREMISE} per statement. */
export function syllogismExpectedTime(spec: { readonly intro?: string; readonly premises: readonly string[]; readonly question: string; readonly options: readonly string[] }): number {
  const texts = [...(spec.intro === undefined ? [] : [spec.intro]), ...spec.premises, spec.question, ...spec.options]
  return expectedTimeFromWords(countWords(...texts)) + SECONDS_PER_PREMISE * spec.premises.length
}
