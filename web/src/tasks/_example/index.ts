/**
 * Toy family "a + b = ?" (two digits, four options), used ONLY by the family contract's own
 * tests (M1.F): it proves `runFamilyProperties`, the dump CLI and the bank cross-check work end
 * to end. It is never registered or served, and its prior is made up.
 *
 * It shows the whole contract in miniature: a stratum-targetable generator (stratum 1 = no
 * carry, stratum 2 = carry), an MC key `{ index }` kept out of the spec, a tiny structural
 * space (the unordered digit pair, so 55 families), A9 params (4 options → 3PL, c = 1/4) and a
 * verifier that recomputes everything from the item alone. Its Python twin is the bank's
 * `hb.gen._example`, which verifies this family's dump (`golden/ts_dumps/example.json`).
 */

import { defineFamily, verdict, type ItemInstance } from '../family'
import type { Stratum } from '../ids'
import {
  SIGMA_B_DEFAULT,
  clampPrior,
  countWords,
  expectedTimeFromWords,
  linearB,
  stratumOfB,
  type LinearPriorModel,
} from '../priors'

export interface ExampleSpec {
  /** The two digits shown as "a + b = ?". */
  readonly operands: readonly [number, number]
  /** Four distinct non-negative candidate sums in display order. */
  readonly options: readonly number[]
}

export interface ExampleKey {
  /** Index of the correct option. */
  readonly index: number
}

/** The chosen option index. */
export type ExampleResponse = number

export type ExampleItem = ItemInstance<ExampleSpec, ExampleKey>

/** Toy v0 prior: anchor b = −1.6, +1.0 for a carry (no carry → −2.1, stratum 1; carry → −1.1, stratum 2). */
export const EXAMPLE_PRIOR: LinearPriorModel = { anchorB: -1.6, terms: { carry: { beta: 1.0, centre: 0.5 } } }

export const EXAMPLE_OPTIONS = 4

const stem = (a: number, b: number): string => `${a} + ${b} = ?`

const isDigit = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9

export const example = defineFamily<ExampleSpec, ExampleKey, ExampleResponse>({
  name: 'example',
  axis: 'QR',
  facet: 'toy_sum',
  generatorVersion: '1.0.0',
  itemType: 'mc',
  strata: [1, 2],
  build(rng, ctx) {
    const stratum: Stratum = ctx.stratum ?? (rng.next() < 0.5 ? 1 : 2)
    let a = 0
    let b = 0
    do {
      a = rng.int(0, 9)
      b = rng.int(0, 9)
    } while ((a + b >= 10) !== (stratum === 2))
    const sum = a + b
    const candidates = [sum - 2, sum - 1, sum + 1, sum + 2, sum + 10].filter((x) => x >= 0)
    const options = rng.shuffle([sum, ...rng.shuffle(candidates).slice(0, EXAMPLE_OPTIONS - 1)])
    const features = { carry: sum >= 10, sum }
    const bPrior = clampPrior(linearB(EXAMPLE_PRIOR, features))
    if (stratumOfB(bPrior) !== stratum) throw new Error('example: prior and stratum disagree')
    return {
      stratum,
      spec: { operands: [a, b], options },
      key: { index: options.indexOf(sum) },
      structural_params: { pair: [Math.min(a, b), Math.max(a, b)] },
      options_count: EXAMPLE_OPTIONS,
      difficulty: {
        features,
        b_prior: bPrior,
        sd_prior: SIGMA_B_DEFAULT,
        provenance: 'toy prior for contract tests: anchor b = -1.6, +1.0 for a carry',
      },
      expected_time_s: expectedTimeFromWords(countWords(stem(a, b))),
      time_limit_s: 60,
    }
  },
  verify(item) {
    try {
      const { operands, options } = item.spec
      const [a, b] = operands
      if (!isDigit(a) || !isDigit(b) || operands.length !== 2) return verdict({ operands_are_two_digits: false })
      const sum = a + b
      const carry = sum >= 10
      const pair = item.structural_params as { pair?: unknown }
      return verdict({
        operands_are_two_digits: true,
        four_options: Array.isArray(options) && options.length === EXAMPLE_OPTIONS && item.options_count === EXAMPLE_OPTIONS,
        options_distinct: new Set(options).size === options.length,
        options_non_negative_integers: options.every((o) => Number.isInteger(o) && o >= 0),
        key_in_range: Number.isInteger(item.key.index) && item.key.index >= 0 && item.key.index < options.length,
        key_is_sum: options[item.key.index] === sum,
        unique_correct: options.filter((o) => o === sum).length === 1,
        structure_matches:
          JSON.stringify(pair) === JSON.stringify({ pair: [Math.min(a, b), Math.max(a, b)] }),
        features_match: item.difficulty.features.carry === carry && item.difficulty.features.sum === sum,
        stratum_matches: item.stratum === (carry ? 2 : 1),
      })
    } catch (e) {
      return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
    }
  },
  score(item, response) {
    return { correct: response === item.key.index ? 1 : 0 }
  },
})

/** The toy family's extra leak predicate: the spec may hold only the operands and the options. */
export function exampleSpecLeaksKey(item: ExampleItem): string | null {
  const extra = Object.keys(item.spec).filter((k) => k !== 'operands' && k !== 'options')
  return extra.length === 0 ? null : `unexpected spec fields: ${extra.join(', ')}`
}

export default example
