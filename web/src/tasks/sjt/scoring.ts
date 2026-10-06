/**
 * Scoring a situational judgment response against its key profile (ROADMAP M6.2; DESIGN §5.3, §14.6 ex. 15).
 *
 * The bank's `hb.sjt.scoring` has the same two functions (`rating_score`, `most_least_score`) with the same arithmetic
 * and the same errors, and a later package pins them with shared golden vectors: the formulas and the order of the
 * operations below are a contract, so they are not rearranged or rounded.
 *
 * - {@link ratingScore}: the person rates each of the four responses 1 to 4; the score is
 *   `1 - sum_i |user_i - key_i| / (3 * 4)`, one minus the mean absolute distance on the 3-point range (§14.6 ex. 15:
 *   `1 - mean|user - key| / 3`). It lies in [0, 1], and is 1 exactly when the ratings equal an integer key.
 * - {@link mostLeastScore}: the person picks the response that would work best and the one that would work least well;
 *   the score is `((key[most] - kmin) + (kmax - key[least])) / (2 * (kmax - kmin))`. It lies in [0, 1], and is 1 exactly
 *   when `most` is a best-rated response and `least` a worst-rated one.
 *
 * Both throw a RangeError on malformed input: not four ratings, a rating that is not an integer from 1 to 4, a key value
 * that is not finite or lies outside [1, 4], a position that is not an integer from 0 to 3, `most === least`, or a key
 * that rates every response the same (`kmax === kmin`: it names no best and no worst).
 *
 * The key is the bank's (the ensemble of expert and AI ratings, blended with consensus, §5.2). This module only does the
 * arithmetic: the public repo holds no key, and the demo (`demo.ts`) scores against made-up ones.
 */

import { RATING_LEVELS, SJT_OPTIONS } from './spec'

const MIN = 1
/** The width of the rating scale (3): the largest distance one rating can be from the key. */
const RANGE = RATING_LEVELS - MIN

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

function checkRatings(user: unknown): readonly number[] {
  if (!Array.isArray(user) || user.length !== SJT_OPTIONS) throw new RangeError(`ratings must be ${SJT_OPTIONS} values`)
  for (const r of user) {
    if (!isInt(r) || r < MIN || r > RATING_LEVELS) throw new RangeError(`a rating is an integer ${MIN}..${RATING_LEVELS}, got ${String(r)}`)
  }
  return user as readonly number[]
}

function checkKey(key: unknown): readonly number[] {
  if (!Array.isArray(key) || key.length !== SJT_OPTIONS) throw new RangeError(`the key must be ${SJT_OPTIONS} values`)
  for (const k of key) {
    if (typeof k !== 'number' || !Number.isFinite(k) || k < MIN || k > RATING_LEVELS) throw new RangeError(`a key rating is a finite number in [${MIN}, ${RATING_LEVELS}], got ${String(k)}`)
  }
  return key as readonly number[]
}

function checkIndex(i: unknown, what: string): number {
  if (!isInt(i) || i < 0 || i >= SJT_OPTIONS) throw new RangeError(`${what} is a response position 0..${SJT_OPTIONS - 1}, got ${String(i)}`)
  return i
}

/** `1 - sum_i |user_i - key_i| / (3 * 4)`, in [0, 1]; `user` are four integer ratings, `key` four numbers in [1, 4] (display order). */
export function ratingScore(user: readonly number[], key: readonly number[]): number {
  const u = checkRatings(user)
  const k = checkKey(key)
  let sum = 0
  for (let i = 0; i < SJT_OPTIONS; i++) sum += Math.abs((u[i] as number) - (k[i] as number))
  return 1 - sum / (RANGE * SJT_OPTIONS)
}

/** `((key[most] - kmin) + (kmax - key[least])) / (2 * (kmax - kmin))`, in [0, 1]; `most` and `least` are different display positions. */
export function mostLeastScore(most: number, least: number, key: readonly number[]): number {
  const m = checkIndex(most, 'most')
  const w = checkIndex(least, 'least')
  const k = checkKey(key)
  if (m === w) throw new RangeError('most and least must be different responses')
  const lo = Math.min(...k)
  const hi = Math.max(...k)
  if (hi === lo) throw new RangeError('the key rates every response the same: no most or least')
  return (((k[m] as number) - lo) + (hi - (k[w] as number))) / (2 * (hi - lo))
}
