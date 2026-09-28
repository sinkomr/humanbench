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
 */

import { defineFamily } from '../family'
import type { MatrixKey, MatrixResponse, MatrixSpec } from './grammar'
import { buildMatrix } from './gen'
import { MATRIX_STRATA } from './prior'
import { scoreMatrix } from './score'
import { verifyMatrix, type MatrixItem } from './verify'

export type { MatrixCell, MatrixKey, MatrixResponse, MatrixSpec } from './grammar'
export type { MatrixItem } from './verify'

export const matrices = defineFamily<MatrixSpec, MatrixKey, MatrixResponse>({
  name: 'matrices',
  kind: 'item',
  axis: 'MAT',
  facets: ['matrix'],
  generatorVersion: '1.1.0',
  itemType: 'mc_matrix_spec',
  strata: MATRIX_STRATA,
  build: buildMatrix,
  verify: verifyMatrix,
  score: scoreMatrix,
})

const SPEC_FIELDS = 'grid,options'
const CELL_FIELDS = 'color,orientation,positions,shape,size'

/**
 * The family's leak predicate (`specLeaksKey`): the spec holds only `grid` (rows of 3, 3 and 2
 * cells, so never the 9th cell) and `options`, and every cell only its five render fields. The
 * key's position is uniform (options are shuffled; checked over the run by the property test).
 */
export function matricesSpecLeaksKey(item: MatrixItem): string | null {
  const spec = item.spec as unknown as Record<string, unknown>
  if (Object.keys(spec).sort().join(',') !== SPEC_FIELDS) return `spec fields must be ${SPEC_FIELDS}`
  const grid = spec.grid as unknown[][]
  if (grid.length !== 3 || grid.map((r) => r.length).join(',') !== '3,3,2') return 'grid must be rows of 3, 3 and 2 cells'
  for (const cell of [...grid.flat(), ...(spec.options as unknown[])]) {
    if (Object.keys(cell as object).sort().join(',') !== CELL_FIELDS) return `a cell has fields beyond ${CELL_FIELDS}`
  }
  return null
}

export default matrices
