/**
 * Option-only heuristic for matrices (DESIGN §4.2; ROADMAP M1.6): the modal-attribute picker.
 *
 * It sees only the six options. For each attribute (shape, count, size, color, orientation,
 * position set) the *modal* values are those shared by the most options (all tied values count
 * as modal); an option scores one point per attribute whose value is modal, and the picker
 * chooses uniformly among the options with the top score. RPM-style sets whose distractors each
 * change one attribute of the key make the key the unique winner every time; the RAVEN-FAIR tree
 * (`gen.ts`) avoids that. Requirements: per item, the key is never the *unique* top scorer
 * (`verify`); over 10k items, the picker's hit rate is ≤ 1.5 × chance = 25% (the property test).
 */

import { popcount, type Cell } from './grammar'

export const PICKER_ATTRS = Object.freeze(['shape', 'count', 'size', 'color', 'orientation', 'position'] as const)
export type PickerAttr = (typeof PICKER_ATTRS)[number]

function valueOf(c: Cell, attr: PickerAttr): number {
  if (attr === 'count') return popcount(c.positions)
  if (attr === 'position') return c.positions
  return c[attr]
}

/** Per option, the number of attributes whose value is modal among the options. */
export function modalScores(options: readonly Cell[]): number[] {
  const scores = options.map(() => 0)
  for (const attr of PICKER_ATTRS) {
    const counts = new Map<number, number>()
    for (const o of options) counts.set(valueOf(o, attr), (counts.get(valueOf(o, attr)) ?? 0) + 1)
    const top = Math.max(...counts.values())
    options.forEach((o, i) => {
      if (counts.get(valueOf(o, attr)) === top) scores[i] = (scores[i] as number) + 1
    })
  }
  return scores
}

/** Indices of the options the picker may choose (the top scorers), ascending. */
export function modalArgmax(options: readonly Cell[]): number[] {
  const scores = modalScores(options)
  const best = Math.max(...scores)
  return scores.flatMap((s, i) => (s === best ? [i] : []))
}

/** P(the picker chooses option `key`) with uniform tie-breaking. */
export function modalHitProbability(options: readonly Cell[], key: number): number {
  const top = modalArgmax(options)
  return top.includes(key) ? 1 / top.length : 0
}

/** True if the picker identifies `key` with certainty (the unique top scorer): such items are rejected. */
export function modalPicksKeyUniquely(options: readonly Cell[], key: number): boolean {
  const top = modalArgmax(options)
  return top.length === 1 && top[0] === key
}
