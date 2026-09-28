/**
 * Mental rotation (M1.5; DESIGN §4.2 "Mental rotation", §12; ROADMAP A9, A11): Shepard–Metzler
 * polycubes, axis SPA, facet `3d_rotation`, item type `mc_image_spec`, four options → 3PL with
 * c = 1/4 (A9).
 *
 * "Which figure is the same object as the target, rotated? (Not mirror-imaged.)" The target is a
 * chiral chain of 8–10 cubes with ≥ 3 arms; the options are the target rotated, its mirror image
 * (exactly one, A11), a one-cube-moved variant and that variant's mirror image (two enantiomer
 * pairs, so pairing options up gives no edge), all pairwise distinct under the 24 rotations. Strata 2–5 are angle bins of the display rotation between the
 * target and the correct option (20–60°, 60–100°, 100–140°, 140–180°), see `prior.ts`.
 *
 * - `gen.ts`: the generator; `verify.ts`: the verifier (§4.2 `verify_rotation_item` + A11 +
 *   bookkeeping); `score.ts`; `prior.ts`: the [SPEC] v0 difficulty and time priors;
 *   `geometry.ts`: polycubes (§4.2 group and `canon`), chains, moved variants, quaternions;
 *   `spec.ts`: the wire types and the `iso_v1` camera.
 * - Python twin: the bank's `hb.gen.rotation`, which verifies `golden/ts_dumps/rotation.json`
 *   (`npm run dump:families -- --module src/tasks/rotation/index.ts --family rotation --n 1000 --bank`).
 *
 * generatorVersion 1.1.0: `time_limit_s` 60 → 180, the shared power-item cap (§13,
 * `POWER_TIME_LIMIT_S`); content otherwise unchanged from 1.0.0.
 */

import { defineFamily } from '../family'
import { buildRotation } from './gen'
import { ROTATION_STRATA } from './prior'
import { scoreRotation } from './score'
import type { RotationKey, RotationResponse, RotationSpec } from './spec'
import { verifyRotation } from './verify'

export const rotation = defineFamily<RotationSpec, RotationKey, RotationResponse>({
  name: 'rotation',
  axis: 'SPA',
  facet: '3d_rotation',
  generatorVersion: '1.1.0',
  itemType: 'mc_image_spec',
  strata: ROTATION_STRATA,
  build: buildRotation,
  verify: verifyRotation,
  score: scoreRotation,
})

export type { RotationFeatures, RotationItem, RotationKey, RotationResponse, RotationSpec } from './spec'
export default rotation
