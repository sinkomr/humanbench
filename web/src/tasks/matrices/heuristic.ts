/**
 * Option-only heuristic for matrices (DESIGN §4.2; ROADMAP M1.6): the modal-attribute picker.
 *
 * It sees only the six options. For each attribute (shape, count, size, color, orientation,
 * position set) it takes the most common value among the options; an option scores one point per
 * attribute whose value is that mode, and the picker chooses uniformly among the options with the
 * top score. RPM-style sets whose distractors each change one attribute of the key make the key
 * the unique winner every time; the RAVEN-FAIR tree (`gen.ts`) avoids that.
 *
 * Mode ties. "The most common value" is ambiguous when several values tie for the mode. The M1.6
 * interpretation is the *all-ties* reading ({@link modalScores}): every value tied for the mode is
 * modal. The *one-mode* reading ({@link oneModeTops}: one tied value per attribute, uniformly at
 * random, each combination an equally likely outcome) is covered too:
 * - per item, the gate rejects the key as the unique all-ties top scorer
 *   ({@link modalPicksKeyUniquely}). That also rules out a one-mode picker that is *certain* to
 *   find the key ({@link oneModeCertain}): for any other option j, the outcome that takes j's value
 *   wherever it is tied (and the key's elsewhere) gives j its all-ties score and the key at most
 *   its own, so "key unique in every outcome" implies "key unique under all-ties". A per-item gate
 *   on "key unique in *some* outcome" is not used: it keeps almost only sets where the key scores
 *   below the top, which an anti-modal picker would exploit;
 * - over 10k items, the hit rate under either reading is ≤ 1.5 × chance = 25% (property test).
 */

import { popcount, type Cell } from './grammar'

export const PICKER_ATTRS = Object.freeze(['shape', 'count', 'size', 'color', 'orientation', 'position'] as const)
export type PickerAttr = (typeof PICKER_ATTRS)[number]

/** The M1.6 reading of mode ties, recorded in the verification checks (`modal_tie_reading`). */
export const MODAL_TIE_READING = 'all_ties'

function valueOf(c: Cell, attr: PickerAttr): number {
  if (attr === 'count') return popcount(c.positions)
  if (attr === 'position') return c.positions
  return c[attr]
}

/** Per attribute (in {@link PICKER_ATTRS} order), the values tied for the mode among the options, ascending. */
export function modalValues(options: readonly Cell[]): number[][] {
  return PICKER_ATTRS.map((attr) => {
    const counts = new Map<number, number>()
    for (const o of options) counts.set(valueOf(o, attr), (counts.get(valueOf(o, attr)) ?? 0) + 1)
    const top = Math.max(0, ...counts.values())
    return [...counts].flatMap(([v, n]) => (n === top ? [v] : [])).sort((a, b) => a - b)
  })
}

/** Per option, the number of attributes whose value is in `modes` (the accepted values per attribute). */
function scoresFor(options: readonly Cell[], modes: readonly (readonly number[])[]): number[] {
  return options.map((o) =>
    PICKER_ATTRS.reduce((s, attr, k) => s + ((modes[k] as readonly number[]).includes(valueOf(o, attr)) ? 1 : 0), 0),
  )
}

function argmax(scores: readonly number[]): number[] {
  const best = Math.max(...scores)
  return scores.flatMap((s, i) => (s === best ? [i] : []))
}

/** All-ties reading: per option, the number of attributes whose value is tied for the mode. */
export function modalScores(options: readonly Cell[]): number[] {
  return scoresFor(options, modalValues(options))
}

/** Indices of the options the all-ties picker may choose (the top scorers), ascending. */
export function modalArgmax(options: readonly Cell[]): number[] {
  return argmax(modalScores(options))
}

/** P(the all-ties picker chooses option `key`) with uniform tie-breaking among the top scorers. */
export function modalHitProbability(options: readonly Cell[], key: number): number {
  const top = modalArgmax(options)
  return top.includes(key) ? 1 / top.length : 0
}

/** True if the all-ties picker identifies `key` with certainty (the unique top scorer). */
export function modalPicksKeyUniquely(options: readonly Cell[], key: number): boolean {
  const top = modalArgmax(options)
  return top.length === 1 && top[0] === key
}

/**
 * One-mode reading: the top-scorer set of every combination of one modal value per attribute
 * (the combinations are equally likely). Empty for no options.
 */
export function oneModeTops(options: readonly Cell[]): number[][] {
  if (options.length === 0) return []
  const tied = modalValues(options)
  const out: number[][] = []
  const pick: number[][] = []
  const walk = (k: number): void => {
    if (k === tied.length) {
      out.push(argmax(scoresFor(options, pick)))
      return
    }
    for (const v of tied[k] as number[]) {
      pick.push([v])
      walk(k + 1)
      pick.pop()
    }
  }
  walk(0)
  return out
}

/** P(the one-mode picker chooses option `key`), over the mode choices and the top-scorer ties. */
export function oneModeHitProbability(options: readonly Cell[], key: number): number {
  const tops = oneModeTops(options)
  if (tops.length === 0) return 0
  return tops.reduce((p, top) => p + (top.includes(key) ? 1 / top.length : 0), 0) / tops.length
}

/** True if every one-mode outcome makes `key` the unique top scorer (implies {@link modalPicksKeyUniquely}). */
export function oneModeCertain(options: readonly Cell[], key: number): boolean {
  const tops = oneModeTops(options)
  return tops.length > 0 && tops.every((top) => top.length === 1 && top[0] === key)
}
