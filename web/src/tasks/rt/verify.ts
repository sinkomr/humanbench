/**
 * Verifier of the `rt` family (gates G2/G3, DESIGN §4.1; ROADMAP M1.10, A1, A10). It recomputes
 * everything from the instance alone. Checks (each failure is named in `reason`):
 *
 * - `mode_known`: spec.mode is "simple" or "choice4" (otherwise nothing else can be checked);
 * - `schedule_integer_arrays`: the four schedule arrays are integer arrays (likewise);
 * - `spec_fields_exact`: spec holds exactly the six schedule fields (nothing else reaches the DOM);
 * - `n_positions_matches_mode`: 1 location (simple) or 4 (choice);
 * - `practice_count`: 3 practice trials; `trial_count`: 30 (simple) / 40 (choice) scored trials;
 * - `foreperiods_in_range`: every foreperiod, practice included, is an integer 800–2,000 ms;
 * - `positions_in_range`: every position is 0 (simple) or 0–3 (choice);
 * - `positions_balanced`: each position exactly n_trials / n_positions times (10 each in choice);
 * - `max_run_ok`: choice: no position on more than 3 consecutive scored trials;
 * - `practice_positions_distinct`: choice: the 3 practice trials use 3 different positions;
 * - `key_matches_stimuli`: key.positions equals the stimulus positions (§14.6 ex. 12: key = position);
 * - `structure_matches`: structural_params is the mode's structure (A11);
 * - `params_match_norms`: Gaussian lam = −s, d = β, sigma = τ_res of the mode's norm (A10);
 * - `stratum_matches`, `prior_matches`, `expected_time_matches`: the M1.P priors recomputed;
 * - `reference_well_formed`: the key's reference responses are a well-formed response;
 * - `reference_scores_match`: scoring them again gives the recorded status, counts, reason or
 *   observation and SE (floats to {@link REFERENCE_TOL}).
 */

import type { JsonValue } from '../../engine'
import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { maxRunLength } from './gen'
import { RT_STRATUM, rtDifficulty, rtExpectedTimeS, rtItemParams, rtStructure } from './prior'
import { expectedOf, rtResponseProblems, scoreRtResponse } from './score'
import {
  FOREPERIOD_MAX_MS,
  FOREPERIOD_MIN_MS,
  MAX_POSITION_RUN,
  RT_MODE_CONFIG,
  RT_PRACTICE_TRIALS,
  isRtMode,
  type RtExpected,
  type RtKey,
  type RtMode,
  type RtResponse,
  type RtSpec,
} from './types'

/** Tolerance for recomputed reference floats (x, SE, sigma, lam, d): the A1 parity bound. */
export const REFERENCE_TOL = 1e-12
/** Tolerance for the recomputed expected block time in seconds. */
export const EXPECTED_TIME_TOL = 1e-9

/** The spec's fields, in render order. */
export const RT_SPEC_FIELDS: readonly string[] = Object.freeze([
  'mode',
  'n_positions',
  'practice_foreperiods_ms',
  'practice_positions',
  'foreperiods_ms',
  'positions',
])

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isIntArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isInt)
const sameInts = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const close = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) <= REFERENCE_TOL

/** Every problem of a reference object (empty = well formed); practice responses are required. */
export function referenceProblems(mode: RtMode, ref: unknown): string[] {
  if (!isPlainObject(ref)) return ['reference must be an object']
  const out: string[] = []
  if (!(typeof ref.device_class === 'string' && ref.device_class.length > 0)) out.push('reference.device_class must be a non-empty string')
  if (ref.practice_rt_ms === undefined || ref.practice_choice === undefined) out.push('reference needs practice responses')
  out.push(...rtResponseProblems(mode, { rt_ms: ref.rt_ms, choice: ref.choice, practice_rt_ms: ref.practice_rt_ms, practice_choice: ref.practice_choice }))
  if (!isPlainObject(ref.expected)) out.push('reference.expected must be an object')
  return out
}

const COUNT_FIELDS = ['n_valid', 'n_misses', 'n_anticipations', 'n_errors', 'n_too_fast', 'n_too_slow'] as const

/** Whether a recorded expectation equals a recomputed one (same fields; floats to REFERENCE_TOL). */
export function expectedMatches(recorded: unknown, recomputed: RtExpected): boolean {
  if (!isPlainObject(recorded)) return false
  const fields = Object.keys(recorded).sort().join(',')
  if (fields !== Object.keys(recomputed).sort().join(',')) return false
  if (recorded.status !== recomputed.status) return false
  if (!COUNT_FIELDS.every((f) => recorded[f] === recomputed[f])) return false
  if (recomputed.status === 'no_observation') return recorded.reason === recomputed.reason
  const obs = recorded.observation
  const want = recomputed.observation
  if (!isPlainObject(obs) || want === undefined || recomputed.se === undefined) return false
  return (
    Object.keys(obs).sort().join(',') === 'axis,d,kind,lam,sigma,x' &&
    obs.kind === 'gaussian' &&
    obs.axis === 'RT' &&
    close(obs.lam, want.lam) &&
    close(obs.d, want.d) &&
    close(obs.sigma, want.sigma) &&
    close(obs.x, want.x) &&
    close(recorded.se, recomputed.se)
  )
}

function verifyUnchecked(item: ItemInstance<RtSpec, RtKey>): VerifyResult {
  const spec: unknown = item.spec
  if (!isPlainObject(spec) || !isRtMode(spec.mode)) return verdict({ mode_known: false })
  const mode = spec.mode
  const { practice_foreperiods_ms: pf, practice_positions: pp, foreperiods_ms: fp, positions: pos } = spec
  if (!(isIntArray(pf) && isIntArray(pp) && isIntArray(fp) && isIntArray(pos))) {
    return verdict({ mode_known: true, schedule_integer_arrays: false })
  }
  const cfg = RT_MODE_CONFIG[mode]
  const schedule: RtSpec = { mode, n_positions: cfg.n_positions, practice_foreperiods_ms: pf, practice_positions: pp, foreperiods_ms: fp, positions: pos }

  const trialCount = fp.length === cfg.n_trials && pos.length === cfg.n_trials
  const perPosition = cfg.n_trials / cfg.n_positions
  const counts = Array.from({ length: cfg.n_positions }, (_, p) => pos.filter((x) => x === p).length)
  const maxRun = maxRunLength(pos)

  const key: unknown = item.key
  const keyPositions = isPlainObject(key) ? key.positions : undefined
  const keyMatches = isIntArray(keyPositions) && sameInts(keyPositions, pos)

  const want = rtItemParams(mode)
  const p = item.params
  const paramsMatch = p.model === 'gaussian' && p.lam === want.lam && p.d === want.d && p.sigma === want.sigma

  const d = item.difficulty
  const prior = fp.length > 0 ? rtDifficulty(schedule) : undefined // no mean foreperiod without trials
  const priorMatches =
    prior !== undefined &&
    canonicalJson(d.features as JsonValue) === canonicalJson(prior.features as JsonValue) &&
    d.b_prior === prior.b_prior &&
    d.sd_prior === prior.sd_prior

  const ref = isPlainObject(key) ? key.reference : undefined
  const refProblems = referenceProblems(mode, ref)
  let refStatus: string = 'unscored'
  let refValid = -1
  let refMatches = false
  if (refProblems.length === 0 && isIntArray(keyPositions) && keyPositions.length === cfg.n_trials) {
    const r = ref as Record<string, unknown>
    const recomputed = expectedOf(scoreRtResponse(mode, keyPositions, r as unknown as RtResponse, { device_class: r.device_class as string }))
    refStatus = recomputed.status
    refValid = recomputed.n_valid
    refMatches = expectedMatches(r.expected, recomputed)
  }

  return verdict({
    mode_known: true,
    schedule_integer_arrays: true,
    spec_fields_exact: Object.keys(spec).sort().join(',') === [...RT_SPEC_FIELDS].sort().join(','),
    n_positions_matches_mode: spec.n_positions === cfg.n_positions,
    practice_count: pf.length === RT_PRACTICE_TRIALS && pp.length === RT_PRACTICE_TRIALS,
    trial_count: trialCount,
    foreperiods_in_range: [...pf, ...fp].every((x) => x >= FOREPERIOD_MIN_MS && x <= FOREPERIOD_MAX_MS),
    positions_in_range: [...pp, ...pos].every((x) => x >= 0 && x < cfg.n_positions),
    positions_balanced: pos.length === cfg.n_trials && counts.every((c) => c === perPosition),
    max_run: maxRun,
    max_run_ok: mode === 'simple' || maxRun <= MAX_POSITION_RUN,
    practice_positions_distinct: mode === 'simple' || new Set(pp).size === pp.length,
    key_matches_stimuli: keyMatches,
    structure_matches: canonicalJson(item.structural_params) === canonicalJson(rtStructure(mode)),
    params_match_norms: paramsMatch,
    stratum_matches: item.stratum === RT_STRATUM,
    prior_matches: priorMatches,
    expected_time_matches: Math.abs(item.expected_time_s - rtExpectedTimeS(schedule)) <= EXPECTED_TIME_TOL,
    reference_well_formed: refProblems.length === 0,
    reference_status: refStatus,
    reference_n_valid: refValid,
    reference_scores_match: refMatches,
  })
}

/** The family's `verify`: never throws; a malformed instance fails with the error as its reason. */
export function verifyRt(item: ItemInstance<RtSpec, RtKey>): VerifyResult {
  try {
    return verifyUnchecked(item)
  } catch (e) {
    return { ok: false, reason: `malformed item: ${e instanceof Error ? e.message : String(e)}`, checks: {} }
  }
}
