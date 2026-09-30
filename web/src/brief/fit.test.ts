/**
 * The fit log rule (AI.7; proposal §3.6 item 1, ADR A20): the last four notes on a topic within 180
 * days (read as this month and the five before), a net of +2 or -2 moves a suggestion one setting,
 * "about right" counts 0 but takes a slot, results clamp at both ends, and a topic without a setting
 * starts from "ask first". The rule only suggests; nothing here reaches scoring.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FIT_BASE, FIT_MONTHS, FIT_NET, FIT_VERDICTS, FIT_WINDOW, compareFit, fitNet, fitShift, fitSuggestion, isFitEntry, monthsBetween, newFitEntry, recentFit, type FitEntry, type FitVerdict } from './fit'
import { mergeBriefPrefs } from '../save/brief-prefs'
import type { BriefPrefsV1 } from '../save/types'
import { fromStored } from './stored'
import { TOPIC_SETTINGS, type TopicSetting } from './types'

const T = 'quant/probability_counting'
/** Stored settings holding only a fit log (what a save carries). */
const storedOf = (fit_log: readonly FitEntry[]): BriefPrefsV1 => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts: [], fit_log: fit_log.map((f) => ({ id: f.id, topic: f.topic, verdict: f.verdict, month: f.month })) })
const NOW = '2026-12'
let n = 0
const note = (verdict: FitVerdict, month = '2026-12', topic = T, id?: string): FitEntry => ({ id: id ?? `${(n++ % 256).toString(16).padStart(2, '0')}abcdef`, topic, verdict, month })
const notes = (verdicts: FitVerdict[], month = '2026-12'): FitEntry[] => verdicts.map((v, i) => ({ id: `${String(i).padStart(2, '0')}abcdef`, topic: T, verdict: v, month }))

describe('the window: the last four notes within 180 days', () => {
  it('reads 180 days as this month and the five before it', () => {
    expect(FIT_MONTHS).toBe(6)
    expect(monthsBetween('2026-07', '2026-12')).toBe(5)
    expect(monthsBetween('2026-12', '2026-12')).toBe(0)
    expect(monthsBetween('2027-01', '2026-12')).toBe(-1)
    expect(monthsBetween('2025-12', '2026-12')).toBe(12)
    const log = [note('too_basic', '2026-06', T, '00000001'), note('too_basic', '2026-07', T, '00000002'), note('too_basic', '2026-12', T, '00000003'), note('too_basic', '2027-01', T, '00000004')]
    // 2026-06 is six months back: out. 2026-07 is five: in. A note dated after today (a clock that was ahead) still counts.
    expect(recentFit(log, T, NOW).map((f) => f.id)).toEqual(['00000002', '00000003', '00000004'])
  })

  it('keeps only the newest four of a topic, by month and then id, whatever order they arrive in', () => {
    const log = notes(['too_basic', 'too_much', 'too_basic', 'too_much', 'too_basic', 'too_basic'])
    expect(FIT_WINDOW).toBe(4)
    expect(recentFit(log, T, NOW).map((f) => f.id)).toEqual(['02abcdef', '03abcdef', '04abcdef', '05abcdef'])
    fc.assert(
      fc.property(fc.shuffledSubarray(log, { minLength: log.length }), (shuffled) => {
        expect(recentFit(shuffled, T, NOW)).toEqual(recentFit(log, T, NOW))
      }),
    )
    // a later month outranks a larger id in an earlier month
    const mixed = [note('too_much', '2026-11', T, 'ff000000'), note('too_basic', '2026-12', T, '00000000')]
    expect(recentFit(mixed, T, NOW).map((f) => f.id)).toEqual(['ff000000', '00000000'])
    expect([...mixed].sort(compareFit).map((f) => f.id)).toEqual(['ff000000', '00000000'])
  })

  it('reads only the notes of the topic asked about', () => {
    const log = [...notes(['too_basic', 'too_basic']), note('too_much', '2026-12', 'kst/physics', '10000000')]
    expect(recentFit(log, T, NOW)).toHaveLength(2)
    expect(recentFit(log, 'kst/physics', NOW)).toHaveLength(1)
    expect(recentFit(log, 'other/statistics', NOW)).toEqual([])
  })
})

describe('the net and the shift', () => {
  it('counts "too basic" as +1, "too much" as -1 and "about right" as 0', () => {
    expect(fitNet(notes(['too_basic', 'too_basic', 'too_much']))).toBe(1)
    expect(fitNet(notes(['too_much', 'too_much', 'about_right']))).toBe(-2)
    expect(fitNet([])).toBe(0)
  })

  it('moves a suggestion one setting at a net of +2 or -2 and not before', () => {
    expect(FIT_NET).toBe(2)
    for (const [base, net, want] of [
      ['build', 2, 'ask_first'],
      ['ask_first', 2, 'skip'],
      ['ask_first', -2, 'build'],
      ['skip', -2, 'ask_first'],
      ['ask_first', 1, 'ask_first'],
      ['ask_first', -1, 'ask_first'],
      ['ask_first', 0, 'ask_first'],
      // a larger net still moves one setting
      ['build', 4, 'ask_first'],
      ['skip', -4, 'ask_first'],
    ] as [TopicSetting, number, TopicSetting][]) {
      expect(fitShift(base, net), `${base} at ${net}`).toBe(want)
    }
  })

  it('clamps at both ends: nothing above "skip the basics" or below "build up"', () => {
    expect(fitShift('skip', 2)).toBe('skip')
    expect(fitShift('skip', 4)).toBe('skip')
    expect(fitShift('build', -2)).toBe('build')
    expect(fitShift('build', -4)).toBe('build')
    fc.assert(
      fc.property(fc.constantFrom(...TOPIC_SETTINGS), fc.integer({ min: -8, max: 8 }), (base, net) => {
        const to = fitShift(base, net)
        expect(TOPIC_SETTINGS).toContain(to)
        // at most one step, in the direction of the net, and monotone in the net
        expect(Math.abs(['build', 'ask_first', 'skip'].indexOf(to) - ['build', 'ask_first', 'skip'].indexOf(base))).toBeLessThanOrEqual(1)
        expect(['build', 'ask_first', 'skip'].indexOf(fitShift(base, net + 1))).toBeGreaterThanOrEqual(['build', 'ask_first', 'skip'].indexOf(to))
      }),
    )
  })
})

describe('the suggestion', () => {
  it('suggests a move from the person\'s own setting, using the last four notes', () => {
    const s = fitSuggestion(notes(['too_basic', 'too_basic']), T, 'build', NOW)
    expect(s).toMatchObject({ topic: T, from: 'build', to: 'ask_first', net: 2, noSetting: false })
    expect(s?.used).toHaveLength(2)
    expect(fitSuggestion(notes(['too_much', 'too_much']), T, 'skip', NOW)).toMatchObject({ from: 'skip', to: 'ask_first', net: -2 })
    expect(fitSuggestion(notes(['too_basic']), T, 'build', NOW)).toBeNull()
    expect(fitSuggestion([], T, 'build', NOW)).toBeNull()
  })

  it('has no suggestion where clamping leaves the setting where it is', () => {
    expect(fitSuggestion(notes(['too_basic', 'too_basic', 'too_basic']), T, 'skip', NOW)).toBeNull()
    expect(fitSuggestion(notes(['too_much', 'too_much']), T, 'build', NOW)).toBeNull()
  })

  it('lets "about right" dilute older marks: it counts 0 but takes a slot', () => {
    expect(fitSuggestion(notes(['too_basic', 'too_basic', 'about_right', 'about_right']), T, 'build', NOW)?.net).toBe(2)
    // one more "about right" pushes the oldest "too basic" out of the window of four
    expect(fitSuggestion(notes(['too_basic', 'too_basic', 'about_right', 'about_right', 'about_right']), T, 'build', NOW)).toBeNull()
    // an old mark outside the window no longer counts, a mark outside 180 days neither
    expect(fitSuggestion(notes(['too_basic', 'too_basic', 'too_much', 'about_right', 'about_right', 'about_right']), T, 'build', NOW)).toBeNull()
    expect(fitSuggestion(notes(['too_basic', 'too_basic'], '2026-05'), T, 'build', NOW)).toBeNull()
    expect(fitSuggestion(notes(['too_basic', 'too_basic'], '2026-07'), T, 'build', NOW)).not.toBeNull()
  })

  it('starts a topic without a setting from "ask first", which makes the fit log a self-report route', () => {
    expect(FIT_BASE).toBe('ask_first')
    expect(fitSuggestion(notes(['too_basic', 'too_basic']), T, undefined, NOW)).toMatchObject({ from: 'ask_first', to: 'skip', noSetting: true })
    expect(fitSuggestion(notes(['too_much', 'too_much']), T, undefined, NOW)).toMatchObject({ from: 'ask_first', to: 'build', noSetting: true })
    expect(fitSuggestion(notes(['too_basic']), T, undefined, NOW)).toBeNull()
  })

  it('only ever suggests (it returns a suggestion and changes nothing it is given)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...FIT_VERDICTS), { maxLength: 8 }), fc.option(fc.constantFrom(...TOPIC_SETTINGS), { nil: undefined }), (verdicts, own) => {
        const log = notes(verdicts)
        const before = JSON.stringify(log)
        const s = fitSuggestion(log, T, own, NOW)
        expect(JSON.stringify(log)).toBe(before)
        if (s !== null) {
          expect(s.to).not.toBe(s.from)
          expect(s.used.length).toBeLessThanOrEqual(FIT_WINDOW)
          expect(Math.abs(s.net)).toBeGreaterThanOrEqual(FIT_NET)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('new notes', () => {
  it('get an id of eight hex digits that counts up within a month, so a month\'s notes sort in the order they were made', () => {
    let log: FitEntry[] = []
    for (let i = 0; i < 20; i++) log = [...log, newFitEntry(log, T, 'too_basic', '2026-12', `${(i * 7919).toString(16).padStart(6, '0').slice(-6)}`)]
    expect(log.every((f) => /^[0-9a-f]{8}$/.test(f.id))).toBe(true)
    expect(log.map((f) => f.id.slice(0, 2))).toEqual(Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(2, '0')))
    expect([...log].sort(compareFit)).toEqual(log)
    // another month starts again from zero
    expect(newFitEntry(log, T, 'too_much', '2027-01', 'aaaaaa').id).toBe('00aaaaaa')
  })

  it('go on from the highest id of the month, not from a count: a merge that trimmed the log leaves new notes after the stored ones', () => {
    // 20 notes on one topic in a month (16 "about right", then 4 "too much"), kept as a merge keeps them: the newest 12 (ids 08 to 13)
    let log: FitEntry[] = []
    const verdicts: FitVerdict[] = [...Array<FitVerdict>(16).fill('about_right'), ...Array<FitVerdict>(4).fill('too_much')]
    verdicts.forEach((v, i) => void (log = [...log, newFitEntry(log, T, v, '2026-11', (i * 4099).toString(16).padStart(6, '0').slice(-6))]))
    const kept = fromStored(mergeBriefPrefs([storedOf(log)]))?.fitLog ?? []
    expect(kept).toHaveLength(12)
    expect(kept.map((f) => f.id.slice(0, 2))).toEqual(['08', '09', '0a', '0b', '0c', '0d', '0e', '0f', '10', '11', '12', '13'])
    // four new "too basic" notes must be the newest four, whatever the count of stored notes is
    let after = [...kept]
    for (let i = 0; i < 4; i++) after = [...after, newFitEntry(after, T, 'too_basic', '2026-11', `0000a${i}`)]
    expect(after.slice(-4).map((f) => f.id.slice(0, 2))).toEqual(['14', '15', '16', '17'])
    expect(recentFit(after, T, '2026-11').map((f) => f.verdict)).toEqual(['too_basic', 'too_basic', 'too_basic', 'too_basic'])
    expect(fitSuggestion(after, T, 'ask_first', '2026-11')).toMatchObject({ to: 'skip', net: 4 })
  })

  it('always sort after every stored note of their month, through any number of merges and reloads (property)', () => {
    const arbOp = fc.record({ verdict: fc.constantFrom(...FIT_VERDICTS), topic: fc.constantFrom(T, 'kst/physics'), reload: fc.boolean() })
    fc.assert(
      fc.property(fc.array(arbOp, { minLength: 1, maxLength: 60 }), fc.array(fc.stringMatching(/^[0-9a-f]{6}$/u), { minLength: 60, maxLength: 60 }), (ops, randoms) => {
        let log: FitEntry[] = []
        ops.forEach((op, i) => {
          const before = log.filter((f) => f.month === '2026-11')
          const made = newFitEntry(log, op.topic, op.verdict, '2026-11', randoms[i] as string)
          for (const other of before) expect(compareFit(other, made), `${other.id} before ${made.id}`).toBeLessThan(0)
          log = [...log, made]
          // a merge keeps the newest 12 per topic; reloading goes through the stored form
          if (op.reload) log = fromStored(mergeBriefPrefs([storedOf(log)]))?.fitLog.map((f) => ({ ...f })) ?? []
        })
      }),
      { numRuns: 200 },
    )
  })

  it('stops at ff: the number does not wrap round to zero, and a taken id there is refused', () => {
    const log = [note('too_basic', '2026-12', T, 'ff000000')]
    expect(newFitEntry(log, T, 'too_basic', '2026-12', 'abcdef').id).toBe('ffabcdef')
    expect(() => newFitEntry([...log, note('too_basic', '2026-12', T, 'ffabcdef')], T, 'too_basic', '2026-12', 'abcdef')).toThrow(RangeError)
  })

  it('never reuses an id, and rejects a bad month or bad random digits', () => {
    const log = [note('too_basic', '2026-12', T, '00abcdef')]
    expect(newFitEntry(log, T, 'too_basic', '2026-12', 'abcdef').id).toBe('01abcdef')
    expect(() => newFitEntry(log, T, 'too_basic', '2026-13', 'abcdef')).toThrow(RangeError)
    expect(() => newFitEntry(log, T, 'too_basic', '2026-12', 'xyz')).toThrow(RangeError)
    expect(() => newFitEntry(log, T, 'too_basic', '2026-12', 'ABCDEF')).toThrow(RangeError)
  })

  it('recognises a well-formed note and nothing else', () => {
    expect(isFitEntry(note('too_basic'))).toBe(true)
    for (const bad of [null, 1, {}, { ...note('too_basic'), id: 'nope' }, { ...note('too_basic'), verdict: 'boring' }, { ...note('too_basic'), month: '2026-12-01' }, { ...note('too_basic'), topic: 3 }]) expect(isFitEntry(bad)).toBe(false)
  })
})

describe('the rule stays apart from scoring', () => {
  it('imports nothing but the notes\' own types', () => {
    const src = import.meta.glob<string>('./fit.ts', { query: '?raw', import: 'default', eager: true })['./fit.ts'] ?? ''
    expect([...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])).toEqual(['./types'])
  })
})
