/**
 * Choosing the three worked examples (DESIGN §10; ROADMAP M1.R, §7.7): one matrix, one series and
 * one quantitative item, each a fresh procedural item from a family the person has not met.
 *
 * - **Fresh.** Items are generated from the session id (so a reload shows the same three) and
 *   skipped when their `family_id` is in `seen_families` (the person's earlier sessions and this
 *   one), so an example never repeats something they were asked.
 * - **Left out afterwards.** The families of the examples are added to the save's `seen_families`
 *   by the caller (`SessionPersister.addSeenFamilies`): a person who has seen a worked solution
 *   must not meet that exact question type as a counted item later (§7.7; it would inflate the
 *   practice effect and leak the solution).
 * - **Uncounted.** Nothing here is scored, stored as a response or fed to the estimate.
 * - Easy-to-follow strata: matrix 2, series 3, quant 2, and only quant variants that have a
 *   worked solution (`quant.ts`).
 */

import { getFamily } from '../../tasks/registry'
import type { ItemInstance } from '../../tasks/family'
import type { MatrixItem } from '../../tasks/matrices'
import type { QuantItem } from '../../tasks/quant'
import type { SeriesItem } from '../../tasks/series/types'
import { matrixSolution } from './matrices'
import { QUANT_SOLVED_VARIANTS, hasQuantSolution, quantSolution } from './quant'
import { seriesSolution } from './series'
import { WORKED_KINDS, type WorkedItem, type WorkedKind, type WorkedSolution } from './types'

export { seriesSolution, quantSolution, matrixSolution, hasQuantSolution, QUANT_SOLVED_VARIANTS }
export type { WorkedItem, WorkedKind, WorkedSolution } from './types'
export { WORKED_KINDS } from './types'

const SPEC: Readonly<Record<WorkedKind, { family: string; stratum: 1 | 2 | 3 | 4 | 5; title: string }>> = {
  matrix: { family: 'matrices', stratum: 2, title: 'Matrix' },
  series: { family: 'series', stratum: 3, title: 'Series' },
  quant: { family: 'quant', stratum: 2, title: 'Quantitative' },
}

/** Seeds tried per kind before it is left out (a family is one of many, so a handful is plenty). */
export const WORKED_ATTEMPTS = 400

/** The worked solution of `item`, or null when its kind or variant has none. */
export function workedSolutionOf(item: ItemInstance<object, object>): WorkedSolution | null {
  switch (item.family) {
    case 'matrices':
      return matrixSolution(item as unknown as MatrixItem)
    case 'series':
      return seriesSolution(item as unknown as SeriesItem)
    case 'quant':
      return quantSolution(item as unknown as QuantItem)
    default:
      return null
  }
}

/** The seed of the n-th try for `kind` in a session. */
export const workedSeed = (sessionId: string, kind: WorkedKind, n: number): string => `worked.${sessionId}.${kind}.${n}`

/** Up to three worked examples for `sessionId`, none from a family in `seenFamilies` (module comment). */
export function pickWorkedItems(sessionId: string, seenFamilies: Iterable<string>): WorkedItem[] {
  const seen = new Set(seenFamilies)
  const out: WorkedItem[] = []
  for (const kind of WORKED_KINDS) {
    const { family: name, stratum, title } = SPEC[kind]
    const family = getFamily(name)
    if (family === undefined) continue
    for (let n = 0; n < WORKED_ATTEMPTS; n++) {
      const item = family.generate(workedSeed(sessionId, kind, n), { stratum })
      if (seen.has(item.family_id) || seen.has(item.sibling_group)) continue
      if (kind === 'quant') {
        const sp = item.structural_params as { template?: string; variant?: string }
        if (!hasQuantSolution(String(sp.template), String(sp.variant))) continue
      }
      const solution = workedSolutionOf(item as ItemInstance<object, object>)
      if (solution === null) continue
      out.push({ kind, title, item: item as ItemInstance<object, object>, solution })
      seen.add(item.family_id) // two kinds never share a family
      break
    }
  }
  return out
}
