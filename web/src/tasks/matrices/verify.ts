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
 * - `features_match`, `prior_matches`, `stratum_matches`, `time_matches` (`prior.ts`).
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
import {
  MAX_RULES,
  MIN_RULES,
  OPTIONS_COUNT,
  cellEquals,
  countInRange,
  differingComponents,
  nonConstantRules,
  parseCell,
  parseRuleSet,
  type Cell,
  type MatrixKey,
  type MatrixSpec,
} from './grammar'
import { MODAL_TIE_READING, modalArgmax, modalPicksKeyUniquely } from './heuristic'
import { SIGMA_B_DEFAULT, bPriorOf, expectedTimeOf, featuresOf } from './prior'
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

export function verifyMatrix(item: MatrixItem): VerifyResult {
  try {
    const parsed = parseSpec(item.spec)
    if (typeof parsed === 'string') return verdict({ spec_well_formed: false, problem: parsed })
    const { visible, options } = parsed
    const index = item.key.index
    const keyInRange = Number.isInteger(index) && index >= 0 && index < options.length
    const keyed = keyInRange ? (options[index] as Cell) : null
    const sol = solve(visible)
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
    const inferred: Record<string, JsonValue> = Object.fromEntries(
      (['shape', 'size', 'color', 'orientation', 'count', 'positions'] as const).map((a) => [a, sol[a].fits.map((f) => f.rule)]),
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
        rules !== null && nRules >= MIN_RULES && nRules <= MAX_RULES && keyed !== null && violatedRules([...visible, keyed], rules).length === 0,
      features_match: features !== null && sameJson(d.features, features),
      prior_matches: features !== null && d.b_prior === bPrior && d.sd_prior === SIGMA_B_DEFAULT,
      stratum_matches: features !== null && item.stratum === stratumOfB(bPrior),
      time_matches: features !== null && item.expected_time_s === expectedTimeOf(nRules) && item.time_limit_s === powerTimeLimit(item.expected_time_s),
      method: 'rule_enumeration',
      predicted_cells: sol.predictedCells,
      consistent_rule_fits: sol.consistentRuleFits,
      inferred_rules: inferred,
      distractor_violations: violations.filter((_, i) => i !== index),
      modal_argmax: argmax,
      modal_tie_reading: MODAL_TIE_READING,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
