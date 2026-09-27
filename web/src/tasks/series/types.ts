/** Item shapes of the series family (DESIGN §4.2 "Series", §12; ROADMAP M1.7). */

import type { ItemInstance } from '../family'
import type { Coefficients, RuleName } from './rules'

/** Render payload: the visible terms and how the response is entered. */
export type SeriesSpec =
  | { readonly input_format: 'integer'; readonly terms: readonly number[] }
  | { readonly input_format: 'letter'; readonly terms: readonly string[] }

/** The next term: an exact integer (tol 0), or an uppercase letter A–Z. */
export type SeriesKey = { readonly value: number; readonly tol: 0 } | { readonly letter: string }

/** A typed integer, or text such as "42", "−7" or "k" (letters are case-insensitive). */
export type SeriesResponse = number | string

/** `structural_params`: the key rule family and its coefficients without start terms (A11). */
export interface SeriesStructure {
  readonly rule: RuleName
  readonly coefficients: Coefficients
}

export type SeriesItem = ItemInstance<SeriesSpec, SeriesKey>
