/**
 * 2D figures turned and mirrored (DESIGN §3 row 7 "2D rotation/mirror", §4.2; ROADMAP A9, A11): axis SPA, kind 'item',
 * item type `mc_image_spec`, four options → 3PL with c = 1/4 (A9), strata 1–6. Two tasks, one facet each:
 *
 * - `2d_rotation` ("Which option is the target figure turned around in the flat plane, not flipped over?"): a figure of
 *   5–11 unit squares with no symmetry, drawn upright; options are the figure turned (the key), its mirror image, a
 *   one-square-moved variant and that variant's mirror image (two mirror pairs, all different under turning), drawn at
 *   multiples of 15°, all tilted alike.
 * - `2d_mirror` ("Which option is the target figure's mirror image in the dashed line?"): the figure beside a dashed
 *   vertical, horizontal or diagonal mirror line; options drawn upright; the key is the exact reflected square set.
 *
 * - `gen.ts`: the generator; `verify.ts`: the verifier (installed through `../verifier-slot`, never imported here);
 *   `score.ts`; `prior.ts`: the [SPEC] v0 difficulty and time priors and the design points per stratum;
 *   `geometry.ts`: squares, turns, reflections, canonical forms, moved variants; `spec.ts`: wire types, `specProblems`.
 * - Python twin: the bank's `hb.gen.figure2d`, which verifies `golden/ts_dumps/figure2d.json`
 *   (`npx tsx scripts/dump-families.ts --module src/tasks/figure2d/index.ts --family figure2d --n 1000 --bank`).
 */

import { defineFamily } from '../family'
import { verifiers } from '../verifier-slot'
import { cellsKey } from './geometry'
import { buildFigure2d } from './gen'
import { FIGURE2D_STRATA } from './prior'
import { scoreFigure2d } from './score'
import { FIGURE2D_FACETS, specProblems, type Figure2dItem, type Figure2dKey, type Figure2dResponse, type Figure2dSpec } from './spec'

export const FIGURE2D_GENERATOR_VERSION = '1.0.0'

export const figure2d = defineFamily<Figure2dSpec, Figure2dKey, Figure2dResponse>({
  name: 'figure2d',
  kind: 'item',
  axis: 'SPA',
  facets: FIGURE2D_FACETS,
  generatorVersion: FIGURE2D_GENERATOR_VERSION,
  itemType: 'mc_image_spec',
  strata: FIGURE2D_STRATA,
  build: buildFigure2d,
  verify: (item) => verifiers().figure2d(item),
  score: scoreFigure2d,
})

/**
 * The family's leak predicate (`runFamilyProperties` `specLeaksKey`): the spec holds only the drawable fields
 * (`specProblems`: exactly task, figure, mirror_line for task 'mirror', options of { cells, angle }), and no option of a
 * 'rotate' item lists the target's squares unchanged (which would let a list comparison stand in for the turn).
 */
export function figure2dSpecLeaksKey(item: Figure2dItem): string | null {
  const problems = specProblems(item.spec)
  if (problems.length > 0) return problems[0] as string
  if (item.spec.task === 'rotate') {
    const own = cellsKey(item.spec.figure.cells)
    const i = item.spec.options.findIndex((o) => cellsKey(o.cells) === own)
    if (i >= 0) return `option ${i} repeats the target's squares unchanged`
  }
  return null
}

export { specProblems } from './spec'
export type { Cell, Figure2dFeatures, Figure2dItem, Figure2dKey, Figure2dOption, Figure2dResponse, Figure2dSpec, MirrorFeatures, RotateFeatures } from './spec'
export default figure2d
