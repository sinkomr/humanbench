/**
 * Synthetic response streams for coding blocks and the TS → bank scoring parity dump
 * (ROADMAP M1.11, A1, A17). TEST SUPPORT ONLY: used by the coding tests and `dump-scores.ts`,
 * never by the app.
 *
 * The item dump (`golden/ts_dumps/coding.json`, `npm run dump:families`) carries instances only,
 * so the observation parity has its own dump, `golden/ts_dumps/coding_scores.json`: for each
 * dumped block (seeds `dump-<i>`) one response stream from a synthetic taker and the TS outcome
 * (counts, flags, rate and the engine observation). The bank's Python scorer recomputes every
 * outcome from the stream and must agree (integers and flags exactly, floats to 1e-12).
 */

import { createRng, type Rng } from '../../engine'
import { canonicalJson } from '../ids'
import { CODING_DIGITS, type CodingItem, type CodingResponse, type CodingSymbol } from './config'
import { codingOutcome, type CodingOutcome } from './score'
import { coding } from '.'

/** A synthetic taker: pace, error probability and variability of the inter-response times. */
export interface TakerProfile {
  readonly name: string
  /** Mean responses per minute (right or wrong). */
  readonly rate_per_min: number
  /** Probability that a response is a wrong digit. */
  readonly error_p: number
  /** Coefficient of variation of the (lognormal) inter-response times. */
  readonly cv: number
  /** Keep responding until this time (ms); past the window, so some responses are late. */
  readonly until_ms: number
}

/** A wrong key for a stimulus whose digit is `right`: uniform over the other keys 0–9. */
function wrongDigit(rng: Rng, right: number): number {
  return rng.pick([0, ...CODING_DIGITS].filter((d) => d !== right))
}

/**
 * The response stream of a synthetic taker on `item`: lognormal inter-response times with mean
 * 60,000 / rate ms and the profile's CV, times rounded to 1 µs, a wrong digit with probability
 * error_p, until `until_ms` or the end of the stream.
 */
export function syntheticResponses(item: CodingItem, profile: TakerProfile, rng: Rng): CodingResponse[] {
  const mean = 60_000 / profile.rate_per_min
  const sd = Math.sqrt(Math.log(1 + profile.cv * profile.cv))
  const out: CodingResponse[] = []
  let t = 0
  for (const glyph of item.spec.sequence) {
    t += mean * Math.exp(sd * rng.normal() - (sd * sd) / 2)
    const tMs = Math.round(t * 1000) / 1000
    if (tMs > profile.until_ms) break
    const right = item.key.table[glyph]
    out.push({ digit: rng.next() < profile.error_p ? wrongDigit(rng, right) : right, t_ms: tMs })
  }
  return out
}

/** The first `n` stimuli answered at `times[k]`, wrong exactly where `wrong(k)`. */
export function scriptedResponses(item: CodingItem, times: readonly number[], wrong: (k: number) => boolean = () => false): CodingResponse[] {
  return times.map((t_ms, k) => {
    const right = item.key.table[item.spec.sequence[k] as CodingSymbol]
    return { digit: wrong(k) ? (right % 9) + 1 : right, t_ms }
  })
}

/** Evenly spaced times: response k at (k + 1) · step ms. */
export const evenTimes = (n: number, step: number): number[] => Array.from({ length: n }, (_, k) => (k + 1) * step)

const W = 90_000

/** How the parity dump builds the stream of case i (cycled over the dumped blocks). */
export const DUMP_STREAMS: readonly { readonly name: string; readonly build: (item: CodingItem, rng: Rng) => CodingResponse[] }[] = [
  { name: 'typical', build: (it, rng) => syntheticResponses(it, { name: 'typical', rate_per_min: 42, error_p: 0.03, cv: 0.35, until_ms: 92_000 }, rng) },
  { name: 'fast', build: (it, rng) => syntheticResponses(it, { name: 'fast', rate_per_min: 80, error_p: 0.01, cv: 0.25, until_ms: 92_000 }, rng) },
  { name: 'slow', build: (it, rng) => syntheticResponses(it, { name: 'slow', rate_per_min: 14, error_p: 0.06, cv: 0.6, until_ms: 95_000 }, rng) },
  { name: 'sloppy', build: (it, rng) => syntheticResponses(it, { name: 'sloppy', rate_per_min: 50, error_p: 0.3, cv: 0.4, until_ms: 91_000 }, rng) },
  { name: 'ceiling', build: (it, rng) => syntheticResponses(it, { name: 'ceiling', rate_per_min: 180, error_p: 0.02, cv: 0.15, until_ms: W }, rng) },
  {
    name: 'random',
    build: (it, rng) =>
      syntheticResponses(
        it,
        { name: 'random', rate_per_min: 5 + 115 * rng.next(), error_p: 0.5 * rng.next(), cv: 0.1 + 0.8 * rng.next(), until_ms: 90_000 + 5_000 * rng.next() },
        rng,
      ),
  },
  { name: 'empty', build: () => [] },
  { name: 'all_wrong', build: (it) => scriptedResponses(it, evenTimes(40, 2_000), () => true) },
  { name: 'one_correct', build: (it) => scriptedResponses(it, evenTimes(3, 20_000), (k) => k > 0) },
  // 60 in-window responses, every 5th wrong: exactly 20%, not flagged.
  { name: 'at_threshold', build: (it) => scriptedResponses(it, evenTimes(60, 1_450), (k) => k % 5 === 4) },
  // 60 in-window responses, 13 wrong: just over 20%, flagged.
  { name: 'over_threshold', build: (it) => scriptedResponses(it, evenTimes(60, 1_450), (k) => k % 5 === 4 || k === 0) },
  // Window edges: the response at 89,999.999 ms counts, those at 90,000 and 90,000.001 ms are late.
  { name: 'window_edge', build: (it) => scriptedResponses(it, [...evenTimes(57, 1_500), W - 0.001, W, W + 0.001], (k) => k % 7 === 3) },
]

/** One parity case: a dumped block's id, the stream and its TS outcome. */
export interface ScoreCase {
  readonly item_id: string
  readonly stream: string
  readonly responses: readonly CodingResponse[]
  readonly outcome: CodingOutcome
}

export interface ScoreDump {
  readonly family: string
  readonly generator_version: string
  /** The item dump the cases refer to (same directory). */
  readonly items_file: string
  readonly count: number
  readonly cases: readonly ScoreCase[]
}

/** File name of the parity dump in the bank's `golden/ts_dumps/`, beside the item dump. */
export const SCORE_DUMP_FILE = 'coding_scores.json'

/** Seeds of the dumped blocks: `dump-<i>`, as `npm run dump:families` uses. */
export const SCORE_DUMP_SEED_PREFIX = 'dump-'

/** Build the parity dump for blocks `dump-0 … dump-(n−1)`, stream i taken from {@link DUMP_STREAMS} cyclically. */
export function buildScoreDump(n: number): ScoreDump {
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new RangeError(`n must be a positive integer, got ${n}`)
  const cases: ScoreCase[] = []
  for (let i = 0; i < n; i++) {
    const item = coding.generate(`${SCORE_DUMP_SEED_PREFIX}${i}`)
    const stream = DUMP_STREAMS[i % DUMP_STREAMS.length] as (typeof DUMP_STREAMS)[number]
    const responses = stream.build(item, createRng(`coding-responses:${item.seed}:${stream.name}`))
    cases.push({ item_id: item.item_id, stream: stream.name, responses, outcome: codingOutcome(item, responses) })
  }
  return { family: coding.name, generator_version: coding.generatorVersion, items_file: 'coding.json', count: n, cases }
}

/** Dump JSON: header fields, then one canonical-JSON case per line (stable diffs). */
export function serializeScoreDump(dump: ScoreDump): string {
  const head = `{"family":${JSON.stringify(dump.family)},"generator_version":${JSON.stringify(dump.generator_version)},"items_file":${JSON.stringify(dump.items_file)},"count":${dump.count},"cases":[`
  return `${head}\n${dump.cases.map((c) => canonicalJson(c)).join(',\n')}\n]}\n`
}
