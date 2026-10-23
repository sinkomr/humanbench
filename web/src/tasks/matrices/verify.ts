/**
 * Matrices verifier (gates G2/G3, DESIGN §4.1–4.2; ROADMAP M1.6). Recomputes everything from the
 * item alone; the §14.6 example 1 `verification` record is the model for `checks`.
 *
 * Checks (all must hold):
 * - `spec_well_formed`: grid rows of 3, 3 and 2 cells and valid cells (`parseCell`);
 * - `six_options`, `key_in_range`;
 * - `counts_in_range`: every grid cell and option holds 1–4 objects (DESIGN §4.2 count range);
 * - `rules_consistent`: some rule of every attribute fits the 8 visible cells;
 * - `unique_prediction`: every consistent rule assignment predicts the same 9th cell (`solve`);
 * - `key_matches_prediction`, `unique_correct` (exactly one option is the predicted cell),
 *   `options_distinct`;
 * - `distractors_violate_rules`: every other option breaks at least one declared rule;
 * - `options_form_tree`: the options are connected by one-component changes (RAVEN-FAIR tree);
 * - `modal_heuristic_not_unique`: the option-only modal picker (all-ties reading of mode ties,
 *   `heuristic.ts`) does not single out the key;
 * - `structure_matches`: `structural_params` is a rule set with 1–4 non-constant rules, and each
 *   declared rule holds along the rows of the grid completed by the keyed option;
 * - `features_match`, `prior_matches`, `stratum_matches`, `time_matches` (`prior.ts`);
 * - `frames_consistent`: every cell (grid and options) has a frame, or none does, and the cells
 *   are framed exactly when the rule set has frame rules (M3.12).
 *
 * Hard items (rule sets of the M3.12 templates, `isHardRuleSet`; strata 5–6) also need:
 * - `structure_matches` with a hard rule set whose prior is in stratum 5 or 6;
 * - `distractors_are_lures`: every distractor differs from the key in 1–3 ruled
 *   components, each set to one of the key's lure values (`gen.ts` `lureValues`);
 * - `hub_heuristic_not_unique`: the option-only hub picker (`heuristic.ts`) does not single out
 *   the key. Informational: `hub_argmax`.
 *
 * Generator 1.4.0 (directions and diagonals). Every 1.4.0 item is solved with the diagonal rule
 * too (`solve(visible, true)`); 1.2.0/1.3.0 items without it (the version comes from the item,
 * or the family passes its own). Template items (`isTemplateRuleSet`: `directions` or a
 * diagonal rule) also need:
 * - `structure_matches` with a template shape (`prior.ts` `isTemplateShape`), stratum 2–6, every
 *   declared rule holding in its declared direction (or on the diagonals) on the keyed grid; a
 *   template set on a 1.2.0/1.3.0 item fails it;
 * - `directions_needed`: the declared direction is needed (`gen.ts` `directionsNeeded`);
 * - `no_second_reading`: no simple line rule (or copy) holds on two complete lines of a ruled
 *   attribute, either way, and is broken or completed otherwise by the third (`gen.ts` `noSecondReading`);
 * - `distractors_are_lures` and `hub_heuristic_not_unique` when the set takes lures (hard-sized or
 *   diagonal, `takesLures`).
 * Informational: `declared_directions` (each group's `row` / `col`, a diagonal attribute's
 * `diagonal`) and `analysis` (`rows_columns`, or `rows_columns_diagonals` for 1.4.0).
 *
 * Informational: `predicted_cells` (distinct 9th cells the consistent rule assignments predict;
 * 1 for a unique item, the §14.6 `consistent_rule_sets: 1`), `consistent_rule_fits` (all
 * consistent (rule, direction) assignments, row and column fits counted separately),
 * `inferred_rules`, `distractor_violations`, `modal_argmax`, and `modal_tie_reading` (`all_ties`:
 * the M1.6 reading of mode ties that the picker checks use).
 */

import type { JsonValue } from '../../engine'
import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { powerTimeLimit, stratumOfB } from '../priors'
import { MAX_LURE_CHANGES, directionsNeeded, lureValues, noSecondReading, ruledComponents, takesLures, usesDiagonalAnalysis } from './gen'
import {
  MAX_RULES,
  MIN_RULES,
  OPTIONS_COUNT,
  cellEquals,
  componentValue,
  countInRange,
  differingComponents,
  hasFrame,
  isFramed,
  isHardRuleSet,
  isTemplateRuleSet,
  diagonalAttrs,
  directionOf,
  groupsOf,
  nonConstantRules,
  parseCell,
  parseRuleSet,
  type Cell,
  type MatrixKey,
  type MatrixSpec,
  type RuleSet,
} from './grammar'
import { MODAL_TIE_READING, hubArgmax, hubPicksKeyUniquely, modalArgmax, modalPicksKeyUniquely } from './heuristic'
import {
  HARD_MIN_STRATUM,
  SIGMA_B_DEFAULT,
  TEMPLATE_STRATA,
  bPriorOf,
  expectedTimeOfFeatures,
  featuresOf,
  isTemplateShape,
  provenanceOf,
} from './prior'
import { solve, violatedRules } from './solver'

export type MatrixItem = ItemInstance<MatrixSpec, MatrixKey>

const ROW_LENGTHS = [3, 3, 2]

/** The 8 visible cells (row-major) and the options, or a description of what is malformed. */
export function parseSpec(spec: unknown): { visible: Cell[]; options: Cell[] } | string {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return 'spec must be an object'
  const s = spec as Record<string, unknown>
  if (Object.keys(s).sort().join(',') !== 'grid,options') return 'spec has exactly the fields grid, options'
  const grid = s.grid
  if (!Array.isArray(grid) || grid.length !== 3 || !grid.every((r, i) => Array.isArray(r) && r.length === ROW_LENGTHS[i])) {
    return 'grid must be rows of 3, 3 and 2 cells'
  }
  if (!Array.isArray(s.options)) return 'options must be an array'
  const visible: Cell[] = []
  for (const cell of (grid as unknown[][]).flat()) {
    const c = parseCell(cell)
    if (typeof c === 'string') return `grid: ${c}`
    visible.push(c)
  }
  const options: Cell[] = []
  for (const cell of s.options as unknown[]) {
    const c = parseCell(cell)
    if (typeof c === 'string') return `options: ${c}`
    options.push(c)
  }
  return { visible, options }
}

/** True if every option is reachable from every other through one-component changes. */
export function formsOneChangeTree(options: readonly Cell[]): boolean {
  if (options.length === 0) return false
  const seen = new Set<number>([0])
  const stack = [0]
  while (stack.length > 0) {
    const i = stack.pop() as number
    options.forEach((o, j) => {
      if (!seen.has(j) && differingComponents(options[i] as Cell, o).length === 1) {
        seen.add(j)
        stack.push(j)
      }
    })
  }
  return seen.size === options.length
}

const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)

/**
 * True if every distractor differs from `key` in 1–{@link MAX_LURE_CHANGES} ruled components, each
 * holding one of the key's lure values (M3.12 hard items).
 */
export function distractorsAreLures(options: readonly Cell[], index: number, key: Cell, visible: readonly Cell[], rules: RuleSet): boolean {
  const ruled = ruledComponents(rules)
  return options.every((o, i) => {
    if (i === index) return true
    const diff = differingComponents(key, o)
    if (diff.length < 1 || diff.length > MAX_LURE_CHANGES) return false
    return diff.every((c) => ruled.includes(c) && lureValues(c, key, visible, rules).includes(componentValue(o, c)))
  })
}

/**
 * The rule set's shape and stratum: 1.2.0 sets 1–4 rules; hard sets as `isHardRuleSet` says, in
 * stratum 5–6; 1.4.0 templates (`diagonal` analysis only) as `isTemplateShape` says, in 2–6.
 */
function structureOk(rules: RuleSet, nRules: number, stratum: number, diagonal: boolean): boolean {
  if (isTemplateRuleSet(rules)) return diagonal && isTemplateShape(rules) && (TEMPLATE_STRATA as readonly number[]).includes(stratum)
  if (isHardRuleSet(rules)) return stratum >= HARD_MIN_STRATUM
  return !isFramed(rules) && nRules >= MIN_RULES && nRules <= MAX_RULES
}

/** Each group's declared direction, and `diagonal` for a diagonal attribute (informational). */
function declaredDirections(rules: RuleSet): Record<string, JsonValue> {
  const diag = diagonalAttrs(rules) as string[]
  return Object.fromEntries(groupsOf(rules).map((g) => [g, diag.includes(g) ? 'diagonal' : directionOf(rules, g)]))
}

/**
 * Verify a matrices item. `version`: the generator version whose analysis applies (the item's own
 * by default): 1.4.0 and later solve with the diagonal rule too, 1.2.0/1.3.0 without it.
 */
export function verifyMatrix(item: MatrixItem, version: string = item.generator_version): VerifyResult {
  try {
    const diagonal = usesDiagonalAnalysis(version)
    const parsed = parseSpec(item.spec)
    if (typeof parsed === 'string') return verdict({ spec_well_formed: false, problem: parsed })
    const { visible, options } = parsed
    const index = item.key.index
    const keyInRange = Number.isInteger(index) && index >= 0 && index < options.length
    const keyed = keyInRange ? (options[index] as Cell) : null
    const sol = solve(visible, diagonal)
    const predicted = sol.cell
    const correct = predicted ? options.filter((o) => cellEquals(o, predicted)).length : 0
    const distinct = options.every((o, i) => options.every((p, j) => j <= i || !cellEquals(o, p)))

    const rules = parseRuleSet(item.structural_params)
    const nRules = rules ? nonConstantRules(rules).length : 0
    const violations: string[][] = options.map((o, i) =>
      i === index || rules === null ? [] : violatedRules([...visible, o], rules),
    )
    const distractorsViolate =
      rules !== null && keyed !== null && options.every((o, i) => i === index || (!cellEquals(o, keyed) && (violations[i] as string[]).length > 0))

    const d = item.difficulty
    const features = rules ? featuresOf(rules) : null
    const bPrior = features ? bPriorOf(features) : Number.NaN
    const argmax = modalArgmax(options)
    const cells = [...visible, ...options]
    const framedCells = cells.filter(hasFrame).length
    const framesConsistent = (framedCells === 0 || framedCells === cells.length) && rules !== null && isFramed(rules) === framedCells > 0
    const template = rules !== null && isTemplateRuleSet(rules)
    const hard = rules !== null && (template ? takesLures(rules) : isHardRuleSet(rules))
    const hardChecks: Record<string, JsonValue> = hard
      ? {
          distractors_are_lures: keyed !== null && predicted !== null && distractorsAreLures(options, index, keyed, visible, rules),
          hub_heuristic_not_unique: keyInRange && !hubPicksKeyUniquely(options, index),
        }
      : {}
    const templateChecks: Record<string, JsonValue> = template
      ? { directions_needed: directionsNeeded(sol, rules), no_second_reading: keyed !== null && noSecondReading(visible, keyed, rules) }
      : {}
    const inferred: Record<string, JsonValue> = Object.fromEntries(
      (['shape', 'size', 'color', 'orientation', 'count', 'positions', 'frameShade', 'framePattern'] as const).flatMap((a) => {
        const fits = sol[a]?.fits
        return fits === undefined ? [] : [[a, fits.map((f) => f.rule)]]
      }),
    )
    return verdict({
      spec_well_formed: true,
      six_options: options.length === OPTIONS_COUNT && item.options_count === OPTIONS_COUNT,
      key_in_range: keyInRange,
      counts_in_range: [...visible, ...options].every(countInRange),
      rules_consistent: sol.consistent,
      unique_prediction: sol.unique,
      key_matches_prediction: keyed !== null && predicted !== null && cellEquals(keyed, predicted),
      unique_correct: correct === 1,
      options_distinct: distinct,
      distractors_violate_rules: distractorsViolate,
      options_form_tree: formsOneChangeTree(options),
      modal_heuristic_not_unique: keyInRange && !modalPicksKeyUniquely(options, index),
      structure_matches:
        rules !== null &&
        features !== null &&
        structureOk(rules, nRules, stratumOfB(bPrior), diagonal) &&
        keyed !== null &&
        violatedRules([...visible, keyed], rules).length === 0,
      frames_consistent: framesConsistent,
      ...hardChecks,
      ...templateChecks,
      features_match: features !== null && sameJson(d.features, features),
      prior_matches: features !== null && d.b_prior === bPrior && d.sd_prior === SIGMA_B_DEFAULT && d.provenance === provenanceOf(features),
      stratum_matches: features !== null && item.stratum === stratumOfB(bPrior),
      time_matches:
        features !== null && item.expected_time_s === expectedTimeOfFeatures(features) && item.time_limit_s === powerTimeLimit(item.expected_time_s),
      method: 'rule_enumeration',
      analysis: diagonal ? 'rows_columns_diagonals' : 'rows_columns',
      ...(rules !== null ? { declared_directions: declaredDirections(rules) } : {}),
      predicted_cells: sol.predictedCells,
      consistent_rule_fits: sol.consistentRuleFits,
      inferred_rules: inferred,
      distractor_violations: violations.filter((_, i) => i !== index),
      modal_argmax: argmax,
      modal_tie_reading: MODAL_TIE_READING,
      ...(hard ? { hub_argmax: hubArgmax(options) } : {}),
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
