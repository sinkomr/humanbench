/**
 * Cube nets, surface development (DESIGN §3 row 7 "Spatial" (Gv), §4.2; ROADMAP A1, A9, A11):
 * axis SPA, facet `cube_net`, item type `mc_image_spec`, four options → 3PL with c = 1/4 (A9),
 * kind 'item'.
 *
 * "This flat pattern folds up into a cube, with the marks on the outside. Which cube could it
 * make?" (the renderer's stem, `render/cubenet/copy.ts`). The net is one of the 11 cube nets in
 * one of its 8 placements, each square with a distinct mark that looks the same however it is
 * turned or flipped. Each option is a cube seen from above a corner (top, front-left and
 * front-right faces). Exactly one is a corner of the folded cube in the right turn; each
 * distractor is impossible for a recorded reason: "opposite pair" (two of its marks are on
 * opposite faces, never seen together) or "mirror" (a real corner's marks in the reversed turn,
 * which only the mirror-image cube shows). Strata 1–5 follow the number of mirror distractors
 * (0 → strata 1–2, 1 → 3, 2 → 4, 3 → 5); see `prior.ts`.
 *
 * - `gen.ts`: the generator; `verify.ts`: the verifier (G2/G3, a second folding route and a
 *   brute-force check over the 24 rotations of the cube); `score.ts`; `prior.ts`: the [SPEC] v0
 *   difficulty and time priors; `structure.ts`: nets, placements, canonical structure (A11);
 *   `spec.ts`: the wire types and `specProblems` (the renderer's `fits` check).
 * - Python twin: the bank's `hb.gen.cubenet`, which verifies `golden/ts_dumps/cubenet.json`
 *   (`npx tsx scripts/dump-families.ts --module src/tasks/cubenet/index.ts --family cubenet --n 1000 --bank`).
 */

import { defineFamily } from '../family'
import { verifiers } from '../verifier-slot'
import { buildCubenet } from './gen'
import { CUBENET_STRATA } from './prior'
import { scoreCubenet } from './score'
import type { CubenetItem, CubenetKey, CubenetResponse, CubenetSpec } from './spec'

export const CUBENET_GENERATOR_VERSION = '1.0.0'

export const cubenet = defineFamily<CubenetSpec, CubenetKey, CubenetResponse>({
  name: 'cubenet',
  kind: 'item',
  axis: 'SPA',
  facets: ['cube_net'],
  generatorVersion: CUBENET_GENERATOR_VERSION,
  itemType: 'mc_image_spec',
  strata: CUBENET_STRATA,
  build: buildCubenet,
  verify: (item) => verifiers().cubenet(item),
  score: scoreCubenet,
})

/**
 * The family's own leak check (M1.13): the spec holds only `net` and `options`, every net square
 * only `r`, `c`, `mark`, every option only `top`, `left`, `right`.
 */
export function cubenetSpecLeaksKey(item: CubenetItem): string | null {
  const extra = Object.keys(item.spec).filter((k) => k !== 'net' && k !== 'options')
  if (extra.length > 0) return `unexpected spec fields: ${extra.join(', ')}`
  for (const sq of item.spec.net) {
    const x = Object.keys(sq).filter((k) => k !== 'r' && k !== 'c' && k !== 'mark')
    if (x.length > 0) return `unexpected net square fields: ${x.join(', ')}`
  }
  for (const o of item.spec.options) {
    const x = Object.keys(o).filter((k) => k !== 'top' && k !== 'left' && k !== 'right')
    if (x.length > 0) return `unexpected option fields: ${x.join(', ')}`
  }
  return null
}

export { specProblems } from './spec'
export type { CubeView, CubenetFeatures, CubenetItem, CubenetKey, CubenetResponse, CubenetSpec, Mark, NetSquare } from './spec'
export default cubenet
