/**
 * Mental rotation (M1.5; DESIGN §4.2 "Mental rotation", §12; ROADMAP A9, A11): Shepard–Metzler
 * polycubes, axis SPA, facet `3d_rotation`, item type `mc_image_spec`, four options → 3PL with
 * c = 1/4 (A9), kind 'item'.
 *
 * "Which option shows the same object as the target, rotated? A mirror image does not count." (the
 * renderer's stem, `render/rotation/copy.ts`, UX-085; the §12 example item still has an older
 * wording, "Which figure is the same object as the one on the left, rotated? (Not mirror-imaged.)").
 * The target is a chiral chain of 8–10 cubes with ≥ 3 arms; the options are the target rotated, its mirror image
 * (exactly one, A11), a one-cube-moved variant and that variant's mirror image (two enantiomer
 * pairs, so pairing options up gives no edge), all pairwise distinct under the 24 rotations.
 * Strata 2–6 are the angle bins of the display rotation between the target and the correct
 * option whose b lies in each default band (≈ 20–22°, 22–62°, 62–102°, 102–142°, 142–180°),
 * see `prior.ts`.
 *
 * - `gen.ts`: the generator; `verify.ts`: the verifier (§4.2 `verify_rotation_item` + A11 +
 *   bookkeeping); `score.ts`; `prior.ts`: the [SPEC] v0 difficulty and time priors;
 *   `geometry.ts`: polycubes (§4.2 group and `canon`), chains, moved variants, quaternions;
 *   `spec.ts`: the wire types and the `iso_v1` camera.
 * - Python twin: the bank's `hb.gen.rotation`, which verifies `golden/ts_dumps/rotation.json`
 *   (`npm run dump:families -- --module src/tasks/rotation/index.ts --family rotation --n 1000 --bank`).
 *
 * generatorVersion 1.1.0: `time_limit_s` 60 → 180, the shared power-item cap (§13,
 * `POWER_TIME_LIMIT_S`); content otherwise unchanged from 1.0.0. 1.2.0 (contract v2, M1.F2):
 * `sibling_group`; the cap is now set by `defineFamily` (`powerTimeLimit`, still 180 s here).
 * 1.3.0 (M1.P): the prior is centred at the pool mean angle (100°), so the natural pool (angles
 * uniform on 20–180°) has mean b = the ICAR anchor; strata 2–6 follow the bands.
 * 1.4.0 (ROADMAP M3.12, harder items at the top): a requested stratum 5 or 6 is drawn from the
 * torsion template (`gen.ts` `buildRotationTorsion`): 10–14 cubes with 5–7 arms, distractors that
 * keep every arm length of the target (a one-joint torsion variant and its mirror image, plus the
 * pure mirror), an oblique rotation axis at 70–140°, and a prior with terms for those features
 * (`prior.ts`; b ≈ 1.6–3.7, E[T] ≈ 47–66 s). The natural pool and requested strata 2–4 are 1.3.0's
 * code path unchanged (the same items under the new version), so the natural pool still has mean
 * b = the ICAR anchor and natural-pool items in strata 5–6 are still classic angle-only items.
 * 1.3.0 is kept whole as {@link ROTATION_LEGACY_FAMILIES} (the classic template in every stratum),
 * so saved 1.3.0 ids still regenerate (`registry.ts` `resolveItem`, R-8.1).
 */

import { defineFamily, type ItemFamily } from '../family'
import { buildRotation, buildRotationClassic } from './gen'
import { ROTATION_STRATA } from './prior'
import { scoreRotation } from './score'
import type { RotationKey, RotationResponse, RotationSpec } from './spec'
import { verifyRotation } from './verify'

export const ROTATION_GENERATOR_VERSION = '1.4.0'
/** The generator before the torsion template (M3.12): the classic template in every stratum. */
export const ROTATION_CLASSIC_GENERATOR_VERSION = '1.3.0'

export const rotation = defineFamily<RotationSpec, RotationKey, RotationResponse>({
  name: 'rotation',
  kind: 'item',
  axis: 'SPA',
  facets: ['3d_rotation'],
  generatorVersion: ROTATION_GENERATOR_VERSION,
  itemType: 'mc_image_spec',
  strata: ROTATION_STRATA,
  build: buildRotation,
  verify: verifyRotation,
  score: scoreRotation,
})

/**
 * Earlier rotation generators kept whole, by family name (`registry.ts` `LEGACY_LIST`): 1.3.0, the
 * classic template in every stratum. Never planned or served; only for rebuilding a saved 1.3.0 id
 * (A11, R-8.1). The verifier is shared: it checks each item against the template it records.
 */
export const ROTATION_LEGACY_FAMILIES: Readonly<Record<string, ItemFamily<RotationSpec, RotationKey, RotationResponse>>> = Object.freeze({
  rotation: defineFamily<RotationSpec, RotationKey, RotationResponse>({
    name: 'rotation',
    kind: 'item',
    axis: 'SPA',
    facets: ['3d_rotation'],
    generatorVersion: ROTATION_CLASSIC_GENERATOR_VERSION,
    itemType: 'mc_image_spec',
    strata: ROTATION_STRATA,
    build: buildRotationClassic,
    verify: verifyRotation,
    score: scoreRotation,
  }),
})

export type { HardRotationFeatures, RotationFeatures, RotationItem, RotationKey, RotationResponse, RotationSpec } from './spec'
export default rotation
