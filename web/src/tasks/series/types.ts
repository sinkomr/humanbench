/** Item shapes of the series family (DESIGN §4.2 "Series", §12; ROADMAP M1.7). */

import type { EntryFormat, ItemInstance, NumericKey } from '../family'
import type { Coefficients, RuleName } from './rules'

/** Render payload: the visible terms and how the response is entered (the shared {@link EntryFormat}s). */
export type SeriesSpec =
  | { readonly input_format: Extract<EntryFormat, 'integer'>; readonly terms: readonly number[] }
  | { readonly input_format: Extract<EntryFormat, 'letter'>; readonly terms: readonly string[] }

/**
 * The next term: the shared {@link NumericKey} with an exact integer (`{ value: "-48", tol: { abs: 0 } }`),
 * or an uppercase letter A–Z (`{ letter: "K" }`).
 */
export type SeriesKey = (NumericKey & { readonly tol: { readonly abs: 0 } }) | { readonly letter: string }

/** A typed integer, or text such as "42", "−7" or "k" (letters are case-insensitive). */
export type SeriesResponse = number | string

/**
 * `structural_params`: the key rule family and its coefficients without start terms (A11), and
 * `letters: true` on a letter series whose rule is an integer family (generator 1.5.0; a series
 * of the rule `letter` is a letter series by definition and carries no flag).
 */
export interface SeriesStructure {
  readonly rule: RuleName
  readonly coefficients: Coefficients
  readonly letters?: true
}

export type SeriesItem = ItemInstance<SeriesSpec, SeriesKey>
