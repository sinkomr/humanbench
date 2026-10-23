/**
 * Option-only cues of a paper-folding item (DESIGN §4.1 G3, §4.3): rules a test-wise taker could
 * apply to the five option sheets alone, without the folds. Each cue picks a subset of the options;
 * it *singles out the key* when that subset is exactly the key. The generator redraws an item when a
 * cue singles out its key, and the verifier recomputes and checks the same (the values are recorded
 * in the verifier's checks).
 *
 * - `most_holes` / `fewest_holes`: the options with the largest / smallest hole count;
 * - `odd_count`: the options whose hole count no other option has;
 * - `symmetric` / `asymmetric`: the options that are (are not) mirror symmetric about a line of the
 *   sheet (its vertical or horizontal centre line or a diagonal);
 * - `most_symmetric`: the options with the most sheet symmetries (mirrors and turns that map them onto
 *   themselves);
 * - `medoid`: the options with the smallest total difference (holes in one but not the other) to the
 *   other four, the "most typical" option. Every distractor is derived from the key, so a plain draw
 *   makes the key the medoid most of the time; the generator instead draws the key's typicality rank
 *   uniformly (`gen.ts`), so this cue picks the key at chance (1 in 5) and is NOT a redraw rule
 *   (redrawing on it would make "never the medoid" a cue). It is recorded, not enforced.
 */

import { SHEET_MIRRORS, mapSlots, slotsKey, stabilizer } from './geometry'
import type { Slot } from './spec'

export const CUE_NAMES = Object.freeze(['most_holes', 'fewest_holes', 'odd_count', 'symmetric', 'asymmetric', 'most_symmetric', 'medoid'] as const)
export type CueName = (typeof CUE_NAMES)[number]

/** The cues a draw must not single its key out by (all but `medoid`, see the module comment). */
export const ENFORCED_CUES: readonly CueName[] = Object.freeze(CUE_NAMES.filter((c) => c !== 'medoid'))

/** Holes in one set but not the other. */
export function slotDistance(a: readonly Slot[], b: readonly Slot[]): number {
  const ka = new Set(a.map((s) => `${s.row}.${s.col}`))
  const kb = new Set(b.map((s) => `${s.row}.${s.col}`))
  let d = 0
  for (const k of ka) if (!kb.has(k)) d++
  for (const k of kb) if (!ka.has(k)) d++
  return d
}

/** Mirror symmetric about some line of the n × n sheet. */
export function isSheetSymmetric(holes: readonly Slot[], n: number): boolean {
  const own = slotsKey(holes)
  return SHEET_MIRRORS.some((m) => slotsKey(mapSlots(holes, m, n)) === own)
}

const argBy = (vals: readonly number[], pick: (xs: number[]) => number): number[] => {
  const t = pick([...vals])
  return vals.flatMap((v, i) => (v === t ? [i] : []))
}

/** The option indices each cue picks. */
export function cueSets(options: readonly (readonly Slot[])[], n: number): Record<CueName, number[]> {
  const counts = options.map((o) => o.length)
  const sym = options.map((o) => isSheetSymmetric(o, n))
  const order = options.map((o) => stabilizer(o, n).length)
  const dist = options.map((o, i) => options.reduce((s, p, j) => s + (i === j ? 0 : slotDistance(o, p)), 0))
  return {
    most_holes: argBy(counts, (xs) => Math.max(...xs)),
    fewest_holes: argBy(counts, (xs) => Math.min(...xs)),
    odd_count: counts.flatMap((c, i) => (counts.filter((d) => d === c).length === 1 ? [i] : [])),
    symmetric: sym.flatMap((s, i) => (s ? [i] : [])),
    asymmetric: sym.flatMap((s, i) => (s ? [] : [i])),
    most_symmetric: argBy(order, (xs) => Math.max(...xs)),
    medoid: argBy(dist, (xs) => Math.min(...xs)),
  }
}

/** The cues that single out option `keyIndex` (empty = none does). */
export function cuesSinglingOut(options: readonly (readonly Slot[])[], n: number, keyIndex: number, cues: readonly CueName[] = ENFORCED_CUES): CueName[] {
  const sets = cueSets(options, n)
  return cues.filter((c) => sets[c].length === 1 && sets[c][0] === keyIndex)
}

/** How many options are strictly more typical than option `index` (a smaller total difference to the others). */
export function typicalityRank(options: readonly (readonly Slot[])[], index: number): number {
  const dist = options.map((o, i) => options.reduce((s, p, j) => s + (i === j ? 0 : slotDistance(o, p)), 0))
  const own = dist[index] as number
  return dist.filter((d) => d < own).length
}
