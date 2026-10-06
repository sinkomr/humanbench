/**
 * The RT block families: simple (30 trials) and 4-choice (40 trials) reaction time
 * (ROADMAP M1.10, A10, M1.F2; DESIGN §3 row 9, §7.1, §11.6, §14.6 example 12). One family per
 * sub-task (M1.F2, as span): `rt_simple` (facet `simple_rt`) and `rt_choice4` (facet
 * `choice_rt`), axis RT, item_type `rt_block`, kind 'block'. One instance is one block: a seeded
 * trial schedule (`gen.ts`), its verifier (`verify.ts`), trimming and the Gaussian person
 * observation (`score.ts`), provisional norms and priors (`prior.ts`) and the
 * rAF/refresh-rate timing utilities (`timing.ts`).
 *
 * `score(item, response)` returns a `BlockScore` ({@link rtBlockScore}): the Gaussian
 * observation `{ lam: −s, d: β, sigma: √(SE² + τ_res²), x = median ln RT }`, or none with the
 * reason `too_few_valid_trials`. {@link rtBlockObservation} also returns the trial counts and
 * the device-class metadata.
 *
 * Generator version 2.0.0: the successors of the single `rt` family 1.1.0, which drew the mode
 * from the seed (a `#simple` / `#choice4` tag, else a coin flip).
 */

import { defineFamily, type BlockFamily, type ItemInstance } from '../family'
import { buildRt } from './gen'
import { RT_STRATUM } from './prior'
import { rtBlockScore } from './score'
import { RT_FACETS, RT_MODES, rtFamilyName, type RtKey, type RtMode, type RtResponse, type RtSpec } from './types'
import { verifyRt } from './verify'

export type RtItem = ItemInstance<RtSpec, RtKey>

/** Current generator version of both RT families. */
export const RT_GENERATOR_VERSION = '2.0.0'

/** The block family of one RT sub-task (M1.F2). */
export function rtFamily(mode: RtMode): BlockFamily<RtSpec, RtKey, RtResponse> {
  return defineFamily<RtSpec, RtKey, RtResponse>({
    name: rtFamilyName(mode),
    kind: 'block',
    axis: 'RT',
    facets: [RT_FACETS[mode]],
    generatorVersion: RT_GENERATOR_VERSION,
    itemType: 'rt_block',
    strata: [RT_STRATUM],
    build: (rng) => buildRt(rng, mode),
    verify: (item) => verifyRt(item, mode),
    score: rtBlockScore,
  })
}

/** Simple RT: 30 scored trials, one location (M1.10). */
export const rtSimple = rtFamily('simple')
/** 4-choice RT: 40 scored trials, positions 0–3 (M1.10). */
export const rtChoice4 = rtFamily('choice4')

/** The RT families by mode. */
export const RT_FAMILIES: Readonly<Record<RtMode, BlockFamily<RtSpec, RtKey, RtResponse>>> = Object.freeze({ simple: rtSimple, choice4: rtChoice4 })

/** Both RT families, in session order (A15: simple, then choice). */
export const RT_FAMILY_LIST = Object.freeze(RT_MODES.map((m) => RT_FAMILIES[m]))

/** A block of the given mode: `RT_FAMILIES[mode].generate(seed)`. */
export function generateRtBlock(seed: string, mode: RtMode): RtItem {
  return RT_FAMILIES[mode].generate(seed)
}

export { buildRt, drawBalancedPositions, drawForeperiods, drawSchedule, maxRunLength } from './gen'
export {
  RT_NORMS_VERSION,
  RT_PRIOR,
  RT_PROVENANCE,
  RT_STRATUM,
  RT_TIME_MODEL,
  RT_TOUCH_NORMS,
  RT_WEB_NORMS,
  rtDifficulty,
  rtExpectedTimeS,
  rtItemParams,
  rtNorm,
  rtParamsOfNorm,
  rtStructure,
} from './prior'
export { MAD_TO_SD, SE_MEDIAN_FACTOR, classifyTrial, expectedOf, median, rtBlockObservation, rtBlockScore, rtEstimate, rtResponseProblems, scoreRtResponse } from './score'
export * from './timing'
export * from './types'
export { RT_SPEC_FIELDS, verifyRt } from './verify'

