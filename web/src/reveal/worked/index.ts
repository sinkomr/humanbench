/**
 * Choosing the three worked examples (DESIGN §10; ROADMAP M1.R, §7.7): one matrix, one series and
 * one quantitative item, each a fresh procedural item from a family the person has not met.
 *
 * - **Fresh.** Items are generated from the session id (so a reload shows the same three) and
 *   skipped when their `family_id`, or that of a near-isomorph sibling, is in `seen_families` (the
 *   person's earlier sessions and this one), so an example never repeats something they were asked
 *   or hands over the method for it.
 * - **Left out afterwards.** The families of the examples, and of their siblings, are added to the
 *   save's `seen_families` by the caller (`SessionPersister.addSeenFamilies`): a person who has
 *   seen a worked solution must not meet that question type, or a near-isomorph of it, as a counted
 *   item later (§7.7; it would inflate the practice effect and leak the solution). The device's own
 *   selector reads the list, and so does the server's `start_session` for a served session: it keeps
 *   the procedural families of a save away from the person (their `family_id` is one function in both
 *   repos, A11), which is why the examples are procedural and not finite-bank items, whose families
 *   a server ignores when a save names them (supabase/README.md). `seen_families`
 *   holds family ids only, so a sibling group is spelled out as the ids of its members
 *   ({@link siblingFamilyIds}). No quant variant of the stratum used here is grouped today (the
 *   groups sit in strata 1, 3 and 4), so this is exact bookkeeping for a change of stratum or of
 *   the solved variants rather than a case a taker meets now; `worked.test.ts` pins both.
 * - **Uncounted.** Nothing here is scored, stored as a response or fed to the estimate.
 * - Easy-to-follow strata: matrix 2, series 3, quant 2, and only quant variants that have a
 *   worked solution (`quant.ts`). A kind whose families are all used up at its stratum is tried at
 *   the neighbouring ones ({@link FALLBACK_STRATA}) before it is left out: quant has only about a
 *   dozen families per stratum, so a person who met many of them would otherwise see two examples.
 */

import { getFamily } from '../../tasks/registry'
import { siblingGroupId, type ItemInstance } from '../../tasks/family'
import type { MatrixItem } from '../../tasks/matrices'
import { QUANT_SIBLING_SETS, type QuantItem } from '../../tasks/quant'
import type { SeriesItem } from '../../tasks/series/types'
import { matrixSolution } from './matrices'
import { QUANT_SOLVED_VARIANTS, hasQuantSolution, quantSolution } from './quant'
import { seriesSolution } from './series'
import { WORKED_KINDS, type WorkedItem, type WorkedKind, type WorkedSolution } from './types'

export { seriesSolution, quantSolution, matrixSolution, hasQuantSolution, QUANT_SOLVED_VARIANTS }
export type { WorkedItem, WorkedKind, WorkedSolution } from './types'
export { WORKED_KINDS } from './types'

const SPEC: Readonly<Record<WorkedKind, { family: string; title: string }>> = {
  matrix: { family: 'matrices', title: 'Matrix' },
  series: { family: 'series', title: 'Sequence' },
  quant: { family: 'quant', title: 'Quantitative' },
}

/** Seeds tried per kind and stratum before it moves on (a family is one of many, so a handful is plenty). */
export const WORKED_ATTEMPTS = 400

type Stratum = 1 | 2 | 3 | 4 | 5

/** The strata tried for each kind, in order: its own first, then the neighbours whose items a reader can still follow. */
export const FALLBACK_STRATA: Readonly<Record<WorkedKind, readonly Stratum[]>> = Object.freeze({
  matrix: [2, 3, 1],
  series: [3, 2, 4],
  quant: [2, 1],
})

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

/**
 * The family ids of `item`'s sibling group, its own included: a family that is its own group has
 * just its own id; a grouped quant variant (`g:quant:<label>`, `QUANT_SIBLING_SETS`) has the ids of
 * every variant of the set, which show the same givens and differ only in what is asked.
 */
export function siblingFamilyIds(item: ItemInstance<object, object>): string[] {
  const quant = getFamily('quant')
  if (item.family === 'quant' && quant !== undefined && item.sibling_group !== item.family_id) {
    for (const [label, members] of Object.entries(QUANT_SIBLING_SETS)) {
      if (siblingGroupId('quant', label) !== item.sibling_group) continue
      const ids = members.map((m) => {
        const [template, variant] = m.split('/')
        return quant.familyIdOf({ template: template!, variant: variant! })
      })
      return [...new Set([item.family_id, ...ids])]
    }
  }
  return [item.family_id]
}

/** The seed of the n-th try for `kind` in a session. */
export const workedSeed = (sessionId: string, kind: WorkedKind, n: number): string => `worked.${sessionId}.${kind}.${n}`

/**
 * Up to three worked examples for `sessionId`, none from a family in `seenFamilies` (module comment).
 * `strata` fixes a kind's stratum and turns the fallback to neighbouring strata off for it (tests).
 */
export function pickWorkedItems(sessionId: string, seenFamilies: Iterable<string>, strata: Partial<Record<WorkedKind, Stratum>> = {}): WorkedItem[] {
  const seen = new Set(seenFamilies)
  const out: WorkedItem[] = []
  for (const kind of WORKED_KINDS) {
    const { family: name, title } = SPEC[kind]
    const fixed = strata[kind]
    const tryStrata: readonly Stratum[] = fixed === undefined ? FALLBACK_STRATA[kind] : [fixed]
    const family = getFamily(name)
    if (family === undefined) continue
    found: for (const stratum of tryStrata) {
      for (let n = 0; n < WORKED_ATTEMPTS; n++) {
        const item = family.generate(workedSeed(sessionId, kind, n), { stratum })
        const families = siblingFamilyIds(item as ItemInstance<object, object>)
        if (families.some((f) => seen.has(f))) continue
        if (kind === 'quant') {
          const sp = item.structural_params as { template?: string; variant?: string }
          if (!hasQuantSolution(String(sp.template), String(sp.variant))) continue
        }
        const solution = workedSolutionOf(item as ItemInstance<object, object>)
        if (solution === null) continue
        out.push({ kind, title, item: item as ItemInstance<object, object>, solution, families })
        for (const f of families) seen.add(f) // two kinds never share a family
        break found
      }
    }
  }
  return out
}
