/**
 * Scoring a Fermi answer: log error, 80% interval, summary (ROADMAP M5.1; DESIGN §3 rows 11–12, §7.1,
 * §14.6 ex. 8–9). The TS mirror of the bank's `hb.fermi.scoring` and `hb.fermi.truth`, held to
 * `golden/fermi_scoring_v1.json` (A17, `scoring.test.ts`, tolerance 1e-9). From M2 on the server is
 * authoritative (A1) and this is display and offline scoring; no finite Fermi item or truth value is
 * in this repo, so the only truths it sees are the synthetic demo item's (`demo.ts`) and the golden
 * file's synthetic ones.
 *
 * A Fermi answer is a best guess, a unit and an 80% interval ({@link FermiResponse}). It is scored
 * against the item's truth (a value, a unit and its uncertainty in dex), after converting the answer to
 * the truth's unit in log space, so the size of the answer is judged and never its unit:
 *
 * - **log error** e = log10(estimate / truth) in dex, signed; x = −|e| is the Gaussian observation on
 *   θ_FER of §7.1 (`priors.ts` `fermiX`, `fermiParams`). §14.6 ex. 8: 3·10^7 s against 3.156·10^7 s is
 *   0.022 dex;
 * - **truth uncertainty**: a truth known to ±u dex is full weight up to 0.15 dex, down-weighted above
 *   it by (0.15 / u)² up to 0.3 dex (the item's observation sigma is multiplied by u / 0.15), and a
 *   truth above 0.3 dex is rejected: it is no item (bank record rule, DESIGN §4.2). {@link fermiSe} is
 *   that scaling written as the block's own sampling error, which `gaussianObservationSigma` turns
 *   into the same sigma. The item's params row does not carry u (the bank keeps it in the private
 *   key), so whoever scores a real item must pass u in: on the server (M2) from `item_keys`;
 *   {@link fermiObservation} takes it as an argument;
 * - **the interval** [low, high] is the answer's 80% interval. It *hits* when the truth is inside, ends
 *   included ({@link HIT_TOL_DEX} absorbs rounding at an end). Its **interval score** is the
 *   Gneiting–Raftery score of a central 80% interval in dex, width + 10·(how far the truth lies
 *   outside): a proper score, minimised by stating one's true 10% and 90% quantiles, which a hit rate
 *   alone is not (a very wide interval always hits);
 * - **across a session** {@link summarise} gives the weighted mean error, the hit rate with its
 *   calibration-in-the-large (0.8 − hit rate: the stated confidence less the accuracy, DESIGN §7.1,
 *   the sign of `calibration.ts`; positive means intervals too narrow), the mean interval score and
 *   the Brier score of the 80% statements, (0.8 − hit)². The embedded calibration axis keeps taking
 *   its Brier score from the confidence ratings of tier-a answers (`calibration.ts`); whether interval
 *   hits also enter θ_CAL is decided with the M4.8 calibration.
 */

import type { Observation } from '../../engine/types'
import { gaussianObservationSigma, MalformedResponseError } from '../family'
import { FERMI_NORMS, fermiParams } from '../priors'
import { isUnit, log10Between, unitOf } from './units'

/** Up to this uncertainty (dex) a truth has full weight (DESIGN §4.2). */
export const UNCERTAINTY_FULL_WEIGHT_DEX = 0.15
/** Above this uncertainty (dex) an item is rejected (DESIGN §4.2). */
export const UNCERTAINTY_REJECT_DEX = 0.3
/** Coverage of a Fermi interval, percent and probability; ALPHA is the total tail outside it. */
export const INTERVAL_PCT = 80
export const INTERVAL_COVERAGE = 0.8
export const INTERVAL_ALPHA = 0.2
/** A truth within this many dex of an interval end is inside. */
export const HIT_TOL_DEX = 1e-9
/** A typed magnitude lies in [1e-30, 1e30], whatever the unit. */
export const MAGNITUDE_MIN = 1e-30
export const MAGNITUDE_MAX = 1e30
/** An interval spanning more than this many dex is not an estimate and does not count. */
export const MAX_INTERVAL_DEX = 8

/** Parity tolerance with the bank (`golden/fermi_scoring_v1.json`). */
export const GOLDEN_TOLERANCE = 1e-9

function checkUncertainty(u: number): void {
  if (!(typeof u === 'number' && Number.isFinite(u) && u >= 0)) throw new RangeError(`uncertainty must be a finite number ≥ 0 dex, got ${String(u)}`)
  if (u > UNCERTAINTY_REJECT_DEX) throw new RangeError(`a truth uncertain by ${u} dex is rejected (above ${UNCERTAINTY_REJECT_DEX} dex)`)
}

/** The weight of a truth uncertain by `u` dex: 1 up to 0.15, (0.15 / u)² up to 0.3; throws a RangeError above 0.3 or for a bad value. */
export function truthWeight(u: number): number {
  checkUncertainty(u)
  return u <= UNCERTAINTY_FULL_WEIGHT_DEX ? 1 : (UNCERTAINTY_FULL_WEIGHT_DEX / u) ** 2
}

/** The factor the observation's sigma is multiplied by for this truth: 1 / √weight = max(1, u / 0.15). */
export function sigmaScale(u: number): number {
  return 1 / Math.sqrt(truthWeight(u))
}

/** Which zone an uncertainty is in: full weight, down-weighted, or rejected. */
export function weightZone(u: number): 'full' | 'down_weighted' | 'rejected' {
  if (!(typeof u === 'number' && Number.isFinite(u) && u >= 0)) throw new RangeError(`uncertainty must be a finite number ≥ 0 dex, got ${String(u)}`)
  if (u > UNCERTAINTY_REJECT_DEX) return 'rejected'
  return u <= UNCERTAINTY_FULL_WEIGHT_DEX ? 'full' : 'down_weighted'
}

/**
 * The block's own sampling error that carries a truth's uncertainty: the SE for which
 * √(SE² + τ_res²) = τ_res · u / 0.15 (0 up to 0.15 dex).
 */
export function fermiSe(u: number): number {
  const k = sigmaScale(u)
  return FERMI_NORMS.residual_sd_dex * Math.sqrt(Math.max(0, k * k - 1))
}

/** A taker's answer: the best guess and its 80% interval, all in `unit`. */
export interface FermiResponse {
  readonly value: number
  readonly unit: string
  readonly low: number
  readonly high: number
}

/** The key side of a Fermi item that scoring needs (`item_keys.key`; the bank's `FermiTruth`). */
export interface FermiTruth {
  /** The truth in `unit`, as decimal text (`"31557600"`, `"3.15576e7"`). */
  readonly true_value: string
  readonly unit: string
  /** Half-width of the truth's uncertainty in dex, 0 … 0.3. */
  readonly true_value_uncertainty_log10: number
}

/** The shape of `true_value`: a positive decimal in plain or scientific notation. */
export const TRUE_VALUE_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]{1,3})?$/

/** `true_value` as a number; throws a RangeError unless it is a positive finite decimal of the {@link TRUE_VALUE_RE} shape. */
export function parseTrueValue(text: string): number {
  if (!(typeof text === 'string' && TRUE_VALUE_RE.test(text))) throw new RangeError(`true_value ${JSON.stringify(text)} is not a positive decimal such as 31557600 or 3.2e7`)
  const v = Number(text)
  if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`true_value ${JSON.stringify(text)} is not a finite number > 0`)
  return v
}

function validTruth(t: FermiTruth): number {
  const v = parseTrueValue(t.true_value)
  unitOf(t.unit)
  checkUncertainty(t.true_value_uncertainty_log10)
  return v
}

/** Whether `v` is a typed magnitude: a finite number within [{@link MAGNITUDE_MIN}, {@link MAGNITUDE_MAX}]. */
export function isMagnitude(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= MAGNITUDE_MIN && v <= MAGNITUDE_MAX
}

/**
 * A response of its JSON form `{ value, unit, low, high }` (no other field), checked: the three
 * numbers are magnitudes, the unit is registered, low ≤ value ≤ high, and the interval spans at most
 * {@link MAX_INTERVAL_DEX} dex. Throws a {@link MalformedResponseError} otherwise (the bank's
 * `MalformedFermiResponse`).
 */
export function parseFermiResponse(raw: unknown): FermiResponse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new MalformedResponseError('a Fermi response is {value, unit, low, high}')
  const keys = Object.keys(raw).sort().join(',')
  if (keys !== 'high,low,unit,value') throw new MalformedResponseError('a Fermi response is {value, unit, low, high}')
  const { value, unit, low, high } = raw as Record<string, unknown>
  for (const [name, v] of [['value', value], ['low', low], ['high', high]] as const) {
    if (!isMagnitude(v)) throw new MalformedResponseError(`${name} must be a number between ${MAGNITUDE_MIN} and ${MAGNITUDE_MAX}, got ${String(v)}`)
  }
  if (!isUnit(unit)) throw new MalformedResponseError(`unknown unit ${JSON.stringify(unit)}`)
  const r = { value: value as number, unit, low: low as number, high: high as number }
  if (!(r.low <= r.value && r.value <= r.high)) throw new MalformedResponseError('the interval must contain the best guess: low ≤ value ≤ high')
  if (Math.log10(r.high) - Math.log10(r.low) > MAX_INTERVAL_DEX) throw new MalformedResponseError(`the interval spans more than ${MAX_INTERVAL_DEX} dex: narrow it`)
  return Object.freeze(r)
}

/** One answer scored against its truth (snake_case as in the golden file and the bank's `FermiScore`). */
export interface FermiScore {
  /** e = log10(estimate / truth), signed (positive: too high). */
  readonly error_dex: number
  readonly abs_error_dex: number
  /** −|e|: the Gaussian observation's statistic on θ_FER. */
  readonly x: number
  /** 10^|e|: the answer was off by this factor (1 is exact). */
  readonly factor: number
  readonly weight: number
  /** log10(low / truth): above 0 when the truth is below the interval. */
  readonly low_error_dex: number
  /** log10(high / truth): below 0 when the truth is above the interval. */
  readonly high_error_dex: number
  readonly width_dex: number
  readonly hit: boolean
  /** Gneiting–Raftery interval score of the 80% interval, in dex (lower is better). */
  readonly interval_score_dex: number
}

/** The Gneiting–Raftery score of a central 80% interval in dex (see the module comment). */
export function intervalScore(widthDex: number, lowErrorDex: number, highErrorDex: number): number {
  const penalty = 2 / INTERVAL_ALPHA
  return widthDex + penalty * Math.max(0, lowErrorDex) + penalty * Math.max(0, -highErrorDex)
}

/**
 * Score `response` against `truth`. Throws a {@link MalformedResponseError} if the response's unit is
 * of another dimension than the truth's, a RangeError for a truth that is not valid.
 */
export function scoreFermi(response: FermiResponse, truth: FermiTruth): FermiScore {
  const trueValue = validTruth(truth)
  let est: number
  let lo: number
  let hi: number
  try {
    est = log10Between(response.value, response.unit, truth.unit)
    lo = log10Between(response.low, response.unit, truth.unit)
    hi = log10Between(response.high, response.unit, truth.unit)
  } catch (e) {
    if (e instanceof RangeError && e.name === 'UnitError') throw new MalformedResponseError(e.message)
    throw e
  }
  const t = Math.log10(trueValue)
  const e = est - t
  const lowErr = lo - t
  const highErr = hi - t
  const width = hi - lo
  return {
    error_dex: e,
    abs_error_dex: Math.abs(e),
    x: 0 - Math.abs(e),
    factor: 10 ** Math.abs(e),
    weight: truthWeight(truth.true_value_uncertainty_log10),
    low_error_dex: lowErr,
    high_error_dex: highErr,
    width_dex: width,
    hit: lowErr <= HIT_TOL_DEX && highErr >= -HIT_TOL_DEX,
    interval_score_dex: intervalScore(width, lowErr, highErr),
  }
}

/**
 * The Gaussian observation on θ_FER of a scored answer, for an item of difficulty δ (θ units, default
 * 0): x ~ N(lam·θ + d, √(SE² + τ_res²)) with SE = {@link fermiSe}.
 */
export function fermiObservation(score: FermiScore, uncertaintyLog10: number, delta = 0): Extract<Observation, { kind: 'gaussian' }> {
  const params = fermiParams(delta)
  return {
    kind: 'gaussian',
    axis: 'FER',
    lam: params.lam,
    d: params.d,
    sigma: gaussianObservationSigma(fermiSe(uncertaintyLog10), params),
    x: score.x,
  }
}

/** A session's Fermi answers together, weighted by {@link FermiScore.weight}. */
export interface FermiSummary {
  readonly n: number
  readonly total_weight: number
  /** Weighted mean of |e|. */
  readonly mean_abs_error_dex: number
  /** Unweighted median of |e|. */
  readonly median_abs_error_dex: number
  /** Weighted share of 80% intervals that contained the truth. */
  readonly hit_rate: number
  /**
   * 0.8 − hit_rate, calibration-in-the-large of the 80% statements (DESIGN §7.1, mean confidence −
   * accuracy; the sign of `CalibrationSummary.in_the_large`): positive means intervals too narrow
   * (more sure than right).
   */
  readonly in_the_large: number
  readonly mean_interval_score_dex: number
  /** Weighted mean of (0.8 − hit)²: the Brier score of the 80% statements (§14.6 ex. 9). */
  readonly interval_brier: number
}

/** The {@link FermiSummary} of scored answers, or null with none. */
export function summarise(scores: readonly FermiScore[]): FermiSummary | null {
  if (scores.length === 0) return null
  const w = scores.map((s) => s.weight)
  const total = w.reduce((a, b) => a + b, 0)
  const mean = (values: readonly number[]): number => values.reduce((a, v, i) => a + v * (w[i] as number), 0) / total
  const hits = scores.map((s) => (s.hit ? 1 : 0))
  const rate = mean(hits)
  const sorted = scores.map((s) => s.abs_error_dex).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  return {
    n: scores.length,
    total_weight: total,
    mean_abs_error_dex: mean(scores.map((s) => s.abs_error_dex)),
    median_abs_error_dex: median,
    hit_rate: rate,
    in_the_large: INTERVAL_COVERAGE - rate,
    mean_interval_score_dex: mean(scores.map((s) => s.interval_score_dex)),
    interval_brier: mean(hits.map((h) => (INTERVAL_COVERAGE - h) ** 2)),
  }
}

/** The best guess expressed in `toUnit` (display only; scoring stays in log space). */
export function estimateInUnit(response: FermiResponse, toUnit: string): number {
  return 10 ** log10Between(response.value, response.unit, toUnit)
}
