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
 * - `max_run_ok`: choice: no position on more than 3 consecutive trials as shown, the practice
 *   trials included (`max_run` is the longest run over practice + scored trials), so no run of 4
 *   forms across the practice → scored boundary either;
 * - `practice_positions_distinct`: choice: the 3 practice trials use 3 different positions;
 * - `key_matches_stimuli`: key.positions equals the stimulus positions (§14.6 ex. 12: key = position);
 * - `key_fields_exact`: the key holds exactly `positions`, what scoring needs (no test fixture:
 *   the scoring parity responses live in a separate dump, `synthetic.ts`);
 * - `structure_matches`: structural_params is the mode's structure (A11);
 * - `params_match_norms`: Gaussian lam = −s, d = β, sigma = τ_res of the mode's norm (A10);
 * - `stratum_matches`, `prior_matches`, `expected_time_matches`: the M1.P priors recomputed
 *   (`prior_matches` includes the provenance string);
 * - with the family's mode (M1.F2: one family per sub-task): `mode_matches_family`, and the
 *   facet of the mode's family.
 */

import type { JsonValue } from '../../engine'
import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { maxRunLength } from './gen'
import { RT_PROVENANCE, RT_STRATUM, rtDifficulty, rtExpectedTimeS, rtItemParams, rtStructure } from './prior'
import {
  FOREPERIOD_MAX_MS,
  FOREPERIOD_MIN_MS,
  MAX_POSITION_RUN,
  RT_MODE_CONFIG,
  RT_PRACTICE_TRIALS,
  RT_FACETS,
  isRtMode,
  rtFamilyName,
  type RtKey,
  type RtMode,
  type RtSpec,
} from './types'

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

function verifyUnchecked(item: ItemInstance<RtSpec, RtKey>, familyMode: RtMode | undefined): VerifyResult {
  const spec: unknown = item.spec
  if (!isPlainObject(spec) || !isRtMode(spec.mode)) return verdict({ mode_known: false })
  const mode = spec.mode
  const ofFamily: Record<string, JsonValue> =
    familyMode === undefined
      ? {}
      : { mode_matches_family: mode === familyMode, facet_matches: item.facet === RT_FACETS[familyMode] && item.family === rtFamilyName(familyMode) }
  const { practice_foreperiods_ms: pf, practice_positions: pp, foreperiods_ms: fp, positions: pos } = spec
  if (!(isIntArray(pf) && isIntArray(pp) && isIntArray(fp) && isIntArray(pos))) {
    return verdict({ mode_known: true, schedule_integer_arrays: false })
  }
  const cfg = RT_MODE_CONFIG[mode]
  const schedule: RtSpec = { mode, n_positions: cfg.n_positions, practice_foreperiods_ms: pf, practice_positions: pp, foreperiods_ms: fp, positions: pos }

  const trialCount = fp.length === cfg.n_trials && pos.length === cfg.n_trials
  const perPosition = cfg.n_trials / cfg.n_positions
  const counts = Array.from({ length: cfg.n_positions }, (_, p) => pos.filter((x) => x === p).length)
  const maxRun = maxRunLength([...pp, ...pos]) // as shown: practice, then scored (no break assumed)

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
    d.sd_prior === prior.sd_prior &&
    d.provenance === RT_PROVENANCE

  return verdict({
    mode_known: true,
    ...ofFamily,
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
    key_fields_exact: isPlainObject(key) && Object.keys(key).join(',') === 'positions',
    structure_matches: canonicalJson(item.structural_params) === canonicalJson(rtStructure(mode)),
    params_match_norms: paramsMatch,
    stratum_matches: item.stratum === RT_STRATUM,
    prior_matches: priorMatches,
    expected_time_matches: Math.abs(item.expected_time_s - rtExpectedTimeS(schedule)) <= EXPECTED_TIME_TOL,
  })
}

/**
 * The families' `verify`: never throws; a malformed instance fails with the error as its reason.
 * With `mode` (the family's), the block must be of that mode and family.
 */
export function verifyRt(item: ItemInstance<RtSpec, RtKey>, mode?: RtMode): VerifyResult {
  try {
    return verifyUnchecked(item, mode)
  } catch (e) {
    return { ok: false, reason: `malformed item: ${e instanceof Error ? e.message : String(e)}`, checks: {} }
  }
}
