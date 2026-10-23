/**
 * The syllogism verifier (G2/G3; DESIGN §4.1, §4.2 "formal logic: check validity with Z3 or a propositional truth
 * table"). Reached only through the verifier slot (`../verifier-slot.ts`), so it stays out of production chunks.
 *
 * It recomputes everything from the item alone: it reads the logic back from the words shown (`item.ts` `readSpec`:
 * every sentence must be one of the family's forms over its fixed word lists), then decides each option exactly
 * (`logic.ts`: categorical items by region emptiness over the 2ⁿ Venn regions, under the modern reading and with every
 * term non-empty; conditional items by their 2^m-row truth tables):
 *
 * - G2: the key answers the question under both readings;
 * - G3: every other option fails under both readings (so exactly one option answers, either way), each for a recorded
 *   reason (`distractor_types`, recomputed), the key needs the statements together (no single statement settles it),
 *   no option restates a statement or is equivalent to another option, no conditional option is true only by the
 *   material reading, and the option-only cue checks pass (the key is not the one longest or shortest option, not the
 *   one with or without a negation, and shares its terms with another option);
 * - structure: the statements form a chain over their terms (categorical), the stated structure, features, prior,
 *   stratum and E[T] match the recomputation.
 *
 * It never throws on a well-formed item: a malformed one fails with a reason.
 */

import { canonicalJson } from '../ids'
import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { stratumOfB } from '../priors'
import { cueChecks, featuresOf, readSpec } from './item'
import { NONCE_WORDS, plural } from './lexicon'
import {
  answers,
  catSat,
  condSat,
  distractorType,
  equivalent,
  isPath,
  isVacuousConditional,
  needsCombination,
  negates,
  statusOf,
  structureOf,
  termsOf,
  type CatStatement,
  type CondStatement,
  type Statement,
} from './logic'
import { SYLLOGISM_PROVENANCE, SYLLOGISM_SD_PRIOR, syllogismBPrior, syllogismExpectedTime } from './prior'
import { SYLLOGISM_OPTIONS, specProblems, type SyllogismKey, type SyllogismSpec } from './spec'

const PLURALS: ReadonlySet<string> = new Set(NONCE_WORDS.map(plural))

export function verifySyllogism(item: ItemInstance<SyllogismSpec, SyllogismKey>): VerifyResult {
  try {
    const problems = specProblems(item.spec)
    if (problems.length > 0) return verdict({ spec_drawable: false, problems })
    const k = item.key.index
    if (!(Number.isInteger(k) && k >= 0 && k < SYLLOGISM_OPTIONS && item.options_count === SYLLOGISM_OPTIONS)) {
      return verdict({ spec_drawable: true, key_in_range: false })
    }
    const read = readSpec(item.spec)
    if (typeof read === 'string') return verdict({ spec_drawable: true, key_in_range: true, reads_back: false, reason: read })
    const { template, question, logic } = read
    const options = logic.options as readonly Statement[]
    const premises = logic.premises as readonly Statement[]
    const key = options[k] as Statement
    const verdicts = options.map((s) => {
      const st = statusOf(logic, s)
      return [answers(question, st, 0), answers(question, st, 1)] as const
    })
    const types = options.flatMap((s, i) => (i === k ? [] : [distractorType(logic, key, s)]))

    let shape: boolean
    let consistent: boolean
    let unlinked = true
    let noVacuous = true
    let initials = true
    let unlessPositive = true
    let formsInPlace = true
    if (logic.kind === 'cat') {
      const ps = logic.premises
      const nP = ps.length
      shape = isPath(logic.n, ps) && (template === 'categorical' ? nP === 2 : nP >= 3 && nP <= 5)
      consistent = catSat(logic.n, ps, 0) && catSat(logic.n, ps, 1)
      const linked = new Set(ps.map((p) => termsOf(p).join(',')))
      unlinked = !linked.has(termsOf(key as CatStatement).join(','))
      const words = new Set(item.spec.premises.flatMap((t) => t.split(' ').map((w) => w.replace(/\.$/, '')).filter((w) => PLURALS.has(w))))
      initials = words.size === logic.n && new Set([...words].map((w) => w[0])).size === words.size
    } else {
      const ps = logic.premises
      // 2–4 statements; the options may name one proposition the statements do not (an unsupported claim).
      const used = new Set(ps.flatMap((p) => termsOf(p)))
      shape = ps.length >= 2 && ps.length <= 4 && used.size >= 2 && logic.n - used.size <= 1
      consistent = condSat(logic.n, ps, undefined, 0) && condSat(logic.n, ps, undefined, 1)
      noVacuous = options.every((s) => !isVacuousConditional(logic.n, ps, s as CondStatement))
      unlessPositive = ps.every((p) => p.form !== 'unless' || !p.b.neg)
      formsInPlace = ps.every((p) => p.form !== 'and') && options.every((s) => ['fact', 'if', 'and'].includes((s as CondStatement).form))
    }
    let pairwise = new Set(item.spec.options).size === options.length
    for (let i = 0; i < options.length && pairwise; i++) {
      for (let j = i + 1; j < options.length; j++) {
        if (equivalent(logic, options[i] as Statement, options[j] as Statement)) {
          pairwise = false
          break
        }
      }
    }
    const features = featuresOf(read, k, types)
    const bPrior = syllogismBPrior(features)
    const d = item.difficulty
    return verdict({
      spec_drawable: true,
      key_in_range: true,
      reads_back: true,
      premises_form_the_template: shape,
      words_have_distinct_initials: initials,
      unless_clause_positive: unlessPositive,
      forms_in_place: formsInPlace,
      premises_consistent: consistent,
      key_answers_both_readings: verdicts[k]?.every((v) => v) === true,
      distractors_fail_both_readings: verdicts.every((v, i) => i === k || v.every((x) => !x)),
      unique_answer: ([0, 1] as const).every((r) => verdicts.filter((v) => v[r]).length === 1),
      key_needs_combination: needsCombination(logic, question, key),
      key_terms_not_a_premise_pair: unlinked,
      options_not_premises: options.every((s) => premises.every((p) => !equivalent(logic, s, p))),
      options_pairwise_distinct: pairwise,
      no_option_negates_key: options.every((s, i) => i === k || !negates(logic, s, key)),
      no_vacuous_conditionals: noVacuous,
      ...cueChecks(item.spec.options, options, k),
      structure_matches: canonicalJson(structureOf(template, question, logic, key)) === canonicalJson(item.structural_params),
      features_match: canonicalJson(features) === canonicalJson(d.features),
      prior_matches: d.b_prior === bPrior && d.sd_prior === SYLLOGISM_SD_PRIOR && d.provenance === SYLLOGISM_PROVENANCE,
      stratum_matches: item.stratum === stratumOfB(bPrior),
      time_matches: item.expected_time_s === syllogismExpectedTime(item.spec),
      template,
      question,
      option_verdicts: verdicts.map((v) => [v[0], v[1]]),
      distractor_types: types,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
