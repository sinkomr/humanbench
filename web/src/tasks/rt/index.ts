/**
 * The `rt` family: simple (30 trials) and 4-choice (40 trials) reaction-time blocks
 * (ROADMAP M1.10, A10; DESIGN §3 row 9, §7.1, §11.6, §14.6 example 12). One instance is one
 * block (item_type `rt_block`): a seeded trial schedule (`gen.ts`), its verifier (`verify.ts`),
 * trimming and the Gaussian person observation (`score.ts`), provisional norms and priors
 * (`prior.ts`) and the rAF/refresh-rate timing utilities (`timing.ts`).
 *
 * `score(item, response)` returns `{ correct: null, value: x }` with x = median ln RT of the
 * valid trials, or `{ correct: null }` when too few trials are valid. The scorer input is
 * {@link rtBlockObservation}, which also returns the reason and the device-class metadata.
 */

import { defineFamily, type ItemInstance } from '../family'
import { buildRt, rtBlockSeed } from './gen'
import { rtBlockObservation } from './score'
import type { RtKey, RtMode, RtResponse, RtSpec } from './types'
import { verifyRt } from './verify'

export type RtItem = ItemInstance<RtSpec, RtKey>

export const rt = defineFamily<RtSpec, RtKey, RtResponse>({
  name: 'rt',
  axis: 'RT',
  facet: 'reaction_time',
  generatorVersion: '1.0.0',
  itemType: 'rt_block',
  strata: [3],
  build: buildRt,
  verify: verifyRt,
  score(item, response) {
    // The device class only annotates the observation; the value does not depend on it.
    const r = rtBlockObservation(item, response, { device_class: 'unspecified' })
    return r.status === 'ok' ? { correct: null, value: r.observation.x } : { correct: null }
  },
})

/** A block of the given mode (the seed is tagged `<seed>#<mode>`, so the id regenerates it). */
export function generateRtBlock(seed: string, mode: RtMode): RtItem {
  return rt.generate(rtBlockSeed(seed, mode))
}

export { buildRt, drawBalancedPositions, drawForeperiods, drawSchedule, maxRunLength, modeOfSeed, rtBlockSeed } from './gen'
export {
  RT_NORMS_VERSION,
  RT_PRIOR,
  RT_PROVENANCE,
  RT_STRATUM,
  RT_TIME_MODEL,
  RT_WEB_NORMS,
  rtDifficulty,
  rtExpectedTimeS,
  rtItemParams,
  rtNorm,
  rtStructure,
} from './prior'
export { MAD_TO_SD, SE_MEDIAN_FACTOR, classifyTrial, expectedOf, median, rtBlockObservation, rtEstimate, rtResponseProblems, scoreRtResponse } from './score'
export * from './timing'
export * from './types'
export { REFERENCE_TOL, RT_SPEC_FIELDS, expectedMatches, referenceProblems, verifyRt } from './verify'

export default rt
