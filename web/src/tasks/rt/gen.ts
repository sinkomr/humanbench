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
 * The schedule is built with integer draws only, so `generate(seed)` rebuilds it bit for bit on
 * every JS engine (A11; ECMA-262 lets Math.exp/log/sin/cos differ by an ULP between engines). Only
 * β = params.d goes through Math.log. The key is the stimulus positions alone; the synthetic
 * responses of the scoring parity check are drawn separately (`synthetic.ts`, not in the item).
 *
 * Mode: `generate(seed)` picks simple or choice with probability ½ each, unless the seed ends in
 * a mode tag `#simple` / `#choice4` (before any `@s<k>` stratum suffix), which the session flow
 * uses to ask for a specific block ({@link rtBlockSeed}). The tag is part of the seed, so the
 * item still regenerates from its id alone (A11).
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import { RT_STRATUM, rtDifficulty, rtExpectedTimeS, rtItemParams, rtStructure } from './prior'
import {
  FOREPERIOD_MAX_MS,
  FOREPERIOD_MIN_MS,
  MAX_POSITION_RUN,
  RT_MODE_CONFIG,
  RT_PRACTICE_TRIALS,
  isRtMode,
  type RtKey,
  type RtMode,
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

/**
 * The family's `build` (see `defineFamily`): schedule, key, A10 params and priors. The key is the
 * stimulus positions only, what scoring needs (audit: no test fixture in production keys).
 */
export function buildRt(rng: Rng, ctx: BuildContext): BuiltItem<RtSpec, RtKey> {
  const mode: RtMode = modeOfSeed(ctx.seed) ?? (rng.next() < 0.5 ? 'simple' : 'choice4')
  const spec = drawSchedule(rng, mode)
  return {
    stratum: RT_STRATUM,
    spec,
    key: { positions: [...spec.positions] },
    structural_params: rtStructure(mode),
    difficulty: rtDifficulty(spec),
    expected_time_s: rtExpectedTimeS(spec),
    params: rtItemParams(mode),
  }
}
