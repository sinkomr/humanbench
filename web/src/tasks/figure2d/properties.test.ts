/**
 * The figure2d family's shared property suite (ROADMAP A1, DESIGN §14.3 M1 acceptance 1): 10,000 natural-pool items
 * and 2,000 requested over strata 1–6 pass `runFamilyProperties` (validity, determinism, regeneration from the id,
 * the verifier, the leak checks, scoring, malformed responses, key position balance). Heavy: its own file, so vitest
 * runs it beside the unit tests.
 */

import { describe, expect, it } from 'vitest'
import { runFamilyProperties, type FamilyPropertyOptions } from '../testing'
import type { Figure2dItem, Figure2dKey, Figure2dResponse, Figure2dSpec } from './spec'
import { figure2d, figure2dSpecLeaksKey } from '.'

/**
 * A11: the family is the target up to turning and flipping, plus (rotate) the moved variant or (mirror) the line class
 * and distractor set. Figures with no symmetry are few at the easy end (5 of 5 squares, 20 of 6; mirror figures also
 * need a square box: 4 of 6 squares, 14 of 7), and the natural pool puts a third of its items in strata 1–2, so about
 * 4,860 of 10,000 draws have distinct family_ids (mirror stratum 1: ≈ 60 of ≈ 840).
 */
const SMALL_STRUCTURE = { min: 0.45, reason: 'few figures with no symmetry at 5–7 squares (5, 20 and 84 shapes; mirror: 4 and 14 with a square box)' }

const FIGURE2D_PROPS: FamilyPropertyOptions<Figure2dSpec, Figure2dKey, Figure2dResponse> = {
  familyIdRatio: SMALL_STRUCTURE,
  specLeaksKey: figure2dSpecLeaksKey,
  correctResponse: (item: Figure2dItem) => item.key.index,
  incorrectResponse: (item: Figure2dItem) => (item.key.index + 1) % 4,
  malformedResponses: () => [-1, 4, 1.5, '0', [0]],
}

describe('figure2d family properties (A1)', () => {
  it('passes runFamilyProperties at n = 10,000 (the natural pool: half each task, spread over strata 1–6)', () => {
    const r = runFamilyProperties(figure2d, FIGURE2D_PROPS)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBeGreaterThan(9_500) // a few easy items repeat (5 shapes of 5 squares)
    expect(r.distinctFamilyIds).toBeGreaterThan(4_500) // ≈ 4,860: see SMALL_STRUCTURE
    for (const k of figure2d.strata) {
      expect(r.strataCounts[k]).toBeGreaterThan(1_450)
      expect(r.strataCounts[k]).toBeLessThan(1_890)
    }
    expect(r.bPrior.min).toBeGreaterThanOrEqual(-2.75)
    expect(r.bPrior.max).toBeLessThanOrEqual(3)
  }, 900_000)

  it('passes runFamilyProperties with every stratum requested (n = 2,000)', () => {
    const r = runFamilyProperties(figure2d, { ...FIGURE2D_PROPS, n: 2_000, strata: figure2d.strata, seedPrefix: 'strata-' })
    expect(r.strataCounts).toEqual({ 1: 334, 2: 334, 3: 333, 4: 333, 5: 333, 6: 333 })
  }, 600_000)
})
