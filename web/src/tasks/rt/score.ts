/**
 * Trimming and the person estimate of an RT block (ROADMAP A10; DESIGN §7.1, §14.6 example 12).
 *
 * Trial outcomes, first match wins (practice trials are never scored):
 * 1. `miss`: no response (rt null);
 * 2. `anticipation`: response before onset (rt < 0), flagged;
 * 3. `error`: choice blocks only, the pressed position is not the stimulus position;
 * 4. `too_fast` / `too_slow`: outside the valid window, simple 150–1,500 ms, choice
 *    200–2,000 ms, both ends inclusive (§7.1 trimming);
 * 5. otherwise `valid`.
 *
 * With n valid trials (at least 20 simple / 30 choice, else no observation and the reason is
 * recorded), the estimate is x = median ln(rt) over the valid trials (mean of the two middle
 * values when n is even) with SE = 1.2533 · 1.4826 · MAD(ln rt) / √n, where MAD is the median
 * absolute deviation from x. The Gaussian observation is
 * `{ kind: 'gaussian', axis: 'RT', lam: −s, d: β, sigma: √(SE² + τ_res²), x }` with the
 * provisional norms of `prior.ts` (τ_res = `params.sigma`, the one meaning of a Gaussian block's
 * sigma, M1.F2); the device class and trial counts travel beside it. A malformed response throws
 * a `MalformedResponseError` (a RangeError, as in every family).
 *
 * As A10 specifies, SE has no floor: it is 0 when more than half of the valid log RTs are equal
 * (likely only with a coarse, quantised performance.now()), and sigma then falls to τ_res. The
 * clock-resolution check and any SE floor belong to the device check / M4.8 calibration.
 */

import { MalformedResponseError, blockScore, gaussianObservationSigma, type BlockScore, type ItemInstance } from '../family'
import { RT_NORMS_VERSION, rtNorm, rtParamsOfNorm } from './prior'
import {
  RT_MODE_CONFIG,
  RT_PRACTICE_TRIALS,
  type RtBlockResult,
  type RtDevice,
  type RtExpected,
  type RtKey,
  type RtMode,
  type RtObservationMeta,
  type RtResponse,
  type RtSpec,
  type RtTrialCounts,
  type TrialOutcome,
} from './types'

/** SE(median) / SE(mean) for a normal sample, √(π/2) to 4 decimals (A10). */
export const SE_MEDIAN_FACTOR = 1.2533
/** MAD → SD for a normal sample, 1/Φ⁻¹(3/4) to 4 decimals (A10). */
export const MAD_TO_SD = 1.4826

/** How one scored trial counts (see the module comment for the order). */
export function classifyTrial(mode: RtMode, rtMs: number | null, choice: number | null, position: number): TrialOutcome {
  const cfg = RT_MODE_CONFIG[mode]
  if (rtMs === null) return 'miss'
  if (rtMs < 0) return 'anticipation'
  if (mode === 'choice4' && choice !== position) return 'error'
  if (rtMs < cfg.min_rt_ms) return 'too_fast'
  if (rtMs > cfg.max_rt_ms) return 'too_slow'
  return 'valid'
}

function trialListProblems(
  label: string,
  rts: unknown,
  choices: unknown,
  n: number,
  nPositions: number,
): string[] {
  if (!Array.isArray(rts) || !Array.isArray(choices)) return [`${label}: rt_ms and choice must be arrays`]
  const out: string[] = []
  if (rts.length !== n || choices.length !== n) out.push(`${label}: need ${n} trials, got ${rts.length} rt_ms and ${choices.length} choices`)
  const m = Math.min(rts.length, choices.length)
  for (let i = 0; i < m; i++) {
    const rt: unknown = rts[i]
    const c: unknown = choices[i]
    if (rt !== null && !(typeof rt === 'number' && Number.isFinite(rt))) out.push(`${label}[${i}]: rt_ms must be a finite number or null`)
    if (c !== null && !(typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < nPositions)) {
      out.push(`${label}[${i}]: choice must be an integer 0–${nPositions - 1} or null`)
    }
    if ((rt === null) !== (c === null)) out.push(`${label}[${i}]: rt_ms and choice must both be null (no response) or both set`)
  }
  return out
}

/** Every way `response` fails to be a well-formed response to a block of this mode (empty = ok). */
export function rtResponseProblems(mode: RtMode, response: unknown): string[] {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return ['response must be an object']
  const r = response as Record<string, unknown>
  const cfg = RT_MODE_CONFIG[mode]
  const out = trialListProblems('trials', r.rt_ms, r.choice, cfg.n_trials, cfg.n_positions)
  const hasPracticeRt = r.practice_rt_ms !== undefined
  const hasPracticeChoice = r.practice_choice !== undefined
  if (hasPracticeRt !== hasPracticeChoice) out.push('practice_rt_ms and practice_choice must be given together')
  else if (hasPracticeRt) {
    out.push(...trialListProblems('practice', r.practice_rt_ms, r.practice_choice, RT_PRACTICE_TRIALS, cfg.n_positions))
  }
  return out
}

/** Median of a non-empty list (mean of the two middle values when the length is even). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('median(): empty list')
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

/** The A10 estimate from valid RTs in ms: x = median ln rt, MAD of ln rt about x, SE of x. */
export function rtEstimate(validRtsMs: readonly number[]): { x: number; mad: number; se: number; n: number } {
  const n = validRtsMs.length
  if (n === 0) throw new RangeError('rtEstimate(): no valid trials')
  const logs = validRtsMs.map((rt) => {
    if (!(Number.isFinite(rt) && rt > 0)) throw new RangeError(`rtEstimate(): RTs must be finite and > 0, got ${rt}`)
    return Math.log(rt)
  })
  const x = median(logs)
  const mad = median(logs.map((l) => Math.abs(l - x)))
  return { x, mad, se: (SE_MEDIAN_FACTOR * MAD_TO_SD * mad) / Math.sqrt(n), n }
}

/**
 * Score one block's responses (A10). `keyPositions` is the correct position per scored trial
 * (the item's `key.positions`). Throws a RangeError on a malformed response
 * ({@link rtResponseProblems}); an insufficient block is a normal result, not an error.
 */
export function scoreRtResponse(mode: RtMode, keyPositions: readonly number[], response: RtResponse, device: RtDevice): RtBlockResult {
  const problems = rtResponseProblems(mode, response)
  if (problems.length > 0) throw new MalformedResponseError(`malformed RT response: ${problems.join('; ')}`)
  const cfg = RT_MODE_CONFIG[mode]
  if (keyPositions.length !== cfg.n_trials) throw new RangeError(`need ${cfg.n_trials} key positions, got ${keyPositions.length}`)
  if (!(typeof device.device_class === 'string' && device.device_class.length > 0)) {
    throw new RangeError('device.device_class must be a non-empty string')
  }

  const counts: Record<TrialOutcome, number> = { miss: 0, anticipation: 0, error: 0, too_fast: 0, too_slow: 0, valid: 0 }
  const valid: number[] = []
  for (let i = 0; i < cfg.n_trials; i++) {
    const rt = response.rt_ms[i] as number | null
    const outcome = classifyTrial(mode, rt, response.choice[i] as number | null, keyPositions[i] as number)
    counts[outcome]++
    if (outcome === 'valid') valid.push(rt as number)
  }
  const trialCounts: RtTrialCounts = {
    n_valid: counts.valid,
    n_misses: counts.miss,
    n_anticipations: counts.anticipation,
    n_errors: counts.error,
    n_too_fast: counts.too_fast,
    n_too_slow: counts.too_slow,
  }
  const norm = rtNorm(mode, device.device_class)
  const meta: RtObservationMeta = {
    mode,
    n_trials: cfg.n_trials,
    min_valid: cfg.min_valid,
    ...trialCounts,
    device_class: device.device_class,
    ...(device.input_type === undefined ? {} : { input_type: device.input_type }),
    ...(device.rt_timestamp_source === undefined ? {} : { rt_timestamp_source: device.rt_timestamp_source }),
    ...(device.refresh_hz_est === undefined ? {} : { refresh_hz_est: device.refresh_hz_est }),
    norms_version: RT_NORMS_VERSION,
  }
  if (valid.length < cfg.min_valid) {
    return {
      status: 'no_observation',
      reason: 'too_few_valid_trials',
      detail: `${valid.length} valid ${mode} trials < ${cfg.min_valid} required`,
      meta,
    }
  }
  const { x, se } = rtEstimate(valid)
  return {
    status: 'ok',
    observation: { kind: 'gaussian', axis: 'RT', lam: -norm.s, d: norm.beta, sigma: gaussianObservationSigma(se, rtParamsOfNorm(norm)), x },
    se,
    meta,
  }
}

/** Score a block item's responses: {@link scoreRtResponse} against `item.key.positions`. */
export function rtBlockObservation(item: ItemInstance<RtSpec, RtKey>, response: RtResponse, device: RtDevice): RtBlockResult {
  return scoreRtResponse(item.spec.mode, item.key.positions, response, device)
}

/**
 * `score()` of an RT block family (M1.F2 {@link BlockScore}): the Gaussian observation, or none
 * with the reason (`too_few_valid_trials`). No integrity flags yet (anticipations and misses are
 * counted in {@link rtBlockObservation}'s `meta`). The device class only annotates the
 * observation, which does not depend on it while `rtNorm` has one norm per mode.
 *
 * The block `score(item, response)` contract has no device or input mode, so once the norms are
 * per device (§11.6, §13 "normed separately", M4.8) this function cannot pick the right one: the
 * session must then call {@link rtBlockObservation} with its `device.class` and `device.input`,
 * or the contract gains a score context (ROADMAP M4.8).
 */
export function rtBlockScore(item: ItemInstance<RtSpec, RtKey>, response: RtResponse): BlockScore {
  const r = rtBlockObservation(item, response, { device_class: 'unspecified' })
  return r.status === 'ok' ? blockScore(r.observation) : blockScore(null, [], [r.reason])
}

/** The part of a result the parity dump records (`synthetic.ts`): status, counts, and the observation + SE or the reason. */
export function expectedOf(result: RtBlockResult): RtExpected {
  const { n_valid, n_misses, n_anticipations, n_errors, n_too_fast, n_too_slow } = result.meta
  const counts = { n_valid, n_misses, n_anticipations, n_errors, n_too_fast, n_too_slow }
  return result.status === 'ok'
    ? { status: 'ok', ...counts, observation: result.observation, se: result.se }
    : { status: 'no_observation', ...counts, reason: result.reason }
}
