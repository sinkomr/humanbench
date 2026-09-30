/**
 * Worked examples for the reveal (DESIGN §10: "at the end, reveal performance per axis, plus 3
 * procedural items with worked solutions"; ROADMAP M1.R). Each example is a fresh, uncounted
 * item of a procedural family with its solution written out step by step.
 *
 * A solution is derived from the item's own content (spec, structure, key) and is tested against
 * the family's key over thousands of generated items, so a step can never say something the key
 * contradicts. The examples are shown only after the session, so the key may be read here; they
 * are not counted and not scored.
 */

import type { ItemInstance } from '../../tasks/family'

/** The three kinds of worked example (one item of each is shown). */
export type WorkedKind = 'matrix' | 'series' | 'quant'

export const WORKED_KINDS: readonly WorkedKind[] = Object.freeze(['matrix', 'series', 'quant'] as const)

export interface WorkedSolution {
  /** The reasoning, one short paragraph per step. */
  readonly steps: readonly string[]
  /** The answer as the person would enter it (a matrix option is its letter). */
  readonly answer: string
  /**
   * The answer in the key's own form, for the test against the family's key: a canonical rational
   * ("42", "-7", "3/8"), a letter, or an option index ("2").
   */
  readonly exact: string
}

export interface WorkedItem {
  readonly kind: WorkedKind
  /** "Matrix", "Number series", "Quantitative". */
  readonly title: string
  readonly item: ItemInstance<object, object>
  readonly solution: WorkedSolution
}
