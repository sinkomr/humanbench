import { describe, expect, it } from 'vitest'
import { A15_TARGET_S } from '../src/engine/selector'
import { UsageError } from './dump-lib'
import { PUBLISH_MIN_ITEMS, QUANT_MIN_ITEMS, TEXT_AXES } from '../src/engine/plan-table'
import { HARD_STOP_S } from '../src/session/constants'
import { PASSAGE_READING_S, parseSimSessionArgs, quantile, simPassageQuestions, simulate, simulateOne, simulateOneOnline, simulateOnline } from './sim-session'

describe('scripts/sim-session.ts: whole sessions of the real session machine (UX-066)', () => {
  it('parses its flags, with defaults, and refuses what it does not know', () => {
    expect(parseSimSessionArgs([], '/w')).toEqual({ n: 200, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S })
    expect(parseSimSessionArgs(['--', '--n', '5', '--skip', 'SPA', '--interstitial-s', '20', '--target-min', '20', '--json', 'out.json'], '/w')).toEqual({
      n: 5,
      offset: 0,
      skip: 'SPA',
      interstitialS: 20,
      targetS: 1200,
      json: '/w/out.json',
    })
    expect(() => parseSimSessionArgs(['--skip', 'XYZ'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--n', '0'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--n'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--what', '1'], '/w')).toThrow(UsageError)
  })

  it('parses the online version, the text parts, a pace and a share of time-outs', () => {
    const base = { n: 200, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S }
    expect(parseSimSessionArgs(['--mode', 'online'], '/w')).toEqual({ ...base, mode: 'online' })
    expect(parseSimSessionArgs(['--text', 'all'], '/w')).toEqual({ ...base, mode: 'online', text: [...TEXT_AXES] })
    expect(parseSimSessionArgs(['--text', 'VOC,LR', '--pace', '1.5', '--timeout-p', '0.1'], '/w')).toEqual({ ...base, mode: 'online', text: ['LR', 'VOC'], pace: 1.5, timeoutP: 0.1 })
    expect(parseSimSessionArgs(['--text', 'none', '--mode', 'static'], '/w')).toEqual({ ...base, mode: 'static' })
    expect(() => parseSimSessionArgs(['--text', 'all', '--mode', 'static'], '/w')).toThrow(UsageError) // the device-only version has no text parts
    expect(() => parseSimSessionArgs(['--text', 'MAT'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--mode', 'both'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--pace', '0'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--timeout-p', '2'], '/w')).toThrow(UsageError)
  })

  it('quantiles are by the nearest rank', () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2)
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2)
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 0.95)).toBe(19)
    expect(quantile([5], 0.95)).toBe(5)
    expect(Number.isNaN(quantile([], 0.5))).toBe(true)
  })

  it('time on the "Up next" screens is not session time, the break comes once before Working Memory, and a skip shortens the session', () => {
    const base = { n: 1, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S } as const
    const quick = simulateOne(3, base)
    const slow = simulateOne(3, { ...base, interstitialS: 120 })
    expect(slow.durationS).toBeCloseTo(quick.durationS, 6)
    expect(quick.breakOffers).toBe(1)
    expect(quick.breakBefore).toBe('memory')
    expect(quick.qrItems).toBeGreaterThanOrEqual(3)
    const skipped = simulateOne(3, { ...base, skip: 'SPA' })
    expect(skipped.partS.spatial).toBeUndefined()
    expect(skipped.durationS).toBeLessThan(quick.durationS)
  })

  it('summarises a run: lengths, part means, floor misses and where the break came', () => {
    const r = simulate({ n: 2, offset: 0, skip: 'MAT', interstitialS: 0, targetS: A15_TARGET_S })
    expect(r.n).toBe(2)
    expect(r.ended).toEqual({ complete: 2 })
    expect(r.qrFloorMisses).toBe(0)
    expect(r.breakOffersMax).toBe(1)
    expect(r.meanPartMin.matrix_series).toBeUndefined()
    expect(r.meanPartMin.quant).toBeGreaterThan(0)
  })

  it('reports the limits: questions per skill, the share with five Quantitative answers, the length and the hard stop (A15 amended 2026-10-12)', () => {
    const r = simulate({ n: 6, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S })
    expect(Object.keys(r.shownByAxis)).toEqual(['MAT', 'QR', 'SPA'])
    expect(r.answeredByAxis.QR!.min).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
    expect(r.shownByAxis).toEqual(r.answeredByAxis) // nothing runs out of time unless asked
    expect(r.qrPublishableShare).toBe(1)
    expect(r.hardStopShare).toBe(0)
    expect(r.hardStopMin).toBe(HARD_STOP_S / 60)
    expect(r.durationMin.median).toBeLessThanOrEqual(r.durationMin.p95)
    expect(r.durationMin.p95).toBeLessThanOrEqual(r.durationMin.max)
    expect(r.durationMin.max).toBe(r.maxDurationMin)
    expect(r.meanAboutMin.quant).toBe(6)
  })

  it('a slow taker and questions left to run out of time: the part still ends, and time-outs are not answers', () => {
    const base = { n: 1, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S } as const
    const quick = simulateOne(2, base)
    const slow = simulateOne(2, { ...base, pace: 1.5 })
    expect(slow.durationS).toBeGreaterThan(quick.durationS * 1.2)
    expect(slow.answered.QR).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
    const outs = simulateOne(2, { ...base, timeoutP: 0.3 })
    expect(outs.shown.QR!).toBeLessThanOrEqual(QUANT_MIN_ITEMS + 2)
    expect(outs.answered.QR ?? 0).toBeLessThanOrEqual(outs.shown.QR!)
    expect(Object.values(outs.shown).reduce((t, n) => t + n, 0)).toBeGreaterThan(Object.values(outs.answered).reduce((t, n) => t + n, 0))
    const stopped = simulateOne(2, { ...base, pace: 4 })
    expect(stopped.ended).toBe('hard_stop')
    expect(stopped.durationS).toBe(HARD_STOP_S)
    expect(() => simulateOne(2, { ...base, mode: 'online' })).toThrow(RangeError)
  })

  it('the online version against the stand-in server: six parts, or twelve with the text parts, with six Quantitative answers either way', async () => {
    // (a brisk taker: the twelve-part session of this simulee at the model's pace ends at the hard stop, in its last part)
    const base = { n: 1, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S, pace: 0.8 } as const
    const six = await simulateOneOnline(4, base)
    expect(six.ended).toBe('complete')
    expect(Object.keys(six.partS)).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'])
    expect(six.answered.QR).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
    const eleven = await simulateOneOnline(4, { ...base, text: TEXT_AXES })
    expect(Object.keys(eleven.partS)).toHaveLength(12)
    // Reading Comprehension read two made-up passages, whole: three questions and four
    expect(eleven.shown.RC).toBe(simPassageQuestions(0) + simPassageQuestions(1))
    expect(eleven.partS.reading_comprehension).toBeGreaterThan(2 * PASSAGE_READING_S)
    for (const k of TEXT_AXES) expect(eleven.answered[k], k).toBeGreaterThanOrEqual(PUBLISH_MIN_ITEMS)
    expect(eleven.answered.QR).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
    expect(eleven.durationS).toBeGreaterThan(six.durationS + 10 * 60)
    expect(eleven.durationS).toBeLessThanOrEqual(HARD_STOP_S)
    expect(eleven.ended).toBe('complete')
    // The six parts are the same with and without the text parts: their time is their own.
    for (const p of ['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'] as const) expect(eleven.partS[p], p).toBeCloseTo(six.partS[p]!, 6)
    const r = await simulateOnline({ ...base, n: 2, text: ['VOC'] })
    expect(r.args).toMatchObject({ mode: 'online', text: ['VOC'] })
    expect(r.meanPartMin.vocabulary).toBeGreaterThan(0)
    expect(r.qrPublishableShare).toBe(1)
  })
})
