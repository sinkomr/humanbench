/**
 * External norms and pace (DESIGN §7.3 tooltips, §7.1 (3) "a separate 'Pace' tooltip"; ROADMAP
 * M1.R, A10, A12). Both are context shown BESIDE the profile, and neither enters an estimate.
 *
 * External norms, from the person's own blocks in the save (the latest valid one of each):
 * - reading: words per minute of a passed, unskimmed reading block (Brysbaert 2019: 238 wpm for
 *   non-fiction, 260 for fiction, 190 studies, SD across studies 51 [EST]);
 * - digit span: the longest length passed, forwards and backwards (typical adult 6–7 forwards,
 *   4–5 backwards [EST†]);
 * - simple reaction time: the median of the valid trials, in ms. Web times carry tens of ms of
 *   device lag, so the reference shown is web-relative only (§7.3): the provisional web median of
 *   the RT norm table (`rt/prior.ts`, A10), never a lab figure.
 * Percentiles "among HumanBench takers" are NOT here: A12 allows them only after M4 linking with
 * N ≥ 500, and the wording is kept hidden until then (`TAKER_COMPARISON`).
 *
 * Pace (§7.1): how long a person took per answered power question against the question's expected
 * time E[T] (the length-based prior). RT on power items is not used to score ability, because
 * rewarding speed there changes the construct and penalises careful people; it is shown apart.
 */

import { AXES, type AxisCode } from '../engine/axes'
import { orderSessions } from '../engine/retest'
import { blockResponseOf } from '../save/rescore'
import type { SaveFileV1 } from '../save/types'
import { MalformedResponseError } from '../tasks/family'
import { parseItemId } from '../tasks/ids'
import { readingBlockObservation } from '../tasks/reading/score'
import type { ReadingKey, ReadingResponse, ReadingSpec } from '../tasks/reading/types'
import { getFamily, resolveItem } from '../tasks/registry'
import { RT_WEB_NORMS } from '../tasks/rt/prior'
import { median, scoreRtResponse } from '../tasks/rt/score'
import type { RtKey, RtResponse } from '../tasks/rt/types'
import { runBlock } from '../tasks/span/score'
import type { SpanItem, SpanResponse } from '../tasks/span/config'
import type { ItemInstance } from '../tasks/family'
import { skippedIn } from './results'

/** A12: percentiles "among HumanBench takers" wait for M4 linking and N ≥ 500. Hidden in M1. */
export const TAKER_COMPARISON = Object.freeze({ enabled: false, minTakers: 500 })

/** The provisional web reference for a simple RT, in ms (§7.3 web-relative; `rt/prior.ts`). */
export const WEB_SIMPLE_RT_MEDIAN_MS = RT_WEB_NORMS.simple.median_rt_ms

export interface NormFacts {
  /** Words per minute of the latest reading block that passed its gate and was not skimmed. */
  readonly readingWpm: number | null
  readonly digitsForward: number | null
  readonly digitsBackward: number | null
  /** Median valid simple reaction time, ms. */
  readonly simpleRtMs: number | null
}

/** Whether there is anything to compare. */
export function hasNorms(f: NormFacts): boolean {
  return f.readingWpm !== null || f.digitsForward !== null || f.digitsBackward !== null || f.simpleRtMs !== null
}

/** Run `f`, returning null when the stored response is not one the family accepts. */
function tolerant<T>(f: () => T | null): T | null {
  try {
    return f()
  } catch (e) {
    if (e instanceof MalformedResponseError) return null
    throw e
  }
}

/** The latest valid reading, span and simple-RT results in `save`; sessions that skipped that part are left out. */
export function normFacts(save: SaveFileV1): NormFacts {
  let readingWpm: number | null = null
  let digitsForward: number | null = null
  let digitsBackward: number | null = null
  let simpleRtMs: number | null = null
  for (const s of orderSessions(save.sessions)) {
    for (const t of s.responses) {
      if (t[1] === 1) continue
      const ids = parseItemId(t[0])
      if (ids === null) continue
      const item = resolveItem(t[0])
      if (item === null) continue
      const response = blockResponseOf(t)
      switch (ids.family) {
        case 'reading': {
          if (skippedIn(s, 'PS')) break
          const r = tolerant(() => readingBlockObservation(item as ItemInstance<ReadingSpec, ReadingKey>, response as unknown as ReadingResponse))
          if (r !== null && r.status === 'ok') readingWpm = Math.round(r.meta.wpm)
          break
        }
        case 'span_fwd':
        case 'span_bwd': {
          if (skippedIn(s, 'WM')) break
          const st = tolerant(() => runBlock(item as SpanItem, response as unknown as SpanResponse))
          if (st !== null && st.finished && st.outcome.longest_passed > 0) {
            if (ids.family === 'span_fwd') digitsForward = st.outcome.longest_passed
            else digitsBackward = st.outcome.longest_passed
          }
          break
        }
        case 'rt_simple': {
          if (skippedIn(s, 'RT')) break
          const r = tolerant(() =>
            scoreRtResponse('simple', (item as ItemInstance<object, RtKey>).key.positions, response as unknown as RtResponse, { device_class: 'unspecified' }),
          )
          if (r !== null && r.status === 'ok') simpleRtMs = Math.round(Math.exp(r.observation.x))
          break
        }
        default:
          break
      }
    }
  }
  return { readingWpm, digitsForward, digitsBackward, simpleRtMs }
}

// ---------------------------------------------------------------------------------- pace

/** Pace labels compare the median took/expected ratio with these bounds. */
export const PACE_QUICK_BELOW = 0.8
export const PACE_SLOW_ABOVE = 1.25
/** Fewest answered questions on a skill for a pace line. */
export const PACE_MIN_ANSWERS = 3

export type PaceLabel = 'quicker' | 'typical' | 'slower'

export interface PaceRow {
  readonly code: AxisCode
  readonly name: string
  readonly n: number
  /** Median seconds taken per answered question. */
  readonly medianS: number
  /** Median expected seconds of those questions. */
  readonly typicalS: number
  /** Median of took / expected. */
  readonly ratio: number
  readonly label: PaceLabel
}

export function paceLabel(ratio: number): PaceLabel {
  return ratio < PACE_QUICK_BELOW ? 'quicker' : ratio > PACE_SLOW_ABOVE ? 'slower' : 'typical'
}

/**
 * Per power skill: how long the answered questions took against their expected times. Timed-out
 * and pretest responses are left out, and so are sessions that skipped the skill. Skills with fewer
 * than {@link PACE_MIN_ANSWERS} answers have no row. Canonical axis order.
 */
export function paceByAxis(save: SaveFileV1, minAnswers = PACE_MIN_ANSWERS): PaceRow[] {
  const took = new Map<AxisCode, { s: number[]; expected: number[]; ratio: number[] }>()
  for (const sess of save.sessions) {
    for (const t of sess.responses) {
      const [id, pretest, response, , rtMs] = t
      if (pretest === 1 || response === null || !(Number.isFinite(rtMs) && rtMs > 0)) continue
      const item = resolveItem(id)
      if (item === null || getFamily(item.family)?.kind !== 'item' || skippedIn(sess, item.axis)) continue
      const e = took.get(item.axis) ?? { s: [], expected: [], ratio: [] }
      e.s.push(rtMs / 1000)
      e.expected.push(item.expected_time_s)
      e.ratio.push(rtMs / 1000 / item.expected_time_s)
      took.set(item.axis, e)
    }
  }
  return AXES.flatMap((a) => {
    const e = took.get(a.code)
    if (e === undefined || e.s.length < minAnswers) return []
    const ratio = median(e.ratio)
    return [{ code: a.code, name: a.name, n: e.s.length, medianS: median(e.s), typicalS: median(e.expected), ratio, label: paceLabel(ratio) }]
  })
}
