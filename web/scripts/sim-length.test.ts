/**
 * The length a session is said to have is the length it typically has (ROADMAP M3.11 phase 2, A15; DESIGN
 * §7.4, §10; owner, 2026-10-12: "41 is acceptable, it can stretch up to 60 min max"). The words before a
 * session ("about 45 minutes") and the progress ring are made from `plan-table.ts`: `A15_TYPICAL_S` for the
 * six parts and `typical_s` for each text part. Those figures are measured, so this file holds them to the
 * measurement: whole simulated sessions of the real session machine (`sim-session.ts`).
 *
 * - Always: each text part adds what the table says it typically takes, for the same simulated people with
 *   and without it (a paired difference, so a few sessions are enough), and the parts add up.
 * - With `HB_SLOW=1` (`npm run test:slow`, about two minutes): the median of 300 six-part sessions is the
 *   table's figure, and for **every combination** of the text parts the stated minutes are the simulated
 *   median to the nearest five.
 */

import { describe, expect, it } from 'vitest'
import type { AxisCode } from '../src/engine/axes'
import { A15_TYPICAL_S, TEXT_AXES, TEXT_PARTS, aboutMinutes, sessionOutline, textPartOf, type TextAxis } from '../src/engine/plan-table'
import { A15_TARGET_S } from '../src/engine/selector'
import { HARD_STOP_S } from '../src/session/constants'
import { plannedMinutes } from '../src/session/length'
import { quantile, simulateOneOnline, type SimSessionOne } from './sim-session'

const SLOW = process.env.HB_SLOW === '1'
/**
 * Takers at the model's pace (`paceSd: 0`): the table's figure for a part is what it takes the median taker, and
 * with a pace of their own six people's mean is off it by their mean pace (the sessions the words are made from
 * have the spread: the slow tier below).
 */
const base = { n: 1, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S, paceSd: 0 } as const
/** The same people with a pace of their own, as `npm run sim:session` plays them. */
const spread = { n: 1, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S } as const
const play = (i: number, text: readonly TextAxis[]): Promise<SimSessionOne> => simulateOneOnline(i, text.length === 0 ? base : { ...base, text })
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/** Seconds a text part's typical figure may be off the simulated one. */
const PART_TOLERANCE_S = 15

describe('what each text part adds to a session is what the table says it typically takes', () => {
  const PEOPLE = [0, 1, 2, 3, 5, 7] // (their six-part sessions leave room under the hard stop for any one text part)

  it('for the same simulated people with and without the part, for each of the six', async () => {
    const without = await Promise.all(PEOPLE.map((i) => play(i, [])))
    for (const k of TEXT_AXES) {
      const part = textPartOf(k)!
      const withIt = await Promise.all(PEOPLE.map((i) => play(i, [k])))
      for (const s of withIt) expect(s.ended, k).toBe('complete')
      const added = mean(withIt.map((s, n) => s.durationS - without[n]!.durationS))
      expect(Math.abs(added - part.typical_s), `${k}: the part added ${added.toFixed(0)} s, the table says ${part.typical_s}`).toBeLessThanOrEqual(PART_TOLERANCE_S)
      // and the part's own clock says the same
      expect(Math.abs(mean(withIt.map((s) => s.partS[part.id]!)) - part.typical_s), k).toBeLessThanOrEqual(PART_TOLERANCE_S)
    }
  }, 120_000)

  it('the parts add up: a brisk taker\'s twelve-part session is their six-part session plus each part', async () => {
    const brisk = { ...base, pace: 0.8 }
    const six = await simulateOneOnline(1, brisk)
    const twelve = await simulateOneOnline(1, { ...brisk, text: TEXT_AXES })
    expect(twelve.ended).toBe('complete')
    const parts = TEXT_PARTS.reduce((t, p) => t + twelve.partS[p.id]!, 0)
    expect(twelve.durationS).toBeCloseTo(six.durationS + parts, 3)
  }, 60_000)

  it('the stated minutes are the typical length to the nearest five, for every combination of the parts', () => {
    for (let mask = 0; mask < 1 << TEXT_AXES.length; mask++) {
      const axes: AxisCode[] = TEXT_AXES.filter((_, i) => (mask >> i) & 1)
      const o = sessionOutline(axes)
      expect(o.typical_s).toBe(A15_TYPICAL_S + TEXT_PARTS.filter((p) => axes.includes(p.axis)).reduce((t, p) => t + p.typical_s, 0))
      expect(plannedMinutes(o)).toBe(aboutMinutes(o.typical_s))
      // within the ceiling the owner set for a session, and under the hard stop
      expect(o.typical_s).toBeLessThanOrEqual(HARD_STOP_S)
      expect(plannedMinutes(o)).toBeLessThanOrEqual(60)
    }
  })
})

describe.skipIf(!SLOW)('the figures against 300 simulated sessions (slow)', () => {
  const N = 300
  const PAIRS = 60

  it('the six parts: the median is the table\'s figure; and for every combination of the text parts the stated minutes are the simulated median to the nearest five', async () => {
    const six: number[] = []
    for (let i = 0; i < N; i++) six.push((await simulateOneOnline(i, spread)).durationS)
    const median = quantile(six, 0.5)
    expect(Math.abs(median - A15_TYPICAL_S), `the median of ${N} six-part sessions is ${(median / 60).toFixed(2)} min`).toBeLessThanOrEqual(30)

    // what each part adds at the model's pace, measured on the same people with and without it
    const atPace: number[] = []
    for (let i = 0; i < PAIRS; i++) atPace.push((await play(i, [])).durationS)
    const adds = new Map<TextAxis, number>()
    for (const k of TEXT_AXES) {
      const xs: number[] = []
      for (let i = 0; i < PAIRS; i++) {
        const s = await play(i, [k])
        if (s.ended === 'complete') xs.push(s.durationS - atPace[i]!)
      }
      expect(xs.length).toBeGreaterThan(PAIRS / 2)
      adds.set(k, mean(xs))
      expect(Math.abs(mean(xs) - textPartOf(k)!.typical_s), k).toBeLessThanOrEqual(PART_TOLERANCE_S)
    }

    // every combination: the session of each simulated person is their six parts plus the parts asked for, up to the hard stop
    const lines: string[] = []
    for (let mask = 0; mask < 1 << TEXT_AXES.length; mask++) {
      const axes = TEXT_AXES.filter((_, i) => (mask >> i) & 1)
      const extra = axes.reduce((t, k) => t + adds.get(k)!, 0)
      const lengths = six.map((s) => Math.min(HARD_STOP_S, s + extra))
      const med = quantile(lengths, 0.5)
      const o = sessionOutline(axes)
      const atStop = lengths.filter((s) => s >= HARD_STOP_S).length / lengths.length
      lines.push(`${axes.join('+') || '(six parts)'}: said "about ${plannedMinutes(o)}", median ${(med / 60).toFixed(1)}, p95 ${(quantile(lengths, 0.95) / 60).toFixed(1)}, at the hard stop ${(100 * atStop).toFixed(0)}%`)
      // the figure the words are made from is the simulated median, within a minute
      expect(Math.abs(med - o.typical_s), lines.at(-1)).toBeLessThanOrEqual(60)
      // and the minutes said are within three minutes of it (to the nearest five: two and a half, and the minute above)
      expect(Math.abs(plannedMinutes(o) * 60 - med), lines.at(-1)).toBeLessThanOrEqual(210)
    }
    console.log(lines.join('\n'))
  }, 30 * 60_000)
})
