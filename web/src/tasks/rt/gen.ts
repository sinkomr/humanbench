/**
 * Seeded trial-schedule generator of the `rt` family (ROADMAP M1.10; DESIGN §3 row 9,
 * §14.6 example 12). Draws only from the provided stream (family contract).
 *
 * A block is 3 practice trials, then 30 (simple) or 40 (4-choice) scored trials. Every
 * foreperiod is a uniform integer 800–2,000 ms. Choice blocks practise on 3 distinct positions,
 * then show each position 0–3 exactly 10 times, with no position on more than 3 consecutive
 * trials as shown, counting across the practice → scored boundary (a uniform draw among such
 * sequences: shuffle, reject, repeat). Simple blocks use position 0 throughout.
 *
 * The schedule and the reference responses are built with integer arithmetic and correctly
 * rounded IEEE operations only, so `generate(seed)` rebuilds them bit for bit on every JS engine
 * (A11; ECMA-262 lets Math.exp/log/sin/cos differ by an ULP between engines). Only the values
 * that go through Math.log (β = params.d, and the reference's x, SE and sigma) may differ in the
 * last bits, which `verify()` tolerates (REFERENCE_TOL).
 *
 * Mode: `generate(seed)` picks simple or choice with probability ½ each, unless the seed ends in
 * a mode tag `#simple` / `#choice4` (before any `@s<k>` stratum suffix), which the session flow
 * uses to ask for a specific block ({@link rtBlockSeed}). The tag is part of the seed, so the
 * item still regenerates from its id alone (A11).
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import { RT_STRATUM, RT_WEB_NORMS, rtDifficulty, rtExpectedTimeS, rtItemParams, rtStructure } from './prior'
import { expectedOf, scoreRtResponse } from './score'
import {
  FOREPERIOD_MAX_MS,
  FOREPERIOD_MIN_MS,
  MAX_POSITION_RUN,
  RT_MODE_CONFIG,
  RT_PRACTICE_TRIALS,
  isRtMode,
  type RtKey,
  type RtMode,
  type RtReference,
  type RtSpec,
} from './types'

const MODE_TAG_RE = /#(simple|choice4)(?:@s[1-6])?$/

/** The mode a seed's tag asks for (`…#simple`, `…#choice4`, optionally followed by `@s<k>`), else undefined. */
export function modeOfSeed(seed: string): RtMode | undefined {
  const m = MODE_TAG_RE.exec(seed)
  return m && isRtMode(m[1]) ? m[1] : undefined
}

/** A seed that generates a block of the given mode: `<base>#<mode>`. */
export function rtBlockSeed(base: string, mode: RtMode): string {
  if (typeof base !== 'string' || base.length === 0) throw new RangeError('rtBlockSeed(): base seed must be a non-empty string')
  if (!isRtMode(mode)) throw new RangeError(`rtBlockSeed(): unknown mode ${JSON.stringify(mode)}`)
  return `${base}#${mode}`
}

/** Longest run of equal consecutive values (0 for an empty list). */
export function maxRunLength(seq: readonly number[]): number {
  let best = 0
  let run = 0
  for (let i = 0; i < seq.length; i++) {
    run = i > 0 && seq[i] === seq[i - 1] ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

/** `n` foreperiods, uniform integers in [800, 2000] ms. */
export function drawForeperiods(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.int(FOREPERIOD_MIN_MS, FOREPERIOD_MAX_MS))
}

/** Shuffles tried before {@link drawBalancedPositions} gives up (P(accept) ≈ 0.75 per shuffle for 4 × 10, runs ≤ 3). */
export const MAX_SHUFFLE_ATTEMPTS = 10_000

/**
 * Each of `nPositions` positions exactly `perPosition` times, with no run longer than `maxRun`
 * in `prefix` followed by the sequence (`prefix` = the practice positions shown before it):
 * uniform among such sequences (rejection sampling over uniform shuffles).
 */
export function drawBalancedPositions(rng: Rng, nPositions: number, perPosition: number, maxRun: number, prefix: readonly number[] = []): number[] {
  const base: number[] = []
  for (let p = 0; p < nPositions; p++) for (let k = 0; k < perPosition; k++) base.push(p)
  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt++) {
    const seq = rng.shuffle(base)
    if (maxRunLength([...prefix, ...seq]) <= maxRun) return seq
  }
  throw new Error(`drawBalancedPositions(): no sequence with runs ≤ ${maxRun} in ${MAX_SHUFFLE_ATTEMPTS} shuffles`)
}

/** Draw a block's trial schedule (the render payload). */
export function drawSchedule(rng: Rng, mode: RtMode): RtSpec {
  const cfg = RT_MODE_CONFIG[mode]
  const practiceForeperiods = drawForeperiods(rng, RT_PRACTICE_TRIALS)
  const practicePositions = mode === 'simple' ? Array<number>(RT_PRACTICE_TRIALS).fill(0) : rng.shuffle([0, 1, 2, 3]).slice(0, RT_PRACTICE_TRIALS)
  const foreperiods = drawForeperiods(rng, cfg.n_trials)
  const positions =
    mode === 'simple'
      ? Array<number>(cfg.n_trials).fill(0)
      : drawBalancedPositions(rng, cfg.n_positions, cfg.n_trials / cfg.n_positions, MAX_POSITION_RUN, practicePositions)
  return {
    mode,
    n_positions: cfg.n_positions,
    practice_foreperiods_ms: practiceForeperiods,
    practice_positions: practicePositions,
    foreperiods_ms: foreperiods,
    positions,
  }
}

/** Device classes the synthetic reference responses are attributed to. */
export const REFERENCE_DEVICE_CLASSES: readonly string[] = Object.freeze(['desktop', 'tablet', 'phone'])

interface LapseProfile {
  /** The person's median RT in tenths of a ms. */
  readonly centre_t: number
  /** Half-width in per mille of each of the 4 uniform noise terms (relative SD ≈ 1.15 · spread / 1000). */
  readonly spread_pm: number
  readonly miss: number
  readonly antic: number
  readonly err: number
  /** Share of responded trials whose RT is replaced by a trimming boundary value. */
  readonly edge: number
}

/**
 * One synthetic RT in tenths of a ms: the centre scaled by 1 + (noise + tail) / 1000, where the
 * noise is a sum of 4 uniform per-mille integers (roughly normal, and above −1000 ‰, so the RT
 * stays positive) and the slow tail (0–150 %) hits one trial in five. Integers only.
 */
function drawRtTenths(rng: Rng, p: LapseProfile): number {
  let noise = 0
  for (let j = 0; j < 4; j++) noise += rng.int(-p.spread_pm, p.spread_pm)
  const tail = rng.int(0, 4) === 0 ? rng.int(0, 1500) : 0
  return p.centre_t + Math.trunc((p.centre_t * (noise + tail)) / 1000)
}

function drawTrials(rng: Rng, mode: RtMode, positions: readonly number[], p: LapseProfile): { rt: (number | null)[]; choice: (number | null)[] } {
  const cfg = RT_MODE_CONFIG[mode]
  // The trimming boundaries and 0.1 ms outside them, plus 0 (a press exactly at onset), in tenths.
  const edgesT = [cfg.min_rt_ms * 10 - 1, cfg.min_rt_ms * 10, cfg.max_rt_ms * 10, cfg.max_rt_ms * 10 + 1, 0]
  const rt: (number | null)[] = []
  const choice: (number | null)[] = []
  for (const position of positions) {
    const u = rng.next()
    if (u < p.miss) {
      rt.push(null)
      choice.push(null)
    } else if (u < p.miss + p.antic) {
      rt.push(-rng.int(1, 5000) / 10) // 0.1–500 ms before onset
      choice.push(mode === 'simple' ? 0 : rng.int(0, cfg.n_positions - 1))
    } else {
      rt.push((rng.next() < p.edge ? rng.pick(edgesT) : drawRtTenths(rng, p)) / 10)
      if (mode === 'simple') choice.push(0)
      else choice.push(rng.next() < p.err ? (position + rng.int(1, cfg.n_positions - 1)) % cfg.n_positions : position)
    }
  }
  return { rt, choice }
}

/**
 * Synthetic responses to a schedule for the key's scoring self-check: a person whose median RT
 * is 0.8–1.25 × the norm, with lapses (misses, anticipations, wrong positions, boundary RTs).
 * About 1 block in 5 is "sloppy" (lapse rates 5–30% each), so some blocks fall below the
 * valid-trial minimum. RTs are whole tenths of a ms drawn with integer arithmetic only.
 */
export function drawReferenceResponses(rng: Rng, spec: RtSpec): Omit<RtReference, 'expected'> {
  const sloppy = rng.next() < 0.2
  const lapse = (): number => (sloppy ? 0.05 + 0.25 * rng.next() : 0.05 * rng.next())
  const profile: LapseProfile = {
    centre_t: Math.floor((RT_WEB_NORMS[spec.mode].median_rt_ms * rng.int(800, 1250)) / 100),
    spread_pm: rng.int(30, 180),
    miss: lapse(),
    antic: lapse(),
    err: lapse(),
    edge: 0.05,
  }
  const deviceClass = rng.pick(REFERENCE_DEVICE_CLASSES)
  const practice = drawTrials(rng, spec.mode, spec.practice_positions, profile)
  const scored = drawTrials(rng, spec.mode, spec.positions, profile)
  return {
    device_class: deviceClass,
    practice_rt_ms: practice.rt,
    practice_choice: practice.choice,
    rt_ms: scored.rt,
    choice: scored.choice,
  }
}

/** The family's `build` (see `defineFamily`): schedule, key with its scoring reference, A10 params and priors. */
export function buildRt(rng: Rng, ctx: BuildContext): BuiltItem<RtSpec, RtKey> {
  const mode: RtMode = modeOfSeed(ctx.seed) ?? (rng.next() < 0.5 ? 'simple' : 'choice4')
  const spec = drawSchedule(rng, mode)
  const responses = drawReferenceResponses(rng.fork('reference'), spec)
  const expected = expectedOf(scoreRtResponse(mode, spec.positions, responses, { device_class: responses.device_class }))
  return {
    stratum: RT_STRATUM,
    spec,
    key: { positions: [...spec.positions], reference: { ...responses, expected } },
    structural_params: rtStructure(mode),
    difficulty: rtDifficulty(spec),
    expected_time_s: rtExpectedTimeS(spec),
    params: rtItemParams(mode),
  }
}
