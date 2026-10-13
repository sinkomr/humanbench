import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Bot } from './bot'
import { DEFAULT_ITEM_LIMIT_S, ITEM_TIME_WARN_S } from './constants'
import { ITEM_TIMER_LABEL, itemTimerAnnounce, itemTimerSpoken } from './copy'
import { timerSpoken, timerText, timerWarns, warnAtS } from './item-timer'

describe('the words of the question timer (owner feedback 2026-10-13: no surprise time-outs)', () => {
  it('reads the seconds left as m:ss, rounded up, never negative', () => {
    expect(timerText(180)).toBe('3:00')
    expect(timerText(179.2)).toBe('3:00')
    expect(timerText(125)).toBe('2:05')
    expect(timerText(59.01)).toBe('1:00')
    expect(timerText(0.2)).toBe('0:01')
    expect(timerText(0)).toBe('0:00')
    expect(timerText(-3)).toBe('0:00')
    expect(timerText(Number.NaN)).toBe('0:00')
    expect(timerText(360)).toBe('6:00')
  })

  it('warns in the last 30 seconds, or the last quarter of a limit shorter than two minutes', () => {
    expect(ITEM_TIME_WARN_S).toBe(30)
    expect(warnAtS(180)).toBe(30)
    expect(warnAtS(360)).toBe(30)
    expect(warnAtS(60)).toBe(15)
    expect(warnAtS(Number.NaN)).toBe(30)
    expect(timerWarns(30.5, 180)).toBe(false)
    expect(timerWarns(30, 180)).toBe(true)
    expect(timerWarns(0, 180)).toBe(true)
    expect(timerWarns(16, 60)).toBe(false)
    expect(timerWarns(15, 60)).toBe(true)
  })

  it('speaks the time in words for a screen reader', () => {
    expect(timerSpoken(125)).toBe('2 minutes 5 seconds')
    expect(timerSpoken(60)).toBe('1 minute')
    expect(timerSpoken(61)).toBe('1 minute 1 second')
    expect(timerSpoken(45)).toBe('45 seconds')
    expect(timerSpoken(0)).toBe('0 seconds')
    expect(itemTimerSpoken(timerSpoken(90))).toBe(`${ITEM_TIMER_LABEL}: 1 minute 30 seconds`)
    expect(itemTimerAnnounce(30)).toBe('30 seconds left for this question.')
  })

  it('property: the text never shows more than the limit, counts down, and the warning, once on, stays on', () => {
    fc.assert(
      fc.property(fc.integer({ min: 20, max: 900 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (limit, u, v) => {
        const a = limit * Math.max(u, v)
        const b = limit * Math.min(u, v)
        const secs = (t: string): number => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1])
        expect(secs(timerText(a))).toBeLessThanOrEqual(limit)
        expect(secs(timerText(b))).toBeLessThanOrEqual(secs(timerText(a)))
        if (timerWarns(a, limit)) expect(timerWarns(b, limit)).toBe(true)
        expect(timerWarns(0, limit)).toBe(true)
        expect(timerWarns(limit, limit)).toBe(false)
      }),
    )
  })
})

describe('SessionRun.itemTime: what the timer shows is what the time-out acts on', () => {
  const only = { skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] as const }

  it('is null when no question waits for an answer: on an "Up next" screen, in a block, on the confidence slider, after the end', () => {
    const bot = new Bot({ sessionId: 's_ITEMTIME000001', skipped: ['WM', 'PS', 'SPA', 'QR'] })
    expect(bot.view().phase).toBe('interstitial')
    expect(bot.run.itemTime()).toBeNull()
    bot.run.startSegment()
    expect(bot.view().phase).toBe('block')
    expect(bot.run.itemTime()).toBeNull()
    bot.until((v) => v.phase === 'item')
    expect(bot.run.itemTime()).not.toBeNull()
    const item = bot.fullItem(bot.view().item!.item_id)
    bot.run.itemResponded(item.options_count === undefined ? '1' : 0)
    expect(bot.view().phase).toBe('confidence')
    expect(bot.run.itemTime()).toBeNull() // the slider is not timed
    bot.run.finishEarly()
    expect(bot.run.itemTime()).toBeNull()
  })

  it('counts down from the item’s own limit, from the first frame that showed it, and reaches 0 exactly when the question is recorded as run out of time', () => {
    const bot = new Bot({ sessionId: 's_ITEMTIME000002', skipped: [...only.skipped] })
    bot.run.startSegment()
    const limit = bot.view().item!.time_limit_s
    expect(limit).toBeGreaterThanOrEqual(DEFAULT_ITEM_LIMIT_S)
    expect(bot.run.itemTime()).toEqual({ limitS: limit, leftS: limit })
    bot.wait(2)
    bot.run.itemShown(bot.t) // the renderer's onset, 2 s after the item was handed over: the limit runs from here
    expect(bot.run.itemTime()!.leftS).toBe(limit)
    bot.wait(limit - 31)
    expect(bot.run.itemTime()!.leftS).toBeCloseTo(31, 9)
    bot.wait(30.5)
    bot.run.tick()
    expect(bot.view().notice).toBeNull()
    expect(bot.run.itemTime()!.leftS).toBeCloseTo(0.5, 9)
    const first = bot.view().item!.item_id
    bot.wait(0.5)
    expect(bot.run.itemTime()!.leftS).toBe(0)
    bot.run.tick()
    // the time-out: the question is gone, the next one has its whole limit
    expect(bot.view().notice?.kind).toBe('timeout')
    expect(bot.view().item!.item_id).not.toBe(first)
    expect(bot.run.itemTime()!.leftS).toBe(bot.run.itemTime()!.limitS)
  })

  it('property: the question never runs out while the timer shows time left, and always does once it shows none', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1.2, noNaN: true }), fc.integer({ min: 0, max: 30 }), (frac, seed) => {
        const bot = new Bot({ sessionId: `s_ITEMTIMEP${String(seed).padStart(5, '0')}`, skipped: [...only.skipped] })
        bot.run.startSegment()
        bot.run.itemShown(bot.t)
        const id = bot.view().item!.item_id
        const limit = bot.run.itemTime()!.limitS
        bot.wait(frac * limit)
        const left = bot.run.itemTime()!.leftS
        bot.run.tick()
        const stillThere = bot.view().item?.item_id === id && bot.view().phase === 'item'
        expect(stillThere).toBe(left > 0)
      }),
      { numRuns: 60 },
    )
  })
})
