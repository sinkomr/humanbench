/**
 * Working memory (Gwm) span blocks: digit span forward, digit span backward and Corsi block
 * span (ROADMAP M1.9, A10; DESIGN §3 row 8, §7.1, §14.6 examples 10–11). Three families, one
 * per graded item of a session, each generating ONE WHOLE BLOCK per instance:
 *
 * - `span_fwd` (facet digits_forward): digits 1–9, lengths 3–10, key = the sequence;
 * - `span_bwd` (facet digits_backward): digits 1–9, lengths 3–9, key = the reversed sequence;
 * - `corsi`: indices into the fixed 9-block board, lengths 3–10, key = the sequence.
 *
 * Item type `span`, axis WM, GRM params (a = 1.7, thresholds per `prior.ts`, provisional per
 * A10), a single stratum each. `protocol.ts` is the pure block state machine; `score.ts` turns
 * a response stream into the GRM category and the engine observation.
 */

import { defineFamily, type BlockFamily } from '../family'
import {
  SPAN_BWD,
  SPAN_CORSI,
  SPAN_FWD,
  SPAN_PROCEDURE,
  SPAN_TIMING,
  START_LENGTH,
  TRIALS_PER_LENGTH,
  type SpanItem,
  type SpanKey,
  type SpanProcedure,
  type SpanResponse,
  type SpanSpec,
  type SpanTaskConfig,
} from './config'
import { corsiBoard, drawTrials } from './gen'
import { SPAN_GRM_A, grmThresholds, spanDifficulty, spanExpectedTime, spanStratum } from './prior'
import { scoreSpan } from './score'
import { expectedKey, specFieldsOf, verifySpan } from './verify'

export * from './config'
export * from './protocol'
export { SPAN_GRM_A, SPAN_TIME_V0, SPAN_TIME_V1, grmThresholds, meanLength, protocolOf, spanB, spanDifficulty, spanExpectedTime, spanStratum, spanTimeModel, spanTrialP, spanTrialTimeS } from './prior'
export { drawSequence, drawTrials, isPalindrome, runCompletion } from './gen'
export { SPAN_UNFINISHED, blockTrials, itemProtocol, runBlock, scoreSpan, spanObservation, specProtocol } from './score'
export { SPAN_FLOAT_TOL, SPAN_TIME_RANGE_S, expectedKey, hasImmediateRepeat, hasRunOfThree, specFieldsOf, verifySpan } from './verify'

/**
 * Current generator version of all three span families. 1.2.0 (owner decision 2026-10-13): the
 * reactive procedure (`protocol.ts`: one trial per length, a second attempt only after a miss), the
 * spec's `procedure` field, and the time model re-estimated from a real session (`prior.ts`). The
 * sequences a seed draws, the key, the GRM parameters, the difficulty prior and the stratum are
 * those of 1.1.0. 1.1.0 (contract v2, M1.F2): kind 'block', `sibling_group`, and `score()` returns
 * the GRM observation ({@link scoreSpan}).
 */
export const SPAN_GENERATOR_VERSION = '1.2.0'

/**
 * The generator version before the reactive procedure: both trials of every length were given. A
 * save made before 2026-10-13 holds blocks of it, and {@link SPAN_LEGACY_FAMILIES} still makes and
 * scores them (`registry.ts` `resolveItem`).
 */
export const SPAN_FIXED_GENERATOR_VERSION = '1.1.0'

/**
 * Make the block family of one span sub-task (M1.F2: one block family per sub-task, like
 * `rt_simple` / `rt_choice4`). `procedure` 'fixed' makes the 1.1.0 generator as it was (its spec has
 * no `procedure` field, its time model is v0): only for re-scoring a saved 1.1.0 block.
 */
export function spanFamily(cfg: SpanTaskConfig, procedure: SpanProcedure = SPAN_PROCEDURE): BlockFamily<SpanSpec, SpanKey, SpanResponse> {
  const stratum = spanStratum(cfg)
  const fixed = procedure === 'fixed'
  return defineFamily<SpanSpec, SpanKey, SpanResponse>({
    name: cfg.name,
    kind: 'block',
    axis: 'WM',
    facets: [cfg.task],
    generatorVersion: fixed ? SPAN_FIXED_GENERATOR_VERSION : SPAN_GENERATOR_VERSION,
    itemType: 'span',
    strata: [stratum],
    build(rng) {
      // A per-task child stream, so one seed never gives two tasks the same sequences.
      const trials = drawTrials(rng.fork(cfg.name), cfg)
      const spec: SpanSpec = {
        task: cfg.task,
        recall: cfg.recall,
        ...(fixed ? {} : { procedure }),
        start_length: START_LENGTH,
        trials_per_length: TRIALS_PER_LENGTH,
        max_length: cfg.maxLength,
        trials,
        timing: { ...SPAN_TIMING },
        ...(cfg.task === 'corsi' ? { board: corsiBoard() } : {}),
      }
      return {
        stratum,
        spec,
        key: { sequences: expectedKey(cfg, trials) },
        structural_params: { task: cfg.task, trials: trials.map((t) => [...t]) },
        params: { model: 'grm', a: SPAN_GRM_A, b: grmThresholds(cfg) },
        difficulty: spanDifficulty(cfg),
        expected_time_s: spanExpectedTime(cfg, procedure),
      }
    },
    verify: (item) => verifySpan(cfg, item, procedure),
    score: (item, responses) => scoreSpan(item, responses),
  })
}

/** Digit span forward (M1.9). */
export const spanFwd = spanFamily(SPAN_FWD)
/** Digit span backward (M1.9). */
export const spanBwd = spanFamily(SPAN_BWD)
/** Corsi block span on the fixed board (M1.9). */
export const corsi = spanFamily(SPAN_CORSI)

/** The three span families, in session order (A10). */
export const SPAN_FAMILIES = Object.freeze([spanFwd, spanBwd, corsi] as const)

/**
 * The 1.1.0 generators of the three families (fixed procedure), by family name. Not registered and
 * never served: `registry.ts` `resolveItem` regenerates a saved 1.1.0 block with them, so a save
 * made before the reactive procedure keeps its Working Memory score when it is re-scored (R-8.1).
 */
export const SPAN_LEGACY_FAMILIES: Readonly<Record<string, BlockFamily<SpanSpec, SpanKey, SpanResponse>>> = Object.freeze(
  Object.fromEntries([SPAN_FWD, SPAN_BWD, SPAN_CORSI].map((cfg) => [cfg.name, spanFamily(cfg, 'fixed')])),
)

/**
 * The span families' own leak check for `runFamilyProperties`: the spec holds exactly the
 * task's render fields. The stimuli ARE the key (or its reversal) by design, so the generic
 * value checks are waived with `allowKeyInSpec`; this guards against any extra field.
 */
export function spanSpecLeaksKey(cfg: SpanTaskConfig): (item: SpanItem) => string | null {
  const want = specFieldsOf(cfg).join(',')
  return (item) => {
    const got = Object.keys(item.spec).sort().join(',')
    return got === want ? null : `spec fields ${got} are not ${want}`
  }
}
