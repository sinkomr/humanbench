/**
 * Synthetic RT responses and the TS → bank scoring parity dumps of the RT families (ROADMAP
 * M1.10, A1, A10, A17, M1.F2). TEST SUPPORT ONLY: used by the rt tests and
 * `scripts/dump-rt-scores.ts`, never by the app, and never part of an item (the key is the
 * stimulus positions alone).
 *
 * The item dumps (`golden/ts_dumps/rt_simple.json`, `rt_choice4.json`, `npm run dump:families`)
 * carry instances only, so the observation parity has its own dump per family,
 * `golden/ts_dumps/<family>_scores.json` (as coding has `coding_scores.json`): for each dumped
 * block (seeds `dump-<i>`) one synthetic response set, the
 * device class it is attributed to, and the TS result (status, trial counts, and the observation
 * + SE or the reason). The bank's Python scorer recomputes every result from the responses and
 * must agree (integers and strings exactly, floats to 1e-12).
 *
 * Responses come from a lapse-prone person (misses, anticipations, wrong positions, boundary
 * RTs, a slow tail), so both outcomes and every trimming rule occur. RTs are whole tenths of a ms
 * drawn with integer arithmetic only, so the dump is the same on every JS engine.
 */

import { createRng, type Rng } from '../../engine'
import { canonicalJson } from '../ids'
import type { BlockFamily } from '../family'
import type { RtItem } from '.'
import { RT_WEB_NORMS } from './prior'
import { expectedOf, scoreRtResponse } from './score'
import { RT_MODE_CONFIG, type RtExpected, type RtKey, type RtMode, type RtResponse, type RtSpec } from './types'

/** Device classes the synthetic responses are attributed to. */
export const SYNTHETIC_DEVICE_CLASSES: readonly string[] = Object.freeze(['desktop', 'tablet', 'phone'])

/** A full synthetic response set (practice included) and the device class it is attributed to. */
export interface RtSyntheticResponses {
  readonly device_class: string
  readonly practice_rt_ms: readonly (number | null)[]
  readonly practice_choice: readonly (number | null)[]
  readonly rt_ms: readonly (number | null)[]
  readonly choice: readonly (number | null)[]
}

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
 * Synthetic responses to a schedule: a person whose median RT is 0.8–1.25 × the norm, with lapses
 * (misses, anticipations, wrong positions, boundary RTs). About 1 block in 5 is "sloppy" (lapse
 * rates 5–30% each), so some blocks fall below the valid-trial minimum.
 */
export function drawSyntheticResponses(rng: Rng, spec: RtSpec): RtSyntheticResponses {
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
  const deviceClass = rng.pick(SYNTHETIC_DEVICE_CLASSES)
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

/** One parity case: a dumped block's id, a synthetic response set, and its TS result. */
export interface RtScoreCase {
  readonly item_id: string
  readonly device_class: string
  readonly response: {
    readonly practice_rt_ms: readonly (number | null)[]
    readonly practice_choice: readonly (number | null)[]
    readonly rt_ms: readonly (number | null)[]
    readonly choice: readonly (number | null)[]
  }
  readonly expected: RtExpected
}

export interface RtScoreDump {
  readonly family: string
  readonly generator_version: string
  /** The item dump the cases refer to (same directory). */
  readonly items_file: string
  readonly count: number
  readonly cases: readonly RtScoreCase[]
}

/** File name of a family's parity dump in the bank's `golden/ts_dumps/`, beside its item dump `<family>.json`. */
export function rtScoreDumpFile(familyName: string): string {
  return `${familyName}_scores.json`
}

/** Seeds of the dumped blocks: `dump-<i>`, as `npm run dump:families` uses. */
export const RT_SCORE_DUMP_SEED_PREFIX = 'dump-'

/** The response stream of an item's parity case (independent of the item's own stream). */
export const responseRng = (item: RtItem): Rng => createRng(`rt-responses:${item.seed}`)

/** The parity case of `item`: synthetic responses from {@link responseRng} and their TS result. */
export function rtScoreCase(item: RtItem): RtScoreCase {
  const { device_class, ...response } = drawSyntheticResponses(responseRng(item), item.spec)
  const expected = expectedOf(scoreRtResponse(item.spec.mode, item.key.positions, response, { device_class }))
  return { item_id: item.item_id, device_class, response, expected }
}

/** Build a family's parity dump for its blocks `dump-0 … dump-(n−1)`, one case per block. */
export function buildRtScoreDump(family: BlockFamily<RtSpec, RtKey, RtResponse>, n: number): RtScoreDump {
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new RangeError(`n must be a positive integer, got ${n}`)
  const cases: RtScoreCase[] = []
  for (let i = 0; i < n; i++) cases.push(rtScoreCase(family.generate(`${RT_SCORE_DUMP_SEED_PREFIX}${i}`)))
  return { family: family.name, generator_version: family.generatorVersion, items_file: `${family.name}.json`, count: n, cases }
}

/** Dump JSON: header fields, then one canonical-JSON case per line (stable diffs). */
export function serializeRtScoreDump(dump: RtScoreDump): string {
  const head = `{"family":${JSON.stringify(dump.family)},"generator_version":${JSON.stringify(dump.generator_version)},"items_file":${JSON.stringify(dump.items_file)},"count":${dump.count},"cases":[`
  return `${head}\n${dump.cases.map((c) => canonicalJson(c)).join(',\n')}\n]}\n`
}

/**
 * Block-suite responses (M1.F2, `runFamilyProperties`): a careful taker (no lapses, a moderate
 * spread around 0.8–1.25 × the norm median), whose block always yields an observation.
 */
export function rtValidResponse(item: RtItem, rng: Rng): RtResponse {
  const profile: LapseProfile = {
    centre_t: Math.floor((RT_WEB_NORMS[item.spec.mode].median_rt_ms * rng.int(800, 1250)) / 100),
    spread_pm: rng.int(30, 100),
    miss: 0,
    antic: 0,
    err: 0,
    edge: 0,
  }
  const t = drawTrials(rng, item.spec.mode, item.spec.positions, profile)
  return { rt_ms: t.rt, choice: t.choice }
}

/**
 * Block-suite responses (M1.F2): a well-formed block that yields no observation, because too
 * few trials are valid (every trial missed, or answered before onset).
 */
export function rtInvalidResponse(item: RtItem, rng: Rng): RtResponse {
  const n = item.spec.positions.length
  if (rng.next() < 0.5) return { rt_ms: Array<null>(n).fill(null), choice: Array<null>(n).fill(null) }
  return { rt_ms: Array.from({ length: n }, () => -rng.int(1, 5000) / 10), choice: item.spec.positions.map(() => 0) }
}

/** Block-suite malformed responses (M1.F2): wrong lengths, out-of-range choices, half-missing trials. */
export function rtMalformedResponses(item: RtItem): unknown[] {
  const n = item.spec.positions.length
  const ok = { rt_ms: Array<number>(n).fill(400), choice: [...item.spec.positions] }
  return [
    [],
    { rt_ms: ok.rt_ms.slice(1), choice: ok.choice.slice(1) },
    { ...ok, choice: ok.choice.map((_, i) => (i === 0 ? item.spec.n_positions : 0)) },
    { ...ok, rt_ms: ok.rt_ms.map((x, i) => (i === 0 ? null : x)) },
    { ...ok, rt_ms: ok.rt_ms.map((x, i) => (i === 0 ? '400' : x)) },
    { ...ok, practice_rt_ms: [400, 400, 400] },
  ]
}
