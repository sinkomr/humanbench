/**
 * Matrices family (ROADMAP M1.6; DESIGN §4.2 "Matrices", §14.6 example 1): procedural 3×3
 * matrices on axis MAT, facet `matrix`, item type `mc_matrix_spec`, 6 options → 2PL (A9).
 *
 * - `grammar.ts`: attributes, rules, the spec/key shapes and the render contract;
 * - `solver.ts`: rule-inference solver (all consistent rule assignments, rows and columns);
 * - `heuristic.ts`: the option-only modal-attribute picker;
 * - `gen.ts`: grid sampling, uniqueness filter, RAVEN-FAIR distractor tree;
 * - `verify.ts`, `score.ts`, `prior.ts` ([SPEC] v0 b prior and E[T], M1.P).
 *
 * The Python twin is the bank's `hb.gen.matrices`, which cross-checks this family's dump
 * (`golden/ts_dumps/matrices.json`, A1: 0 disagreements). Version 1.1.0 (contract v2, M1.F2):
 * `sibling_group`; the 180 s cap is now the shared `powerTimeLimit` rule set by `defineFamily`.
 * 1.2.0 (M1.P): the prior is centred at the natural pool's rule-type means, and the pool draws
 * rule sets uniformly, so its mean b is the ICAR anchor.
 *
 * 1.3.0 (M3.12, harder items): strata 5 and 6, drawn only on request (`seed@s5`, `seed@s6`), from
 * two hard templates: all five attributes ruled at once, and an outer frame per cell (shade and
 * pattern) with its own rules on top of 3–5 inner rules; their distractors are single-rule lures
 * and a second option-only picker (the hub picker) gates them (`gen.ts`, `prior.ts`). The natural
 * pool and strata 1–4 are the 1.2.0 code path unchanged, so 1.2.0 is kept whole as
 * {@link MATRICES_LEGACY_FAMILIES} (the same build with its version and strata 1–4) for saves and
 * the live pool of 2026-10-12 (A11, R-8.1).
 */

import { defineFamily } from '../family'
import { CELL_FIELD_SETS, type MatrixKey, type MatrixResponse, type MatrixSpec } from './grammar'
import { buildMatrix } from './gen'
import { MATRIX_LEGACY_STRATA, MATRIX_STRATA } from './prior'
import { scoreMatrix } from './score'
import { verifyMatrix, type MatrixItem } from './verify'

export type { MatrixCell, MatrixKey, MatrixResponse, MatrixSpec } from './grammar'
export type { MatrixItem } from './verify'

export const MATRICES_GENERATOR_VERSION = '1.3.0'
/** The generator before the hard strata (M3.12): kept whole for re-scoring (A11, R-8.1). */
export const MATRICES_LEGACY_GENERATOR_VERSION = '1.2.0'

const matricesFamily = (generatorVersion: string, strata: typeof MATRIX_STRATA) =>
  defineFamily<MatrixSpec, MatrixKey, MatrixResponse>({
    name: 'matrices',
    kind: 'item',
    axis: 'MAT',
    facets: ['matrix'],
    generatorVersion,
    itemType: 'mc_matrix_spec',
    strata,
    build: buildMatrix,
    verify: verifyMatrix,
    score: scoreMatrix,
  })

export const matrices = matricesFamily(MATRICES_GENERATOR_VERSION, MATRIX_STRATA)

/**
 * Earlier matrices generators, by version (`registry.ts` LEGACY_LIST): 1.2.0 is this build with
 * strata 1–4, whose draw paths 1.3.0 left unchanged, so it rebuilds every 1.2.0 item exactly.
 */
export const MATRICES_LEGACY_FAMILIES = Object.freeze({
  [MATRICES_LEGACY_GENERATOR_VERSION]: matricesFamily(MATRICES_LEGACY_GENERATOR_VERSION, MATRIX_LEGACY_STRATA),
})

const SPEC_FIELDS = 'grid,options'

/**
 * The family's leak predicate (`specLeaksKey`): the spec holds only `grid` (rows of 3, 3 and 2
 * cells, so never the 9th cell) and `options`, and every cell only its five render fields, plus
 * `frame` (shade and pattern only) on a framed hard item. The key's position is uniform (options
 * are shuffled; checked over the run by the property test).
 */
export function matricesSpecLeaksKey(item: MatrixItem): string | null {
  const spec = item.spec as unknown as Record<string, unknown>
  if (Object.keys(spec).sort().join(',') !== SPEC_FIELDS) return `spec fields must be ${SPEC_FIELDS}`
  const grid = spec.grid as unknown[][]
  if (grid.length !== 3 || grid.map((r) => r.length).join(',') !== '3,3,2') return 'grid must be rows of 3, 3 and 2 cells'
  for (const cell of [...grid.flat(), ...(spec.options as unknown[])]) {
    const c = cell as Record<string, unknown>
    if (!CELL_FIELD_SETS.includes(Object.keys(c).sort().join(','))) return `a cell has fields beyond ${CELL_FIELD_SETS.join(' or ')}`
    if ('frame' in c && Object.keys(c.frame as object).sort().join(',') !== 'pattern,shade') return 'a frame has fields beyond pattern,shade'
  }
  return null
}

export default matrices
