import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, AXIS_INDEX, N_AXES, type AxisCode } from '../engine/axes'
import { createRng } from '../engine/prng'
import { A15_PLANNED_S, A15_TYPICAL_OVER_S, A15_TYPICAL_S, MIN_ITEMS_SLACK, PART_MIN_ITEMS, PUBLISH_MIN_ITEMS, QUANT_EXTRA_S, QUANT_MIN_ITEMS } from '../engine/plan-table'
import { A15_TARGET_S, STOP_SD, planSession, type SegmentId } from '../engine/selector'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { registryObservation, rescoreSessions } from '../save/rescore'
import { parseItemId } from '../tasks/ids'
import { CAL_NORMS } from '../tasks/priors'
import { RT_NORMS_VERSION } from '../tasks/rt'
import { CONTINUATION_FLAG } from '../save/types'
import { HARD_STOP_S, SAVE_CTX } from './constants'
import { priorItemCounts } from './coverage'
import { COMPLETED_FLAG, doneFlag, findUnfinished } from './resume'
import { SessionRun } from './run'
import { Bot, TEST_DEVICE, midConfidence } from './bot'

const ORDER: readonly SegmentId[] = ['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading']

/** Θ with the given axes set and the rest 0. */
function theta(entries: Partial<Record<AxisCode, number>>): number[] {
  const t = new Array<number>(N_AXES).fill(0)
  for (const [k, v] of Object.entries(entries)) t[AXIS_INDEX[k as AxisCode]] = v
  return t
}

describe('the A15 flow (M1.15)', () => {
  it('runs RT → Matrix/Series → Spatial → Memory → Quant → Coding/Reading, each after an interstitial', () => {
    const bot = new Bot({ sessionId: 's_FLOWORDER00001' })
    expect(bot.view().phase).toBe('interstitial')
    const seen: SegmentId[] = []
    let prev = ''
    for (let i = 0; i < 2000; i++) {
      const v = bot.view()
      if (v.phase === 'interstitial' && v.segment) seen.push(v.segment.id)
      if (v.phase === 'finished') break
      // A segment's first screen is its interstitial; it never starts without one.
      if (v.phase === 'block' || v.phase === 'item') expect(['interstitial', 'block', 'item', 'break_offer']).toContain(prev)
      prev = v.phase
      bot.run.tick()
      bot.step()
    }
    expect(seen).toEqual(ORDER)
    const v = bot.view()
    expect(v.phase).toBe('finished')
    expect(v.ended).toBe('complete')
    expect(v.segments.map((s) => s.status)).toEqual(ORDER.map(() => 'done'))
    expect(v.counts.blocks).toBe(7) // rt ×2, span ×3, coding, reading
  })

  it('the session lands near the A15 target and stays under the hard stop for a typical taker', () => {
    const bot = new Bot({ sessionId: 's_FLOWTIME000001' })
    bot.finish()
    const t = bot.run.view().elapsedS
    expect(t).toBeGreaterThan(20 * 60)
    expect(t).toBeLessThan(HARD_STOP_S)
  })

  it('shows minutes on each interstitial and marks the current segment', () => {
    const bot = new Bot({ sessionId: 's_FLOWMINUTES001' })
    const v = bot.view()
    expect(v.segment?.id).toBe('rt')
    expect(v.segment?.status).toBe('current')
    expect(v.segment?.minutes).toBeGreaterThanOrEqual(2)
    expect(v.segments.map((s) => s.status)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
    for (const s of v.segments) expect(s.minutes).toBeGreaterThanOrEqual(1)
  })

  it('progress is time: the elapsed seconds and the target come from the clock, not the item count', () => {
    const bot = new Bot({ sessionId: 's_FLOWPROGRESS01' })
    // the target the ring fills toward is what the six parts typically take, a little over their plan (plan-table.ts)
    expect(bot.view().targetS).toBe(A15_TYPICAL_S)
    expect(A15_TYPICAL_S).toBe(A15_PLANNED_S + A15_TYPICAL_OVER_S)
    expect(bot.view().elapsedS).toBe(0)
    bot.wait(90) // on the first "Up next" screen: the clock waits for Start (UX-066)
    expect(bot.view().elapsedS).toBe(0)
    bot.run.startSegment()
    bot.wait(90)
    expect(bot.view().elapsedS).toBe(90)
  })

  it('is deterministic per session id', () => {
    const ids = (): string[] => {
      const b = new Bot({ sessionId: 's_FLOWDETERMIN001' })
      b.finish()
      return b.run.sessionState().responses.map((r) => r[0])
    }
    const a = ids()
    expect(a.length).toBeGreaterThan(10)
    expect(ids()).toEqual(a)
  })

  it('never shows the UI a key, the parameters or the difficulty of an item or block', () => {
    const bot = new Bot({ sessionId: 's_FLOWNOLEAK0001' })
    const forbidden = /"(key|params|difficulty|structural_params|b_prior|verification)"/
    for (let i = 0; i < 400; i++) {
      const v = bot.view()
      expect(JSON.stringify(v), `phase ${v.phase}`).not.toMatch(forbidden)
      if (v.item) expect(Object.keys(v.item).sort()).toEqual(expect.arrayContaining(['axis', 'family', 'item_id', 'spec', 'time_limit_s']))
      bot.run.tick()
      if (!bot.step()) break
    }
  })
})

/** The power (CAT) axes of the M1 session. */
const CAT: readonly AxisCode[] = ['MAT', 'SPA', 'QR']

/**
 * Run to the first Reaction Time block and spend `s` seconds on it, then on to the Matrix & Series
 * interstitial: every part after it has no budget left when `s` is the whole target.
 */
function slowRtThenMatrix(bot: Bot, s: number): void {
  bot.until((v) => v.phase === 'block' && v.segment?.id === 'rt')
  bot.wait(s)
  bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'matrix_series')
}

/**
 * Run to Working Memory's first block and spend `s` seconds on it (the clock runs during a block,
 * not on an "Up next" screen), then on to the Quantitative interstitial: the parts after it have no
 * budget left when `s` is the whole target.
 */
function slowMemoryThenQuant(bot: Bot, s: number): void {
  bot.until((v) => v.phase === 'block' && v.segment?.id === 'memory')
  bot.wait(s)
  bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'quant')
}

/** A focus session on all six skills: the six-part plan without the parts' minimums of answers (`plan-table.ts`). */
const ALL_SIX: readonly AxisCode[] = ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS']

describe('coverage floor and the session clock (M1.15 known issue)', () => {
  it('every CAT axis reaches 3 items in session 1 even when the blocks before it ran very long', () => {
    // Memory blocks taking 4× their model time: the time budget of Quant is gone before it starts.
    // The floor still gives it its 3 items (before M1.15: 0–2 in some sessions), and since 2026-10-12
    // the part's own minimum its six (4×: the blocks' model time is the re-estimated one of span 1.2.0,
    // about 5 minutes for the three, so 4× is 21 minutes in Working Memory; 5× ends at the hard stop).
    for (let i = 0; i < 12; i++) {
      const bot = new Bot({ sessionId: `s_FLOORLONG${String(i).padStart(5, '0')}` }, { blockScale: { span_fwd: 4, span_bwd: 4, corsi: 4 } })
      const run = bot.finish()
      const r = run.result()
      expect(r.reason, `session ${i}`).toBe('complete')
      for (const k of CAT) expect(r.itemsByAxis[k] ?? 0, `${k} in session ${i}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('holds across 60 simulated takers whose blocks run 1–2.2× their model time (before the fix about 60% of these fell short on QR)', () => {
    const rng = createRng('floor-sweep')
    for (let i = 0; i < 60; i++) {
      const th = Array.from({ length: N_AXES }, () => rng.normal())
      const bot = new Bot({ sessionId: `s_FLOORSWEEP${String(i).padStart(5, '0')}` }, { theta: th, blockScale: 1 + 1.2 * rng.next() })
      bot.finish()
      const r = bot.run.result()
      expect(r.reason).toBe('complete')
      for (const k of CAT) expect(r.itemsByAxis[k] ?? 0, `${k} in session ${i}`).toBeGreaterThanOrEqual(3)
    }
  }, 120_000)

  it('a part with no budget left gets exactly its minimum of six answers, not more (every question part, owner decision 2026-10-13)', () => {
    // A Reaction Time block that took the whole target: every part after it starts with no shared time.
    const bot = new Bot({ sessionId: 's_FLOORZERO00001' })
    slowRtThenMatrix(bot, A15_TARGET_S) // 27.5 more minutes: the budget of the rest is gone
    bot.run.tick()
    expect(bot.run.result().itemsByAxis).toEqual({})
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    const r = bot.run.result()
    expect(PART_MIN_ITEMS).toBe(6)
    expect(r.itemsByAxis).toEqual({ MAT: PART_MIN_ITEMS, SPA: PART_MIN_ITEMS, QR: QUANT_MIN_ITEMS })
    for (const id of ['matrix_series', 'spatial', 'quant'] as const) expect(r.segmentEnds.find((e) => e.segment === id)?.reason, id).toBe('time')
    // The shared time is gone for all three; Quant has the minute of its own, the other two add nothing to the plan.
    expect(r.budgets.map((b) => [b.segment, b.budgetS])).toEqual([
      ['matrix_series', 0],
      ['spatial', 0],
      ['quant', QUANT_EXTRA_S],
    ])
  })

  it('without minimums (a focus session) a segment with no budget left gets exactly the §7.4 floor of three, not more', () => {
    const bot = new Bot({ sessionId: 's_FLOORZERO00001', focus: ALL_SIX })
    slowRtThenMatrix(bot, A15_TARGET_S)
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    const r = bot.run.result()
    expect(r.itemsByAxis).toEqual({ MAT: 3, SPA: 3, QR: 3 })
    expect(r.budgets.map((b) => [b.segment, b.budgetS])).toEqual([
      ['matrix_series', 0],
      ['spatial', 0],
      ['quant', 0],
    ])
  })

  it('a slow enough session still ends at the hard stop, with the floor best-effort', () => {
    const bot = new Bot({ sessionId: 's_FLOORSLOW00001' }, { blockScale: 10, itemScale: 4 })
    bot.finish()
    const v = bot.run.view()
    expect(v.ended).toBe('hard_stop')
    expect(v.elapsedS).toBeLessThan(HARD_STOP_S + 20 * 60) // the last step may overshoot by one block
  })

  it('an axis that earlier sessions covered still runs to its six, which are this session’s: the server publishes a skill from the answers of one session', () => {
    const bot = new Bot({ sessionId: 's_FLOORSESS200001', priorItemCounts: { MAT: 3, SPA: 3, QR: 3 } })
    slowRtThenMatrix(bot, A15_TARGET_S)
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    expect(bot.run.result().itemsByAxis).toEqual({ MAT: PART_MIN_ITEMS, SPA: PART_MIN_ITEMS, QR: QUANT_MIN_ITEMS })
  })

  it('without minimums (a focus session) an axis that earlier sessions covered (3 items) has no floor: a segment without budget serves nothing', () => {
    const bot = new Bot({ sessionId: 's_FLOORSESS200001', priorItemCounts: { MAT: 3, SPA: 3, QR: 3 }, focus: ALL_SIX })
    slowRtThenMatrix(bot, A15_TARGET_S)
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    expect(bot.run.result().itemsByAxis).toEqual({})
  })
})

/** The prior counts a later session gets from a session that ended as `bot` left it (the real path: save, then count). */
function priorFrom(bot: Bot): ReturnType<typeof priorItemCounts> {
  const st = bot.run.sessionState()
  return priorItemCounts(saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 1000, anonId: newAnonId() }))
}

describe('the coverage floor follows the axes covered, not the session number (M1.15 review)', () => {
  const LONG_SPANS = { span_fwd: 4, span_bwd: 4, corsi: 4 } // 4×: Quant's budget is gone, and the session still ends before the hard stop

  it('a first session abandoned before any answer does not lift the floor: the next one still gives every axis 3 items', () => {
    const abandoned = new Bot({ sessionId: 's_ABANDONED00000' })
    expect(abandoned.run.sessionState().responses).toHaveLength(0)
    const prior = priorFrom(abandoned)
    expect(prior).toEqual({})
    for (let i = 0; i < 12; i++) {
      const bot = new Bot({ sessionId: `s_FLOORLONG${String(i).padStart(5, '0')}`, priorItemCounts: prior }, { blockScale: LONG_SPANS })
      const r = bot.finish().result()
      expect(r.reason, `session ${i}`).toBe('complete')
      for (const k of CAT) expect(r.itemsByAxis[k] ?? 0, `${k} in session ${i}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('a session that stopped after reaction time leaves the power axes uncovered, so they keep the floor', () => {
    const partial = new Bot({ sessionId: 's_PARTIALRT00001' })
    partial.until((v) => v.phase === 'interstitial' && v.segment?.id === 'matrix_series')
    expect(partial.run.sessionState().responses.length).toBeGreaterThan(0) // the RT blocks
    const prior = priorFrom(partial)
    expect(prior).toEqual({})
    for (let i = 0; i < 6; i++) {
      const r = new Bot({ sessionId: `s_FLOORLONG${String(i).padStart(5, '0')}`, priorItemCounts: prior }, { blockScale: LONG_SPANS }).finish().result()
      for (const k of CAT) expect(r.itemsByAxis[k] ?? 0, `${k} in session ${i}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('only the uncovered axes keep the floor: with Matrix & Series covered, Quantitative and Spatial still get 3', () => {
    const first = new Bot({ sessionId: 's_COVEREDMAT0001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    first.finish()
    const prior = priorFrom(first)
    expect(prior.MAT ?? 0).toBeGreaterThanOrEqual(3)
    expect(prior.QR).toBeUndefined()
    for (let i = 0; i < 6; i++) {
      const bot = new Bot({ sessionId: `s_FLOORLONG${String(i).padStart(5, '0')}`, priorItemCounts: prior }, { blockScale: LONG_SPANS })
      const r = bot.finish().result()
      for (const k of ['SPA', 'QR'] as const) expect(r.itemsByAxis[k] ?? 0, `${k} in session ${i}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('earlier items count toward the 3: an axis with 2 before needs only 1 more, and one with 3 needs none (the floor alone: a focus session has no minimum)', () => {
    const one = new Bot({ sessionId: 's_FLOORSHORT0001', priorItemCounts: { MAT: 3, SPA: 2 }, focus: ALL_SIX })
    slowRtThenMatrix(one, A15_TARGET_S) // the budget of the rest is gone
    one.until((v) => v.phase === 'interstitial' && v.segment?.id === 'memory')
    expect(one.run.result().itemsByAxis).toEqual({ SPA: 1 })
  })
})

/** Leaves the question on screen until it runs out of time. */
function timeOut(bot: Bot): void {
  const v = bot.view()
  bot.run.itemShown(bot.t)
  bot.wait((v.item!.time_limit_s ?? 180) + 1)
  bot.run.tick()
}

/** Runs the Quantitative part from its "Up next" screen to its end; `timesOut(n)` says whether its n-th question (from 0) is left to run out. */
function playQuant(bot: Bot, timesOut: (n: number) => boolean = () => false): { shown: number; answered: number } {
  let shown = 0
  let answered = 0
  bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'quant')
  for (let i = 0; i < 400; i++) {
    bot.run.tick()
    const v = bot.view()
    if (v.phase === 'finished' || (v.phase === 'interstitial' && v.segment?.id !== 'quant')) break
    if (v.phase === 'item' && timesOut(shown++)) timeOut(bot)
    else {
      if (v.phase === 'item') answered++
      bot.step()
    }
  }
  return { shown, answered }
}

/**
 * Extra seconds in Working Memory that leave Quant none of the shared time (the session is past its
 * target less the tasks still to come), and still leave room before the hard stop for eight questions
 * that all run out of time.
 */
const GONE_S = 8 * 60

describe('the Quantitative part runs to six answered questions (A15 amended, owner decision 2026-10-12; DESIGN §7.4)', () => {
  it('six is one more than a skill is published from, and at most two more are shown to get there', () => {
    expect(QUANT_MIN_ITEMS).toBe(6)
    expect(QUANT_MIN_ITEMS).toBeGreaterThan(PUBLISH_MIN_ITEMS)
    expect(MIN_ITEMS_SLACK).toBe(2)
  })

  it('a session is planned a minute longer for it, and the part says "About 6 min" however little shared time is left', () => {
    const bot = new Bot({ sessionId: 's_QRSIXPLAN00001' })
    expect(bot.view().targetS).toBe(A15_TARGET_S + QUANT_EXTRA_S + A15_TYPICAL_OVER_S)
    const quant = (b: Bot): number => b.view().segments.find((s) => s.id === 'quant')!.minutes
    const planned = plannedParts('s_QRSIXPLAN00001').find((p) => p.id === 'quant')!.s
    expect(planned).toBeGreaterThan(5 * 60)
    expect(quant(bot)).toBe(Math.round(planned / 60))
    slowMemoryThenQuant(bot, GONE_S)
    expect(bot.view().segment?.minutes).toBe(Math.round(planned / 60))
    bot.run.startSegment()
    expect(bot.view().segment?.minutes).toBe(Math.round(planned / 60))
    // A session without the part has no minute added.
    expect(new Bot({ sessionId: 's_QRSIXPLAN00002', skipped: ['QR'] }).view().targetS).toBe(A15_TARGET_S + A15_TYPICAL_OVER_S)
  })

  it('with its time gone before it starts it asks exactly six, all answered, and ends on time', () => {
    const bot = new Bot({ sessionId: 's_QRSIXZERO00001' })
    slowMemoryThenQuant(bot, GONE_S)
    expect(playQuant(bot)).toEqual({ shown: 6, answered: 6 })
    const r = bot.run.result()
    expect(r.itemsByAxis.QR).toBe(6)
    expect(r.segmentEnds.find((e) => e.segment === 'quant')?.reason).toBe('time')
    expect(bot.view().segment?.id).toBe('coding_reading')
    expect(bot.finish().result().reason).toBe('complete')
  })

  it('a question that runs out of time is not one of the six: one more is shown for each, up to two', () => {
    const run = (id: string, timesOut: (n: number) => boolean): { shown: number; answered: number } => {
      const bot = new Bot({ sessionId: id })
      slowMemoryThenQuant(bot, GONE_S)
      const got = playQuant(bot, timesOut)
      expect(bot.run.result().itemsByAxis.QR, id).toBe(got.shown)
      expect(bot.view().phase, id).not.toBe('finished') // the session goes on to the next part
      return got
    }
    expect(run('s_QRSIXTIMEOUT01', (n) => n === 1)).toEqual({ shown: 7, answered: 6 })
    expect(run('s_QRSIXTIMEOUT02', (n) => n === 0 || n === 4)).toEqual({ shown: 8, answered: 6 })
    expect(run('s_QRSIXTIMEOUT03', (n) => n < 3)).toEqual({ shown: 8, answered: 5 })
    expect(run('s_QRSIXTIMEOUT04', () => true)).toEqual({ shown: 8, answered: 0 })
  })

  it('whatever runs out of time, the part shows at most eight, and stops at six answers or at eight shown', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), fc.integer({ min: 0, max: 9999 }), (outs, n) => {
        const bot = new Bot({ sessionId: `s_QRSIXPROP${String(n).padStart(6, '0')}` })
        slowMemoryThenQuant(bot, GONE_S)
        const got = playQuant(bot, (i) => outs[i] ?? false)
        expect(got.shown).toBeLessThanOrEqual(QUANT_MIN_ITEMS + MIN_ITEMS_SLACK)
        expect(got.answered).toBeLessThanOrEqual(QUANT_MIN_ITEMS)
        expect(got.answered === QUANT_MIN_ITEMS || got.shown === QUANT_MIN_ITEMS + MIN_ITEMS_SLACK).toBe(true)
        // What was shown is what the plan of time-outs gives: the six answers come as soon as they can.
        let answered = 0
        let shown = 0
        while (answered < QUANT_MIN_ITEMS && shown < QUANT_MIN_ITEMS + MIN_ITEMS_SLACK) if (!outs[shown++]) answered++
        expect(got).toEqual({ shown, answered })
      }),
      { numRuns: 25 },
    )
  }, 120_000)

  it('across takers of every pace: six or more answered in every session that ends by itself, and Matrix & Series and Spatial get the time they had', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), fc.double({ min: 0.6, max: 1.8, noNaN: true }), fc.double({ min: 0.6, max: 1.6, noNaN: true }), (n, blockScale, itemScale) => {
        const id = `s_QRSIXPACE${String(n).padStart(6, '0')}`
        const bot = new Bot({ sessionId: id }, { theta: Array.from({ length: N_AXES }, (_, k) => ((n * (k + 3)) % 7) / 2 - 1.5), blockScale, itemScale })
        const r = bot.finish().result()
        const parts = plannedParts(id)
        if (r.reason === 'complete') {
          expect(r.itemsByAxis.QR ?? 0).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
          for (const k of ['MAT', 'SPA'] as const) expect(r.itemsByAxis[k] ?? 0, k).toBeGreaterThanOrEqual(3)
        } else expect(r.reason).toBe('hard_stop')
        expect(r.durationS).toBeLessThanOrEqual(HARD_STOP_S)
        for (const b of r.budgets) {
          const planned = parts.find((p) => p.id === b.segment)!.s
          expect(b.plannedS, b.segment).toBeCloseTo(planned, 9)
          expect(b.budgetS, b.segment).toBeLessThanOrEqual(b.plannedS + 1e-9)
          if (b.segment === 'quant') expect(b.budgetS).toBeGreaterThanOrEqual(QUANT_EXTRA_S - 1e-9) // the minute of its own
        }
        // The other two parts' shares are those of the plan without the minimum: a third of what the timed tasks leave.
        const shares = parts.filter((p) => p.id === 'matrix_series' || p.id === 'spatial' || p.id === 'quant').map((p) => p.s)
        expect(shares[0]).toBeCloseTo(shares[1]!, 9)
        expect(shares[2]).toBeCloseTo(shares[0]! + QUANT_EXTRA_S, 9)
      }),
      { numRuns: 20 },
    )
  }, 120_000)

  it('skipping the part, finishing early and the hard stop work in the middle of the six', () => {
    const skip = new Bot({ sessionId: 's_QRSIXSKIP00001' })
    slowMemoryThenQuant(skip, GONE_S)
    skip.run.startSegment()
    skip.until((v) => skip.run.result().itemsByAxis.QR === 2 && v.phase === 'item')
    skip.run.skipAxis('QR')
    expect(skip.view().segment?.id).toBe('coding_reading')
    expect(skip.run.result().itemsByAxis.QR).toBe(2)
    expect(skip.finish().result().skipped).toEqual(['QR'])

    const early = new Bot({ sessionId: 's_QRSIXEARLY0001' })
    slowMemoryThenQuant(early, GONE_S)
    early.run.startSegment()
    early.until((v) => early.run.result().itemsByAxis.QR === 3 && v.phase === 'item')
    early.run.finishEarly()
    expect(early.view().ended).toBe('finish_early')
    expect(early.run.result().itemsByAxis.QR).toBe(3)

    // The hard stop is the clock's: a part short of its six does not hold the session past it.
    const hard = new Bot({ sessionId: 's_QRSIXHARD00001' })
    slowMemoryThenQuant(hard, HARD_STOP_S - 20 * 60)
    hard.run.startSegment()
    hard.until((v) => v.phase === 'item')
    hard.wait(HARD_STOP_S)
    hard.run.tick()
    expect(hard.view().ended).toBe('hard_stop')
    expect(hard.run.result().durationS).toBe(HARD_STOP_S)
    expect(hard.run.result().itemsByAxis.QR ?? 0).toBeLessThan(QUANT_MIN_ITEMS)
  })

  it('the precision stop still ends the part before six, and a focus session has no minimum and no minute added', () => {
    const precise = new Bot({ sessionId: 's_QRSIXSTOPSD001', stopSd: 0.95 })
    slowMemoryThenQuant(precise, GONE_S)
    const got = playQuant(precise)
    expect(got.shown).toBeLessThan(QUANT_MIN_ITEMS)
    expect(precise.run.result().segmentEnds.find((e) => e.segment === 'quant')?.reason).toBe('axes_done')

    const focus = new Bot({ sessionId: 's_QRSIXFOCUS0001', focus: ['WM', 'QR'], targetS: 20 * 60 })
    expect(focus.view().targetS).toBe(20 * 60)
    focus.until((v) => v.phase === 'block' && v.segment?.id === 'memory')
    focus.wait(20 * 60) // the focus session's time is gone before Quant
    expect(playQuant(focus)).toEqual({ shown: 3, answered: 3 }) // the floor of a first session, as before
  })

  it('a continuation that still has the part runs it to six, and its target counts the minute once', () => {
    const id = 's_QRSIXCONT00001'
    const parts = plannedParts(id)
    const planned = (ids: readonly SegmentId[]): number => parts.filter((p) => ids.includes(p.id)).reduce((t, p) => t + p.s, 0)
    const bot = new Bot({ sessionId: id, continues: { done: ['rt', 'matrix_series', 'spatial', 'memory'], skipped: [] } })
    expect(bot.view().targetS).toBeCloseTo(planned(['quant', 'coding_reading']), 6)
    expect(playQuant(bot).answered).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
    const done = new Bot({ sessionId: id, continues: { done: ['rt', 'matrix_series', 'spatial', 'memory', 'quant'], skipped: [] } })
    expect(done.view().targetS).toBeCloseTo(planned(['coding_reading']), 6)
  })
})

describe('per-axis early stop (SD < 0.3)', () => {
  it('a CAT segment ends when its axis posterior SD is below the stop SD (A15)', () => {
    const bot = new Bot({ sessionId: 's_EARLYSTOP00001', stopSd: 0.9, skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.finish()
    const r = bot.run.result()
    expect(r.itemsByAxis.MAT ?? 0).toBeGreaterThanOrEqual(1)
    expect(r.segmentEnds.find((e) => e.segment === 'matrix_series')?.reason).toBe('axes_done')
    expect(r.score?.eap.MAT?.sd).toBeLessThan(0.9)
  })

  it('at the default 0.3 the segment keeps going until SD < 0.3 when time allows', () => {
    expect(STOP_SD).toBe(0.3)
    const bot = new Bot(
      { sessionId: 's_EARLYSTOP00002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'], targetS: 1e7, hardStopS: 1e7 },
      { itemScale: 0.05, theta: theta({ MAT: 0.5 }) },
    )
    bot.finish(400)
    const r = bot.run.result()
    expect(r.segmentEnds.find((e) => e.segment === 'matrix_series')?.reason).toBe('axes_done')
    expect(r.score?.eap.MAT?.sd).toBeLessThan(STOP_SD)
    expect(r.itemsByAxis.MAT).toBeGreaterThan(12)
  }, 60_000)
})

describe('skip axis (§13)', () => {
  it('skipping at the interstitial removes the segment; nothing is asked for that axis', () => {
    // The break goes before Matrix & Series here, so the skip leads straight to the next "Up next" screen.
    const bot = new Bot({ sessionId: 's_SKIPINTER00001', breakAtS: 0 })
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'spatial')
    expect(bot.view().skippable).toBe('SPA')
    bot.run.skipAxis()
    expect(bot.view().segment?.id).toBe('memory')
    expect(bot.view().notice).toMatchObject({ kind: 'skipped', axis: 'SPA' })
    bot.finish()
    const r = bot.run.result()
    expect(r.itemsByAxis.SPA ?? 0).toBe(0)
    expect(r.skipped).toEqual(['SPA'])
    expect(bot.run.view().segments.find((s) => s.id === 'spatial')?.status).toBe('skipped')
    expect(bot.run.sessionState().flags.skipped_spa).toBe(true)
  })

  it('skipping in the middle of an item drops it and moves on', () => {
    const bot = new Bot({ sessionId: 's_SKIPITEM000001' })
    bot.until((v) => v.phase === 'item')
    const before = bot.run.view().counts.items
    bot.run.skipAxis()
    const v = bot.run.view()
    expect(v.phase).toBe('interstitial')
    expect(v.item).toBeNull()
    expect(v.counts.items).toBe(before)
    expect(v.skipped).toEqual(['MAT'])
  })

  it('skipping while a block runs drops the block and its segment, keeping earlier blocks of the axis in the save', () => {
    const bot = new Bot({ sessionId: 's_SKIPBLOCK00001' })
    bot.step() // interstitial → rt_simple
    bot.step() // rt_simple done
    expect(bot.run.view().block?.family).toBe('rt_choice4')
    bot.run.skipAxis()
    expect(bot.run.view().segment?.id).toBe('matrix_series')
    const st = bot.run.sessionState()
    expect(st.responses.map((r) => parseItemId(r[0])?.family)).toEqual(['rt_simple'])
    expect(st.flags.skipped_rt).toBe(true)
    expect(bot.run.result().skipped).toEqual(['RT'])
  })

  it('an axis skipped early has its later segment passed over without an interstitial', () => {
    const bot = new Bot({ sessionId: 's_SKIPLATER00001' })
    bot.run.skipAxis('PS') // from the RT interstitial: a later axis
    const seen: SegmentId[] = []
    for (let i = 0; i < 2000; i++) {
      const v = bot.view()
      if (v.phase === 'interstitial' && v.segment) seen.push(v.segment.id)
      if (v.phase === 'finished') break
      bot.run.tick()
      bot.step()
    }
    expect(seen).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant'])
    expect(bot.view().segments.at(-1)?.status).toBe('skipped')
  })

  it('an axis that is skipped stays skipped: starting skipped from the config is the same', () => {
    const bot = new Bot({ sessionId: 's_SKIPCONFIG0001', skipped: ['QR', 'WM'] })
    bot.finish()
    const r = bot.run.result()
    expect(r.itemsByAxis.QR ?? 0).toBe(0)
    expect(r.blocks.some((b) => b.axis === 'WM')).toBe(false)
    expect([...r.skipped].sort()).toEqual(['QR', 'WM'])
  })

  it('skipping every axis finishes the session with nothing measured', () => {
    const bot = new Bot({ sessionId: 's_SKIPALL0000001', skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
    expect(bot.view().phase).toBe('finished')
    expect(bot.view().ended).toBe('complete')
    expect(bot.run.result().score).toBeNull()
  })

  it('an answer is recorded the moment it is given, so a skip right after it keeps it, with its confidence', () => {
    const bot = new Bot({ sessionId: 's_SKIPCONF000001' })
    bot.until((v) => v.phase === 'item')
    const pct = midConfidence(bot.view())
    bot.answer(pct)
    bot.run.skipAxis()
    const last = bot.run.sessionState().responses.at(-1)!
    expect(last[5]).toBe(pct)
    expect(last[3]).not.toBeNull()
  })
})

describe('finish early and the hard stop (§7.4)', () => {
  it('finish early ends the session with what there is', () => {
    const bot = new Bot({ sessionId: 's_FINISHEARLY001' })
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'spatial')
    bot.run.finishEarly()
    const v = bot.run.view()
    expect(v.phase).toBe('finished')
    expect(v.ended).toBe('finish_early')
    expect(v.segments.map((s) => s.status)).toEqual(['done', 'done', 'not_reached', 'not_reached', 'not_reached', 'not_reached'])
    expect(bot.run.sessionState().flags.finished_early).toBe(true)
    expect(bot.run.result().score).not.toBeNull()
    // Nothing more can happen.
    bot.run.startSegment()
    bot.run.itemResponded(0)
    expect(bot.run.view().phase).toBe('finished')
  })

  it('finish early right after an answer given with the scale unset keeps the answer, unrated', () => {
    const bot = new Bot({ sessionId: 's_FINISHCONF0001' })
    bot.until((v) => v.phase === 'item')
    bot.answer(null)
    bot.run.finishEarly()
    const last = bot.run.sessionState().responses.at(-1)!
    expect(last[5]).toBeNull()
    expect(last[3]).not.toBeNull()
    expect(bot.run.result().calibration).toBeNull()
  })

  it('finish early in the very first seconds gives an empty but valid result', () => {
    const bot = new Bot({ sessionId: 's_FINISHNONE0001' })
    bot.run.finishEarly()
    expect(bot.run.result().score).toBeNull()
    expect(bot.run.sessionState().responses).toEqual([])
    const save = saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: newAnonId() })
    expect(save.sessions[0]!.responses).toEqual([])
  })

  it('the hard stop ends the session at 57 active minutes, wherever it is', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000001' })
    bot.until((v) => v.phase === 'item')
    const before = bot.run.sessionState().responses.length
    bot.wait(HARD_STOP_S) // jump: the item on screen is dropped
    bot.run.tick()
    const v = bot.run.view()
    expect(v.phase).toBe('finished')
    expect(v.ended).toBe('hard_stop')
    expect(bot.run.sessionState().responses.length).toBe(before)
    expect(bot.run.sessionState().flags.hard_stop).toBe(true)
    expect(bot.run.sessionState().durationS).toBe(HARD_STOP_S)
  })

  it('pins the hard stop of the spec: 57 active minutes (DESIGN §7.4)', () => {
    expect(HARD_STOP_S).toBe(57 * 60)
  })

  it('does not stop a second early: at 56:59 the session is still going, and at 57:00 it ends', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000002' })
    bot.until((v) => v.phase === 'block') // a block has no time cap of its own, so the part is still on at 56:59
    bot.wait(HARD_STOP_S - 1 - bot.run.view().elapsedS)
    bot.run.tick()
    expect(bot.run.view().elapsedS).toBeCloseTo(HARD_STOP_S - 1, 3)
    expect(bot.run.view().ended).not.toBe('hard_stop')
    expect(bot.run.sessionState().flags.hard_stop).toBeFalsy()
    bot.wait(1)
    bot.run.tick()
    expect(bot.run.view().ended).toBe('hard_stop')
    expect(bot.run.sessionState().durationS).toBe(HARD_STOP_S)
  })

  it('a tab suspended past the stop is recorded at the limit, not at the late reading (breaks left out)', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOPLATE01' })
    bot.until((v) => v.phase === 'item')
    bot.wait(3 * 3600) // three hours in a background tab
    bot.run.tick()
    expect(bot.run.view().ended).toBe('hard_stop')
    expect(bot.run.sessionState().durationS).toBe(HARD_STOP_S)
    expect(bot.run.result().durationS).toBe(HARD_STOP_S)
    expect(bot.run.view().elapsedS).toBe(HARD_STOP_S)
    bot.wait(3600) // and the number stays fixed
    expect(bot.run.sessionState().durationS).toBe(HARD_STOP_S)

    // With a break taken earlier the paused time is not counted, and the cap is still the active limit.
    const b = new Bot({ sessionId: 's_HARDSTOPLATE02', breakAtS: 60 }, { onBreakOffer: 'take', breakS: 900 })
    b.until((v) => v.phase === 'on_break')
    const paused = b.view().elapsedS
    b.wait(900)
    b.run.resume()
    expect(b.view().elapsedS).toBeCloseTo(paused, 3)
    b.run.startSegment() // the next part: the clock runs again
    b.wait(2 * 3600)
    b.run.tick()
    expect(b.run.view().ended).toBe('hard_stop')
    expect(b.run.sessionState().durationS).toBe(HARD_STOP_S)
    expect(b.run.sessionState().flags.breaks).toBe(1)
  })

  it('the elapsed time never runs backwards when the stop is noticed late (a block still on screen)', () => {
    // M1.R review: the clock ran past the limit inside a block, then the finish pulled it back to the limit.
    const bot = new Bot({ sessionId: 's_FUZZ00000000012', hardStopS: 900 })
    bot.step()
    bot.step()
    const seen: number[] = [bot.view().elapsedS]
    bot.wait(910 - bot.view().elapsedS)
    seen.push(bot.view().elapsedS, bot.run.elapsedS())
    bot.run.takeBreak() // every call checks the clock: this ends the session at the stop
    seen.push(bot.view().elapsedS, bot.run.elapsedS())
    expect(bot.run.view().ended).toBe('hard_stop')
    for (let i = 1; i < seen.length; i++) expect(seen[i]!, `reading ${i}`).toBeGreaterThanOrEqual(seen[i - 1]!)
    expect(Math.max(...seen)).toBe(900)
    expect(bot.run.sessionState().durationS).toBe(900)
  })

  it('finishing early records the real duration (the cap is for the hard stop only)', () => {
    const bot = new Bot({ sessionId: 's_FINISHNOCAP001', hardStopS: 100 })
    bot.run.startSegment()
    bot.wait(400)
    bot.run.finishEarly()
    expect(bot.run.view().ended).toBe('finish_early')
    expect(bot.run.sessionState().durationS).toBeCloseTo(400, 6)
  })

  it('every call checks the clock, so a missed tick cannot let the session run past the stop', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000002' })
    bot.until((v) => v.phase === 'item')
    bot.wait(HARD_STOP_S + 5)
    bot.run.itemResponded(0) // a late answer is not counted
    expect(bot.run.view().ended).toBe('hard_stop')
    expect(bot.run.sessionState().responses.every((r) => r[0].startsWith('i:rt_') || r[0].startsWith('i:rt'))).toBe(true)
  })

  it('an answer given just before the stop is kept, with the confidence it was given', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000003' })
    bot.until((v) => v.phase === 'item')
    const n = bot.run.sessionState().responses.length
    const pct = midConfidence(bot.view())
    bot.answer(pct)
    bot.wait(HARD_STOP_S)
    bot.run.tick()
    const st = bot.run.sessionState()
    expect(bot.run.view().ended).toBe('hard_stop')
    expect(st.responses.length).toBe(n + 1)
    expect(st.responses.at(-1)![5]).toBe(pct)
  })

  it('a custom hard stop applies (config)', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000004', hardStopS: 300 })
    bot.finish()
    expect(bot.run.view().ended).toBe('hard_stop')
  })
})

/** The parts of a plan with their planned seconds, in order (block E[T] or the CAT segment's planned share). */
function plannedParts(sessionId: string, opts: { skipped?: readonly AxisCode[]; focus?: readonly AxisCode[]; targetS?: number } = {}): { id: SegmentId; s: number }[] {
  const weights: Partial<Record<AxisCode, number>> = {}
  for (const k of opts.skipped ?? []) weights[k] = 0
  if (opts.focus !== undefined) for (const k of AXIS_CODES) if (!opts.focus.includes(k)) weights[k] = 0
  const parts: { id: SegmentId; s: number }[] = []
  // As the run plans it: a focus session has no minimum on the Quantitative part (A15_MINIMUMS).
  for (const st of planSession({ sessionSeed: sessionId, weights, targetS: opts.targetS ?? A15_TARGET_S, minimums: opts.focus === undefined })) {
    const s = st.kind === 'block' ? st.item.expected_time_s : st.budget_s
    const last = parts.at(-1)
    if (last?.id === st.segment) last.s += s
    else parts.push({ id: st.segment, s })
  }
  return parts
}

/** The part whose interstitial the break precedes: the boundary nearest `atS` in planned time (earlier on a tie), or null. */
function halfWayPart(parts: readonly { id: SegmentId; s: number }[], atS: number): SegmentId | null {
  let best: SegmentId | null = null
  let gap = Infinity
  let cum = 0
  for (let i = 1; i < parts.length; i++) {
    cum += parts[i - 1]!.s
    if (Math.abs(cum - atS) < gap) {
      gap = Math.abs(cum - atS)
      best = parts[i]!.id
    }
  }
  return best
}

describe('the clock waits between parts (UX-066, §10)', () => {
  it('stands still on every "Up next" screen, the first one after Begin included, until Start', () => {
    const bot = new Bot({ sessionId: 's_CLOCKWAITS0001' }, { interstitialS: 240 })
    let interstitials = 0
    for (let i = 0; i < 3000; i++) {
      const v = bot.view()
      if (v.phase === 'finished') break
      if (v.phase === 'interstitial') {
        interstitials++
        expect(v.clockHeld).toBe(true)
        const at = v.elapsedS
        bot.wait(240)
        bot.run.tick()
        expect(bot.view().elapsedS, `${v.segment?.id}`).toBe(at)
        bot.run.startSegment()
        expect(bot.view().clockHeld).toBe(false)
        continue
      }
      bot.run.tick()
      bot.step()
    }
    expect(interstitials).toBe(6)
    // Four minutes on each of six screens left out: the session is as long as one that started each part at once.
    const quick = new Bot({ sessionId: 's_CLOCKWAITS0001' })
    quick.finish()
    expect(bot.run.sessionState().durationS).toBeCloseTo(quick.run.sessionState().durationS, 6)
  })

  it('Skip on an interstitial moves to the next one with the clock still held', () => {
    const bot = new Bot({ sessionId: 's_CLOCKSKIP00001', breakAtS: 1e9 })
    bot.wait(100)
    bot.run.skipAxis() // reaction time
    expect(bot.view().phase).toBe('interstitial')
    bot.wait(100)
    bot.run.skipAxis() // Matrix & Series
    bot.wait(100)
    expect(bot.view().segment?.id).toBe('spatial')
    expect(bot.view().elapsedS).toBe(0)
    bot.run.startSegment()
    bot.wait(7)
    expect(bot.view().elapsedS).toBe(7)
  })

  it('a hard stop cannot come while the clock waits, and comes on time once a part runs', () => {
    const bot = new Bot({ sessionId: 's_CLOCKSTOP00001', hardStopS: 600 })
    bot.wait(3600)
    bot.run.tick()
    expect(bot.view().phase).toBe('interstitial')
    bot.run.startSegment()
    bot.wait(601)
    bot.run.tick()
    expect(bot.view().ended).toBe('hard_stop')
    expect(bot.run.sessionState().durationS).toBe(600)
  })
})

describe('the break, at the part boundary nearest half-way (UX-066, §10)', () => {
  it('goes before the part whose planned start is nearest half the target: Working Memory in the A15 plan', () => {
    for (const id of ['s_BREAKHALF00001', 's_BREAKHALF00002', 's_BREAKHALF00003']) {
      const parts = plannedParts(id)
      const bot = new Bot({ sessionId: id })
      expect(bot.view().breakAtS).toBe(A15_TARGET_S / 2)
      expect(bot.view().breakBefore).toBe(halfWayPart(parts, A15_TARGET_S / 2))
      expect(bot.view().breakBefore).toBe('memory')
    }
  })

  it('is offered once, between two parts, before that part’s "Up next" screen; declining carries on', () => {
    const bot = new Bot({ sessionId: 's_BREAKDECLINE01' }, { blockScale: 2, itemScale: 1.5, onBreakOffer: 'decline' })
    let offers = 0
    let prev = ''
    let after: string | null = null
    for (let i = 0; i < 3000; i++) {
      const v = bot.view()
      if (v.phase === 'finished') break
      if (after === 'next' && v.phase !== 'break_offer') after = v.phase === 'interstitial' ? (v.segment?.id ?? '') : v.phase
      if (v.phase === 'break_offer') {
        offers++
        // At the end of a part (an answer rated, a block done, an item timed out), with nothing on screen and the clock held.
        expect(['block', 'item'], `phase before the offer`).toContain(prev)
        expect(v.item).toBeNull()
        expect(v.block).toBeNull()
        expect(v.clockHeld).toBe(true)
        const at = v.elapsedS
        bot.wait(120)
        expect(bot.view().elapsedS).toBe(at)
        after = 'next'
      }
      prev = v.phase
      bot.run.tick()
      bot.step()
    }
    expect(offers).toBe(1)
    expect(after).toBe('memory')
    expect(bot.run.view().phase).toBe('finished')
  })

  it('a break holds the clock; the time on it is not session time, and the clock waits on until Start', () => {
    const bot = new Bot({ sessionId: 's_BREAKTAKE00004' }, { onBreakOffer: 'take', breakS: 1200 })
    const v = bot.until((x) => x.phase === 'break_offer')
    const at = v.elapsedS
    bot.run.takeBreak()
    expect(bot.view().phase).toBe('on_break')
    bot.wait(1200)
    expect(bot.view().elapsedS).toBeCloseTo(at, 3)
    bot.run.resume()
    expect(bot.view().phase).toBe('interstitial')
    expect(bot.view().segment?.id).toBe('memory')
    bot.wait(60)
    expect(bot.view().elapsedS).toBeCloseTo(at, 3)
    bot.run.startSegment()
    bot.wait(5)
    expect(bot.view().elapsedS).toBeCloseTo(at + 5, 3)
    expect(bot.run.sessionState().flags.breaks).toBe(1)
  })

  it('never comes in the middle of a part, however long it runs', () => {
    const bot = new Bot({ sessionId: 's_BREAKWAITS0001' })
    const v = bot.until((x) => x.phase === 'item')
    bot.wait(40 * 60 - v.elapsedS) // 40 minutes into the session, inside Matrix & Series
    bot.run.tick()
    expect(bot.view().phase).toBe('item') // timed out, and the part goes on (its floor)
    bot.until((x) => x.phase === 'interstitial' && x.segment?.id === 'spatial')
    expect(bot.phases).not.toContain('break_offer')
  })

  it('a skipped half-way part moves the offer to the next "Up next" screen shown', () => {
    const bot = new Bot({ sessionId: 's_BREAKSKIPHALF1', skipped: ['WM'] })
    const parts = plannedParts('s_BREAKSKIPHALF1', { skipped: ['WM'] })
    const half = halfWayPart(parts, A15_TARGET_S / 2)
    expect(bot.view().breakBefore).toBe(half)
    // Skip the part the break goes before, mid-session: the offer comes before the next one after it.
    const b2 = new Bot({ sessionId: 's_BREAKSKIPHALF2' })
    b2.until((x) => x.phase === 'block' && x.segment?.id === 'rt')
    b2.run.skipAxis('WM') // Working Memory, the half-way part, before it is reached
    const offer = b2.until((x) => x.phase === 'break_offer')
    expect(offer.segment?.id).toBe('spatial') // the part that just ended
    b2.run.declineBreak()
    expect(b2.view().phase).toBe('interstitial')
    expect(b2.view().segment?.id).toBe('quant')
  })

  it('is not offered in a plan of one part, nor once the hard stop has come first, nor when every part after it is skipped', () => {
    const one = new Bot({ sessionId: 's_BREAKONEPART01', focus: ['QR'] })
    expect(one.view().breakBefore).toBeNull()
    one.finish()
    expect(one.phases).not.toContain('break_offer')
    // A hard stop before half-way ends the session first, and never offers a break after it.
    const early = new Bot({ sessionId: 's_BREAKSTOP00001', hardStopS: 600 }, { blockScale: 2, itemScale: 2 })
    early.finish()
    expect(early.run.view().ended).toBe('hard_stop')
    expect(early.phases).not.toContain('break_offer')
    early.run.takeBreak()
    expect(early.run.view().phase).toBe('finished')
    expect(early.run.sessionState().flags.breaks).toBeUndefined()
    // Every part from the half-way one on skipped: the session ends without an offer.
    const rest = new Bot({ sessionId: 's_BREAKRESTSKIP1', skipped: ['WM', 'QR', 'PS'] }, {})
    expect(rest.view().breakBefore).toBe('spatial')
    rest.until((x) => x.phase === 'block' && x.segment?.id === 'rt')
    rest.run.skipAxis('SPA')
    rest.finish()
    expect(rest.phases).not.toContain('break_offer')
  })

  it('a break cannot be taken when none is offered', () => {
    const bot = new Bot({ sessionId: 's_BREAKNONE00001' })
    bot.run.takeBreak()
    expect(bot.view().phase).toBe('interstitial')
    bot.run.resume()
    expect(bot.view().phase).toBe('interstitial')
  })

  it('a 20-minute focus session with two or more parts gets its break at its own half-way boundary', () => {
    const focus: AxisCode[] = ['MAT', 'WM', 'QR']
    const bot = new Bot({ sessionId: 's_BREAKFOCUS0001', focus, targetS: 20 * 60 })
    const parts = plannedParts('s_BREAKFOCUS0001', { focus, targetS: 20 * 60 })
    expect(parts.map((p) => p.id)).toEqual(['matrix_series', 'memory', 'quant'])
    expect(bot.view().breakBefore).toBe(halfWayPart(parts, 10 * 60))
    bot.finish()
    expect(bot.phases.filter((p) => p === 'break_offer')).toHaveLength(1)
  })
})

/** What the property tests below do at each step of a session. */
type Act = 'go' | 'skip_here' | 'skip_other' | 'slow' | 'timeout'

describe('clock, break, part caps and floor: properties over plans and skip patterns (UX-066)', () => {
  /** A plan (focus, skipped from the start), a seed, and what the taker does: waits on screens, skips, slow items. */
  const scenario = fc.record({
    seed: fc.integer({ min: 0, max: 9999 }),
    focus: fc.option(fc.subarray(['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] as AxisCode[], { minLength: 1 }), { nil: undefined }),
    skipped: fc.subarray(['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] as AxisCode[], { maxLength: 3 }),
    acts: fc.array(fc.constantFrom<Act>('go', 'go', 'go', 'go', 'skip_here', 'skip_other', 'slow', 'timeout'), { minLength: 20, maxLength: 80 }),
    waitS: fc.integer({ min: 0, max: 900 }),
    take: fc.boolean(),
  })

  it('the clock is held on every interstitial and the break offer; the break is offered once, at the planned half-way boundary; no part starts with more than its planned share', () => {
    fc.assert(
      fc.property(scenario, ({ seed, focus, skipped, acts, waitS, take }) => {
        const sessionId = `s_PROPCLOCK${String(seed).padStart(6, '0')}`
        const bot = new Bot({ sessionId, skipped, ...(focus === undefined ? {} : { focus }) }, { onBreakOffer: take ? 'take' : 'decline', breakS: waitS })
        const parts = plannedParts(sessionId, { skipped, ...(focus === undefined ? {} : { focus }) })
        const half = halfWayPart(parts, A15_TARGET_S / 2)
        expect(bot.view().breakBefore).toBe(half)
        const halfIdx = half === null ? Infinity : parts.findIndex((p) => p.id === half)
        const order = parts.map((p) => p.id)
        let offers = 0
        let offeredBeforeIdx = -1
        let pendingOffer = false
        let step = 0
        for (let n = 0; n < 4000; n++) {
          const v = bot.view()
          if (v.phase === 'finished') break
          const act = acts[step++ % acts.length]!
          if (v.phase === 'interstitial' || v.phase === 'break_offer') {
            expect(v.clockHeld, v.phase).toBe(true)
            const at = v.elapsedS
            bot.wait(waitS)
            bot.run.tick()
            expect(bot.view().elapsedS, `${v.phase} ${v.segment?.id}`).toBe(at)
          }
          if (v.phase === 'interstitial') {
            const idx = order.indexOf(v.segment!.id)
            if (pendingOffer) {
              offeredBeforeIdx = idx
              pendingOffer = false
            }
            // An interstitial at or after the half-way part comes only after the one offer.
            if (idx >= halfIdx) expect(offers, `offer before ${v.segment?.id}`).toBe(1)
            if (act === 'skip_here') bot.run.skipAxis()
            else bot.run.startSegment()
            continue
          }
          if (v.phase === 'break_offer') {
            offers++
            pendingOffer = true
          }
          if (act === 'skip_here' && v.skippable !== null && v.phase !== 'break_offer') {
            bot.run.skipAxis()
            continue
          }
          if (act === 'skip_other') {
            const later = v.segments.slice(v.segmentIndex + 1).find((s) => s.status === 'upcoming')
            const k = later?.axes.find((a) => !v.skipped.includes(a))
            if (k !== undefined) bot.run.skipAxis(k)
          }
          if ((act === 'slow' || act === 'timeout') && v.phase === 'item' && v.item !== null) {
            bot.wait(act === 'timeout' ? v.item.time_limit_s + 1 : v.item.time_limit_s / 2)
            bot.run.tick()
            if (bot.view().phase !== 'item') continue
          }
          bot.run.tick()
          bot.step()
        }
        expect(bot.view().phase).toBe('finished')
        expect(offers).toBeLessThanOrEqual(1)
        if (offers === 1 && offeredBeforeIdx >= 0) {
          // The offer came right before the first interstitial shown at or after the half-way part.
          expect(offeredBeforeIdx).toBeGreaterThanOrEqual(halfIdx)
        }
        // No CAT part starts with more than its planned share, whatever was skipped before it.
        for (const b of bot.run.result().budgets) expect(b.budgetS, b.segment).toBeLessThanOrEqual(b.plannedS + 1e-9)
      }),
      { numRuns: 40 },
    )
  }, 120_000)

  it('a skip never makes a later part longer: every CAT part’s budget and its "About N min" are at most the plan’s, and skipping shortens the session', () => {
    // Skipping changes which questions come after it (the seed counter and the aim move), and a part with a minimum
    // of answers may run past its budget, so one session's length after a skip is not bounded by the same session's
    // without it: with information alone inside a part (2026-10-16), one of these 24 sessions (θ = 0, a lucky run of
    // three right answers on Quantitative that the start-up follows to stratum 6) is longer. The budgets are bounded
    // per session; the length is shorter in at least 22 of the 24, and on average for every kind of skip.
    const longer: string[] = []
    const total: Partial<Record<AxisCode, number>> = {}
    let plainTotal = 0
    for (let i = 0; i < 8; i++) {
      const id = `s_CAPSKIP${String(i).padStart(7, '0')}`
      const plain = new Bot({ sessionId: id }).finish()
      plainTotal += plain.sessionState().durationS
      for (const skip of ['RT', 'MAT', 'SPA'] as AxisCode[]) {
        const bot = new Bot({ sessionId: id })
        const shown: Partial<Record<SegmentId, number>> = {}
        bot.until((v) => {
          if (v.phase === 'interstitial' && v.segment !== null) {
            shown[v.segment.id] ??= v.segment.minutes
            if (v.segment.axes.includes(skip) && !v.skipped.includes(skip)) bot.run.skipAxis()
          }
          return v.phase === 'finished'
        })
        const parts = plannedParts(id)
        for (const id2 of ['matrix_series', 'spatial', 'quant'] as SegmentId[]) {
          const planned = parts.find((p) => p.id === id2)!.s
          if (shown[id2] !== undefined) expect(shown[id2], `${skip} → ${id2}`).toBeLessThanOrEqual(Math.max(1, Math.round(planned / 60)))
        }
        for (const b of bot.run.result().budgets) expect(b.budgetS).toBeLessThanOrEqual(b.plannedS + 1e-9)
        expect(bot.run.result().itemsByAxis.QR ?? 0, `QR floor after skipping ${skip}`).toBeGreaterThanOrEqual(3)
        total[skip] = (total[skip] ?? 0) + bot.run.sessionState().durationS
        if (!(bot.run.sessionState().durationS < plain.sessionState().durationS)) longer.push(`${id} skipping ${skip}`)
      }
    }
    expect(longer.length, longer.join(', ')).toBeLessThanOrEqual(2)
    for (const skip of ['RT', 'MAT', 'SPA'] as AxisCode[]) expect(total[skip]!, `skipping ${skip} shortens the session on average`).toBeLessThan(plainTotal - 8 * 60)
  }, 120_000)

  it('the coverage floor holds for any skip pattern: every power skill not skipped whose part ran gets 3 items', () => {
    fc.assert(
      fc.property(scenario, ({ seed, skipped, acts }) => {
        const sessionId = `s_PROPFLOOR${String(seed).padStart(6, '0')}`
        const bot = new Bot({ sessionId, skipped: skipped.filter((k) => k !== 'QR') }, { blockScale: 1 + (seed % 7) / 3 })
        let step = 0
        bot.until((v) => {
          const act = acts[step++ % acts.length]!
          if (act === 'skip_other' && v.phase === 'interstitial') {
            const later = v.segments.slice(v.segmentIndex + 1).find((s) => s.status === 'upcoming' && !s.axes.includes('QR'))
            const k = later?.axes.find((a) => !v.skipped.includes(a))
            if (k !== undefined) bot.run.skipAxis(k)
          }
          return v.phase === 'finished'
        })
        const r = bot.run.result()
        if (r.reason === 'complete') for (const k of CAT) if (!r.skipped.includes(k)) expect(r.itemsByAxis[k] ?? 0, k).toBeGreaterThanOrEqual(3)
      }),
      { numRuns: 25 },
    )
  }, 120_000)
})

describe('items: time-out, unavailable, confidence (§13, DESIGN §3 row 12)', () => {
  it('an item with no answer by its cap is recorded as not correct and the next one comes', () => {
    const bot = new Bot({ sessionId: 's_ITEMTIMEOUT001', skipped: ['RT', 'WM', 'PS'] })
    const v = bot.until((x) => x.phase === 'item')
    const cap = v.item!.time_limit_s
    expect(cap).toBeGreaterThanOrEqual(180)
    bot.run.itemShown(bot.t)
    bot.wait(cap - 1)
    bot.run.tick()
    expect(bot.view().phase).toBe('item')
    bot.wait(2)
    bot.run.tick()
    const st = bot.run.sessionState()
    const last = st.responses.at(-1)!
    expect(last[0]).toBe(v.item!.item_id)
    expect(last.slice(1, 6)).toEqual([0, null, 0, cap * 1000, null])
    expect(bot.view().notice).toEqual({ kind: 'timeout', seq: expect.any(Number) }) // no 'served' mark: here a time-out counts as not answered correctly
    expect(bot.view().item?.item_id).not.toBe(v.item!.item_id)
    expect(bot.run.result().observations.length).toBe(1)
  })

  /** A response the question on screen takes (its key: right), and one it takes that is wrong where there is one. */
  function responsesOf(bot: Bot): { right: unknown; wrong: unknown | null } {
    const full = bot.fullItem(bot.view().item!.item_id)
    const key = full.key as { index?: number; value?: string; letter?: string }
    if (key.index !== undefined) return { right: key.index, wrong: (key.index + 1) % full.options_count! }
    return { right: key.value ?? key.letter, wrong: null }
  }

  it('at the time-out, the answer chosen or typed is sent as it stands: scored, at the limit, with the confidence set, marked (owner decision 2026-10-13)', () => {
    const bot = new Bot({ sessionId: 's_TIMEOUTSEND001', skipped: ['RT', 'WM', 'PS'] })
    const v = bot.until((x) => x.phase === 'item')
    const cap = v.item!.time_limit_s
    const { right } = responsesOf(bot)
    bot.run.itemShown(bot.t)
    bot.run.itemDraft('nonsense that no family reads') // not an answer: nothing kept
    bot.run.itemDraft(right)
    const pct = midConfidence(v)
    bot.run.itemConfidence(pct)
    bot.wait(cap + 1)
    bot.run.tick()
    const last = bot.run.sessionState().responses.at(-1)!
    expect(last).toEqual([v.item!.item_id, 0, right, 1, cap * 1000, pct, { submitted_at_timeout: true }])
    expect(bot.view().notice).toEqual({ kind: 'timeout', submitted: true, seq: expect.any(Number) })
    // a rated answer (one, below the minimum: no Calibration observation from it)
    expect(bot.run.result().calibration?.n).toBe(1)
    expect(bot.run.result().observations.some((o) => o.axis === 'CAL')).toBe(false)
    // it re-scores from the save as any answer
    const st = bot.run.sessionState()
    const save = saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 3_600_000, anonId: newAnonId() })
    expect(rescoreSessions(save).n_scored).toBe(bot.run.result().observations.length)
  })

  it('at the time-out, nothing chosen or typed (or a choice or text taken back) sends nothing, as before', () => {
    for (const takeBack of [false, true]) {
      const bot = new Bot({ sessionId: takeBack ? 's_TIMEOUTSEND003' : 's_TIMEOUTSEND002', skipped: ['RT', 'WM', 'PS'] })
      const v = bot.until((x) => x.phase === 'item')
      bot.run.itemShown(bot.t)
      if (takeBack) {
        bot.run.itemDraft(responsesOf(bot).right)
        bot.run.itemConfidence(100)
        bot.run.itemDraft(null)
      }
      bot.wait(v.item!.time_limit_s + 1)
      bot.run.tick()
      const last = bot.run.sessionState().responses.at(-1)!
      expect(last).toEqual([v.item!.item_id, 0, null, 0, v.item!.time_limit_s * 1000, null])
      expect(bot.view().notice).toEqual({ kind: 'timeout', seq: expect.any(Number) })
    }
  })

  it('a draft never outlives its question: the next question starts with none, and an answer sent by its button is not marked', () => {
    const bot = new Bot({ sessionId: 's_TIMEOUTSEND004', skipped: ['RT', 'WM', 'PS'] })
    bot.until((x) => x.phase === 'item')
    bot.run.itemDraft(responsesOf(bot).right)
    bot.answer(null)
    expect(bot.run.sessionState().responses.at(-1)!.length).toBe(6)
    const v = bot.until((x) => x.phase === 'item')
    bot.run.itemShown(bot.t)
    bot.wait(v.item!.time_limit_s + 1)
    bot.run.tick()
    expect(bot.run.sessionState().responses.at(-1)![2]).toBeNull()
  })

  it('property: a time-out sends exactly the last answer drafted (a wrong one is scored wrong), or nothing when the last draft is none', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<'right' | 'wrong' | 'none' | 'junk'>('right', 'wrong', 'none', 'junk'), { minLength: 1, maxLength: 6 }), (drafts) => {
        const bot = new Bot({ sessionId: 's_TIMEOUTPROP001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
        const v = bot.until((x) => x.phase === 'item')
        const r = responsesOf(bot)
        let kept: unknown = null
        bot.run.itemShown(bot.t)
        for (const d of drafts) {
          const value = d === 'right' ? r.right : d === 'wrong' ? r.wrong : d === 'junk' ? { nope: 1 } : null
          bot.run.itemDraft(value)
          kept = d === 'junk' || value === null ? null : value
        }
        bot.wait(v.item!.time_limit_s + 1)
        bot.run.tick()
        const last = bot.run.sessionState().responses.at(-1)!
        expect(last[2]).toEqual(kept)
        if (kept === null) expect(last.length).toBe(6)
        else {
          expect(last[3]).toBe(kept === r.right ? 1 : 0)
          expect(last[6]).toEqual({ submitted_at_timeout: true })
        }
      }),
      { numRuns: 40 },
    )
  })

  it('an item the renderer cannot draw is not counted, never times out, and offers the skip', () => {
    const bot = new Bot({ sessionId: 's_ITEMUNAVAIL001', skipped: ['RT', 'MAT', 'WM', 'PS', 'QR'] })
    const v = bot.until((x) => x.phase === 'item')
    expect(v.item?.axis).toBe('SPA')
    bot.run.itemUnavailable()
    expect(bot.view().unavailable).toBe(true)
    expect(bot.view().notice).toMatchObject({ kind: 'unavailable', axis: 'SPA' })
    bot.run.itemResponded(0) // locked options cannot answer; if one arrives it is ignored
    expect(bot.view().phase).toBe('item')
    bot.wait(600) // far beyond the item cap
    bot.run.tick()
    expect(bot.view().phase).toBe('item')
    expect(bot.run.sessionState().responses).toEqual([])
    bot.run.skipAxis()
    expect(bot.view().phase).toBe('finished')
  })

  it('the question screen carries the scale: its floor is 1/k for multiple choice and 0 for entry, and no step follows the answer', () => {
    const bot = new Bot({ sessionId: 's_CONFVALID00001', skipped: ['RT', 'WM', 'PS', 'QR', 'SPA'] })
    const floors = new Set<number>()
    for (let n = 0; n < 12; n++) {
      const v = bot.until((x) => x.phase === 'item')
      const c = v.confidence!
      const k = c.optionsCount
      expect(c.floorPct).toBe(k === null ? 0 : Math.ceil(100 / k))
      expect(c.optionsCount).toBe(v.item!.options_count ?? null)
      floors.add(c.floorPct)
      const before = bot.run.sessionState().responses.length
      bot.answer(c.floorPct)
      // One press: the answer is recorded at once, with its confidence, and the run is past the question.
      expect(bot.run.sessionState().responses.length).toBe(before + 1)
      expect(bot.run.sessionState().responses.at(-1)![5]).toBe(c.floorPct)
      expect(bot.view().item?.item_id).not.toBe(v.item!.item_id)
    }
    // Matrices (6 options) and series (entry) both occur in the MAT segment.
    expect(floors.has(0) || floors.has(17)).toBe(true)
  })

  it('a confidence outside the scale (below the floor, over 100, not whole) is recorded as none; the answer still counts', () => {
    for (const bad of [-3, 101, 55.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bot = new Bot({ sessionId: 's_CONFVALID00002', skipped: ['RT', 'WM', 'PS', 'QR', 'SPA'] })
      bot.until((x) => x.phase === 'item')
      bot.answer(bad)
      const last = bot.run.sessionState().responses.at(-1)!
      expect(last[5], String(bad)).toBeNull()
      expect(last[3]).not.toBeNull()
    }
    const bot = new Bot({ sessionId: 's_CONFVALID00003', skipped: ['RT', 'WM', 'PS', 'QR', 'SPA'] })
    const v = bot.until((x) => x.phase === 'item' && x.confidence!.floorPct > 0)
    bot.answer(v.confidence!.floorPct - 1)
    expect(bot.run.sessionState().responses.at(-1)![5]).toBeNull()
  })

  it('no scale outside a question: blocks, interstitials and the finished screen have none', () => {
    const bot = new Bot({ sessionId: 's_CONFVALID00004' })
    for (let i = 0; i < 3000; i++) {
      const v = bot.view()
      if (v.phase !== 'item') expect(v.confidence, v.phase).toBeNull()
      else expect(v.confidence).not.toBeNull()
      if (v.phase === 'finished') break
      bot.run.tick()
      bot.step()
    }
  })

  it('a session with at least 10 rated answers carries a calibration observation x = −Brier', () => {
    const bot = new Bot({ sessionId: 's_CALIBRATION001', skipped: ['RT', 'WM', 'PS'] }, { confidence: 'max' })
    bot.finish()
    const r = bot.run.result()
    expect(r.calibration!.n).toBeGreaterThanOrEqual(CAL_NORMS.min_responses)
    const cal = r.observations.find((o) => o.axis === 'CAL')
    expect(cal).toBeDefined()
    if (cal?.kind !== 'gaussian') throw new Error('CAL is a Gaussian observation')
    expect(cal.x).toBeCloseTo(-r.calibration!.brier, 12)
    // A 100% answer that is right scores 0; wrong scores 1.
    const rated = bot.run.sessionState().responses.filter((t) => t[5] !== null)
    const wrong = rated.filter((t) => t[3] === 0).length
    expect(r.calibration!.brier).toBeCloseTo(wrong / rated.length, 12)
  })

  it('an answer given with the scale unset is recorded without a confidence (null), left out of the calibration, and flags nothing (owner decision 2026-10-13)', () => {
    const bot = new Bot({ sessionId: 's_UNTOUCHED00001', skipped: ['RT', 'WM', 'PS'] }, { rate: 'random', confidence: 'max' })
    bot.finish()
    const st = bot.run.sessionState()
    const items = st.responses.filter((t) => t[0].startsWith('i:') && t[3] !== null)
    const unrated = items.filter((t) => t[5] === null)
    const rated = items.filter((t) => t[5] !== null)
    expect(unrated.length).toBeGreaterThan(2)
    expect(rated.length).toBeGreaterThan(2)
    // Leaving the scale unset is normal now: no flag counts it.
    expect(st.flags.confidence_untouched_n).toBeUndefined()
    // A rating keeps its value; the unrated answers are not in the calibration at all.
    for (const t of rated) expect(t[5]).toBe(100)
    const r = bot.run.result()
    expect(r.calibration!.n).toBe(rated.length)
    expect(r.calibration!.mean_confidence).toBe(1)
    // The save re-scores to the same calibration: the stored null is "no rating" there too.
    const save = saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 3_600_000, anonId: newAnonId() })
    const re = rescoreSessions(save)
    expect(re.n_scored).toBe(r.observations.length)
    expect(re.theta[AXIS_INDEX.CAL]).toBeCloseTo(r.score!.theta[AXIS_INDEX.CAL]!, 9)
  })

  it('every answer rated: calibration over all of them; none rated: no calibration at all, and no flag either way', () => {
    const rated = new Bot({ sessionId: 's_UNTOUCHED00002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    rated.finish()
    expect(rated.run.sessionState().flags.confidence_untouched_n).toBeUndefined()
    expect(rated.run.result().calibration!.n).toBe(rated.run.sessionState().responses.filter((t) => t[2] !== null).length)
    const never = new Bot({ sessionId: 's_UNTOUCHED00003', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] }, { rate: 'never' })
    never.finish()
    const st = never.run.sessionState()
    expect(st.responses.every((t) => t[5] === null)).toBe(true)
    expect(st.flags.confidence_untouched_n).toBeUndefined()
    expect(never.run.result().calibration).toBeNull()
    expect(never.run.result().observations.some((o) => o.axis === 'CAL')).toBe(false)
  })

  it('property: unset gives null, set gives the value, whatever the order; calibration counts the set ones only', () => {
    fc.assert(
      fc.property(fc.array(fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }), { minLength: 1, maxLength: 12 }), (ratings) => {
        const bot = new Bot({ sessionId: 's_UNTOUCHPROP001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'], stopSd: 0.01 })
        const given: (number | null)[] = []
        for (const raw of ratings) {
          const v = bot.until((x) => x.phase === 'item' || x.phase === 'finished')
          if (v.phase === 'finished') break
          const pct = raw === null ? null : Math.max(v.confidence!.floorPct, raw)
          bot.answer(pct)
          given.push(pct)
        }
        const st = bot.run.sessionState()
        expect(st.responses.map((t) => t[5])).toEqual(given)
        expect(st.flags.confidence_untouched_n).toBeUndefined()
        const n = given.filter((g) => g !== null).length
        expect(bot.run.result().calibration?.n ?? 0).toBe(n)
        expect(bot.run.result().observations.some((o) => o.axis === 'CAL')).toBe(n >= CAL_NORMS.min_responses)
      }),
      { numRuns: 30 },
    )
  })

  it('below 10 rated answers there is no calibration observation', () => {
    const bot = new Bot({ sessionId: 's_CALIBRATION002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'], stopSd: 0.95 })
    bot.finish()
    const r = bot.run.result()
    expect(r.calibration!.n).toBeLessThan(CAL_NORMS.min_responses)
    expect(r.observations.some((o) => o.axis === 'CAL')).toBe(false)
  })

  it('a malformed response is ignored with a notice, not scored', () => {
    const bot = new Bot({ sessionId: 's_ITEMMALFORMED1', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'item')
    bot.run.itemResponded({ not: 'a response' })
    expect(bot.view().phase).toBe('item')
    expect(bot.view().notice?.kind).toBe('malformed')
  })
})

describe('blocks and RT input (A18)', () => {
  it('records the RT renderer input type in the tuple and the device, and scores the same observation as score()', () => {
    const bot = new Bot({ sessionId: 's_BLOCKRTINPUT01', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    bot.step() // interstitial
    const v = bot.view()
    const blk = v.block!
    const item = bot.fullItem(blk.item_id)
    bot.run.blockInputType('touch')
    // A plain valid response: 30 simple trials at 250 ms.
    const spec = item.spec as { positions: number[]; practice_positions: number[] }
    const response = {
      rt_ms: spec.positions.map(() => 250),
      choice: spec.positions.map(() => 0),
      practice_rt_ms: spec.practice_positions.map(() => 300),
      practice_choice: spec.practice_positions.map(() => 0),
    }
    bot.wait(90)
    bot.run.blockResponded(response)
    const st = bot.run.sessionState()
    const t = st.responses[0]!
    expect(t[3]).toBeNull()
    expect(t[4]).toBe(90_000)
    expect(t[6]).toMatchObject({ input_type: 'touch', device_class: 'desktop', refresh_hz_est: 60 })
    // What is stored is the scorer's own record of the block, made from the RtDevice the session passed it (A18).
    expect(t[6]).toMatchObject({ mode: 'simple', norms_version: RT_NORMS_VERSION, n_valid: 30, n_anticipations: 0 })
    expect(st.device.input).toBe('touch')
    const obs = bot.run.result().observations
    expect(obs).toHaveLength(1)
    expect(obs[0]).toMatchObject({ kind: 'gaussian', axis: 'RT' })
  })

  it.each([
    ['touch', 470],
    ['mouse', 300],
    ['keyboard', 300],
    [undefined, 300],
  ] as const)('a block given by %s at its own reference median is 0 SD, and the save re-scores to the very same observation (like with like, D3)', (input, median) => {
    const bot = new Bot({ sessionId: 's_BLOCKRTREFERENCE', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    bot.step()
    const item = bot.fullItem(bot.view().block!.item_id)
    const spec = item.spec as { positions: number[]; practice_positions: number[] }
    if (input !== undefined) bot.run.blockInputType(input)
    const n = spec.positions.length
    bot.run.blockResponded({
      // Half the trials faster, half slower than the median, so its median log-RT is exactly ln(median).
      rt_ms: spec.positions.map((_, i) => median * Math.exp(0.012 * (i < n / 2 ? -(n / 2 - i) : i - n / 2 + 1))),
      choice: spec.positions.map(() => 0),
      practice_rt_ms: spec.practice_positions.map(() => 300),
      practice_choice: spec.practice_positions.map(() => 0),
    })
    const obs = bot.run.result().observations
    expect(obs).toHaveLength(1)
    const o = obs[0]!
    if (o.kind !== 'gaussian') throw new Error('expected a Gaussian observation')
    expect(Math.abs((o.x - o.d) / o.lam)).toBeLessThan(1e-9)
    expect(o.d).toBe(Math.log(median))
    // The save keeps the raw block and the input type, and a re-score from it (what the reveal draws)
    // builds the observation the session did: no path norms a block against the other kind of input.
    const tuple = bot.run.sessionState().responses[0]!
    const re = registryObservation(tuple)
    expect('observation' in re && re.observation).toEqual(o)
  })

  it('without an input type from the renderer, none is recorded (the RtDevice carries none)', () => {
    const bot = new Bot({ sessionId: 's_BLOCKRTNOINP01', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    bot.step()
    const item = bot.fullItem(bot.view().block!.item_id)
    const spec = item.spec as { positions: number[]; practice_positions: number[] }
    bot.run.blockResponded({
      rt_ms: spec.positions.map(() => 250),
      choice: spec.positions.map(() => 0),
      practice_rt_ms: spec.practice_positions.map(() => 300),
      practice_choice: spec.practice_positions.map(() => 0),
    })
    const extra = bot.run.sessionState().responses[0]![6] as Record<string, unknown>
    expect(extra).toMatchObject({ device_class: 'desktop', norms_version: RT_NORMS_VERSION })
    expect(extra).not.toHaveProperty('input_type')
  })

  it('an RT block with too few valid trials yields no observation, only the reason', () => {
    const bot = new Bot({ sessionId: 's_BLOCKRTFEW0001', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    bot.step()
    const item = bot.fullItem(bot.view().block!.item_id)
    const spec = item.spec as { positions: number[]; practice_positions: number[] }
    bot.run.blockResponded({
      rt_ms: spec.positions.map(() => null),
      choice: spec.positions.map(() => null),
      practice_rt_ms: spec.practice_positions.map(() => null),
      practice_choice: spec.practice_positions.map(() => null),
    })
    expect(bot.run.result().observations).toHaveLength(0)
    expect(bot.run.result().blocks[0]).toMatchObject({ observed: false, reasons: ['too_few_valid_trials'] })
    expect(bot.run.sessionState().responses[0]![6]).toMatchObject({ reasons: ['too_few_valid_trials'] })
  })

  it('a malformed block response is recorded without an observation', () => {
    const bot = new Bot({ sessionId: 's_BLOCKMALFORM01', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    bot.step()
    bot.run.blockResponded({ rt_ms: [1, 2, 3] })
    expect(bot.run.result().blocks[0]).toMatchObject({ observed: false, reasons: ['malformed_response'] })
  })
})

describe('the record the save library takes (§8, M1.17, M1.Q)', () => {
  it('a finished session is a valid save whose re-score matches the session’s own', () => {
    const bot = new Bot({ sessionId: 's_SAVEROUNDTRIP1' }, { theta: theta({ MAT: 0.8, QR: -0.4, WM: 0.5 }), confidence: 'mid' })
    bot.finish()
    const st = bot.run.sessionState()
    const save = saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 3_600_000, anonId: newAnonId() })
    expect(save.sessions).toHaveLength(1)
    expect(save.seen_items.length).toBe(st.responses.length)
    const re = rescoreSessions(save)
    const own = bot.run.result()
    // The session's calibration observation is rebuilt from the stored confidences: the save re-scores to every observation shown.
    expect(own.observations.some((o) => o.axis === 'CAL')).toBe(true)
    expect(re.n_scored).toBe(own.observations.length)
    expect(re.skipped).toEqual([])
    // Session 1 has no practice gain (ρ_k(1) = 0), so the re-score is the session's own MAP, axis by axis.
    expect(own.score).not.toBeNull()
    for (let i = 0; i < N_AXES; i++) expect(re.theta[i], String(i)).toBeCloseTo(own.score!.theta[i]!, 9)
  })

  it('time-outs are stored as not correct and re-score as such', () => {
    const bot = new Bot({ sessionId: 's_SAVETIMEOUT001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'item')
    bot.run.itemShown(bot.t)
    bot.wait(200)
    bot.run.tick()
    bot.run.finishEarly()
    const st = bot.run.sessionState()
    const save = saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 1000, anonId: newAnonId() })
    const re = rescoreSessions(save)
    expect(re.n_scored).toBe(1)
    expect(re.skipped).toEqual([])
  })

  it('seen items and families are this session’s; a second session drawn with them repeats no family', () => {
    const a = new Bot({ sessionId: 's_SEENFIRST00001' })
    a.finish()
    const seen = a.run.sessionState().seenFamilies
    const b = new Bot({ sessionId: 's_SEENSECOND0001', priorItemCounts: priorFrom(a), seenFamilies: seen })
    b.finish()
    const ids = new Set(seen)
    for (const r of b.run.sessionState().responses) {
      const fam = parseItemId(r[0])!.family
      if (fam === 'rt_simple' || fam === 'rt_choice4') continue // RT is one family by design and measured every session
      const item = b.fullItem(r[0])
      expect(ids.has(item.family_id), r[0]).toBe(false)
    }
  })

  it('the session state carries the device, an id and the active duration', () => {
    const bot = new Bot({ sessionId: 's_SAVESTATE00001' })
    bot.wait(20) // the first "Up next" screen is not session time
    bot.run.startSegment()
    bot.wait(75.4)
    const st = bot.run.sessionState()
    expect(st.sessionId).toBe('s_SAVESTATE00001')
    expect(st.device).toEqual(TEST_DEVICE)
    expect(st.durationS).toBeCloseTo(75.4, 6)
  })
})

describe('integrity logs (M1.19)', () => {
  it('pastes and a long hidden spell during an item set the session flags', () => {
    const bot = new Bot({ sessionId: 's_INTEGRITY00001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'item')
    const id = bot.view().item!.item_id
    bot.run.itemShown(bot.t)
    bot.run.notePaste(id)
    bot.run.noteVisibility('hidden')
    bot.wait(30)
    bot.run.noteVisibility('visible')
    bot.run.itemResponded(0, midConfidence(bot.view()))
    const flags = bot.run.sessionState().flags
    expect(flags.paste_events).toBe(1)
    expect(flags.visibility_hidden_s).toBeGreaterThanOrEqual(29)
    expect(flags.flag_count).toBe(2)
    expect(flags.calibration_eligible).toBe(false)
  })
})

describe('config', () => {
  it('a run notifies its listeners and onChange with the kind of change, not while it is being built', () => {
    const kinds: string[] = []
    const bot = new Bot({ sessionId: 's_CHANGES0000001', onChange: (k) => kinds.push(k), skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    expect(kinds).toEqual([])
    bot.until((v) => v.phase === 'item')
    expect(kinds).toContain('phase')
    bot.answer(midConfidence(bot.view()))
    expect(kinds).toContain('response')
    bot.run.skipAxis('MAT')
    bot.run.finishEarly()
    expect(kinds).toEqual(expect.arrayContaining(['skip', 'finish']))
    expect(kinds.at(-1)).toBe('finish')
  })

  it('SessionRun is constructible with only the required fields', () => {
    const run = new SessionRun({ sessionId: 's_MINIMALCONFIG01', startedMs: 0, now: () => 0, device: TEST_DEVICE, rtInput: 'touch' })
    expect(run.view().rtInput).toBe('touch')
    expect(run.view().phase).toBe('interstitial')
  })
})

describe('focus session (DESIGN §10 "focus sessions of 20 minutes"; ROADMAP M1.R)', () => {
  it('plans only the parts that hold the chosen skills, in A15 order, and skips nothing', () => {
    const bot = new Bot({ sessionId: 's_FOCUS000000001', focus: ['QR', 'SPA'], targetS: 20 * 60 })
    const v = bot.view()
    expect(v.segments.map((s) => s.id)).toEqual(['spatial', 'quant'])
    expect(v.targetS).toBe(1200)
    expect(v.skipped).toEqual([])
    bot.finish()
    const r = bot.run.result()
    expect(r.skipped).toEqual([])
    const flags = bot.run.sessionState().flags
    expect(Object.keys(flags).some((k) => k.startsWith('skipped_'))).toBe(false)
    // Only the chosen skills were asked, and no block ran.
    const axes = new Set(bot.run.sessionState().responses.map((t) => parseItemId(t[0])!.family))
    expect([...axes].every((f) => ['rotation', 'figure2d', 'cubenet', 'folding', 'quant', 'qdata'].includes(f))).toBe(true)
    expect(r.blocks).toHaveLength(0)
  })

  it('a focus on a block part runs its blocks, and on reaction time alone runs only the two RT blocks', () => {
    const bot = new Bot({ sessionId: 's_FOCUS000000002', focus: ['RT', 'WM'], targetS: 1200 })
    expect(bot.view().segments.map((s) => s.id)).toEqual(['rt', 'memory'])
    bot.finish()
    expect(bot.run.result().blocks.map((b) => b.family)).toEqual(['rt_simple', 'rt_choice4', 'span_fwd', 'span_bwd', 'corsi'])
    expect(bot.run.result().itemsByAxis).toEqual({})
  })

  it('a focus session ends by itself after about 20 minutes for a typical taker (the CAT parts share the time)', () => {
    const bot = new Bot({ sessionId: 's_FOCUS000000003', focus: ['MAT', 'SPA', 'QR'], targetS: 1200 })
    bot.finish()
    expect(bot.run.result().durationS).toBeLessThan(1200 + 120)
    expect(bot.run.result().durationS).toBeGreaterThan(300)
  })

  it('composes with skipping: a skill the person skips inside a focus session is skipped, one outside it is not', () => {
    const bot = new Bot({ sessionId: 's_FOCUS000000004', focus: ['MAT', 'QR'], skipped: ['QR'] })
    expect(bot.view().segments.map((s) => s.id)).toEqual(['matrix_series'])
    expect(bot.view().skipped).toEqual(['QR'])
  })

  it('its save re-scores like any session (R-8.1, §7.8): the focus session is a test of the chosen skills only', () => {
    const first = new Bot({ sessionId: 's_FOCUS000000005' })
    first.finish()
    const base = saveWithSession(null, first.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: newAnonId() })
    const second = new Bot({ sessionId: 's_FOCUS000000006', startedMs: 1_790_000_000_000 + 8 * 86_400_000, focus: ['SPA'], targetS: 1200, seenFamilies: base.seen_families })
    second.finish()
    const merged = saveWithSession(base, second.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_200_000 })
    const re = rescoreSessions(merged)
    const s2 = re.sessions.find((s) => s.session_id === 's_FOCUS000000006')!
    // The chosen skill, and Calibration, which every rated answer measures (A15).
    expect(Object.keys(s2.ordinals).sort()).toEqual(['CAL', 'SPA'])
    expect(s2.ordinals.SPA).toBe(2)
    expect(re.next_ordinals.MAT).toBe(2) // MAT was taken once (session 1)
    expect(re.next_ordinals.SPA).toBe(3)
  })
})

describe('a notice lives for the screen it was raised on and the next one (UX-003)', () => {
  it('"skipped" is on the next interstitial and gone from the first question after it', () => {
    const bot = new Bot({ sessionId: 's_NOTICELIFE0001' })
    bot.run.skipAxis() // reaction time, from its interstitial
    expect(bot.view().segment?.id).toBe('matrix_series')
    expect(bot.view().notice).toMatchObject({ kind: 'skipped', axis: 'RT' })
    bot.run.startSegment()
    expect(bot.view().phase).toBe('item')
    expect(bot.view().notice).toBeNull()
  })

  it('"skipped" told in the middle of a part is told on the next part’s interstitial, and not on its first block', () => {
    // Three parts, the break before the last: none between reaction time and Working Memory.
    const bot = new Bot({ sessionId: 's_NOTICELIFE0002', skipped: ['MAT', 'SPA', 'QR'], breakAtS: 1e9 })
    bot.run.startSegment() // reaction time
    expect(bot.view().phase).toBe('block')
    bot.run.skipAxis() // the part on screen: skipped, the next part is Working Memory
    expect(bot.view().phase).toBe('interstitial')
    expect(bot.view().segment?.id).toBe('memory')
    expect(bot.view().notice?.kind).toBe('skipped')
    bot.run.startSegment()
    expect(bot.view().phase).toBe('block')
    expect(bot.view().notice).toBeNull()
  })

  it('a time-out that ends a part is told on the break offer after it, and the break does not stretch it', () => {
    // Two parts, the break between them; Matrix & Series has no floor (covered before) and, in a focus session,
    // no minimum of answers, so the time-out that runs it past its budget ends the part.
    const bot = new Bot({ sessionId: 's_NOTICELIFE0003', focus: ['MAT', 'SPA'], priorItemCounts: { MAT: 3 } })
    bot.run.startSegment()
    const first = bot.view().item!
    bot.wait(Math.max(first.time_limit_s + 1, A15_TARGET_S))
    bot.run.tick()
    // The break is offered at the end of the part: it is the screen the notice is told on ...
    expect(bot.view().phase).toBe('break_offer')
    expect(bot.view().notice?.kind).toBe('timeout')
    // ... and the "Up next" screen after it is two screens on.
    bot.run.declineBreak()
    expect(bot.view().phase).toBe('interstitial')
    expect(bot.view().segment?.id).toBe('spatial')
    expect(bot.view().notice).toBeNull()
  })

  it('a time-out with no break is told on the next question', () => {
    const bot = new Bot({ sessionId: 's_NOTICELIFE0004', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.run.startSegment()
    bot.wait(bot.view().item!.time_limit_s + 1)
    bot.run.tick()
    expect(bot.view().phase).toBe('item')
    expect(bot.view().notice?.kind).toBe('timeout')
  })

  it('a new notice replaces the old one and starts its own life', () => {
    const bot = new Bot({ sessionId: 's_NOTICELIFE0005' })
    bot.run.skipAxis() // reaction time
    const first = bot.view().notice!
    bot.run.skipAxis() // Matrix & Series, from its interstitial
    const second = bot.view().notice!
    expect(second.seq).toBeGreaterThan(first.seq)
    expect(second).toMatchObject({ kind: 'skipped', axis: 'MAT' })
    expect(bot.view().segment?.id).toBe('spatial')
    bot.run.startSegment()
    expect(bot.view().notice).toBeNull()
  })

  it('a notice about the question on screen (cannot be drawn, cannot be read) is there while the question is', () => {
    const bot = new Bot({ sessionId: 's_NOTICELIFE0006', skipped: ['RT', 'MAT', 'WM', 'PS', 'QR'] })
    bot.run.startSegment()
    bot.run.itemUnavailable()
    expect(bot.view().notice?.kind).toBe('unavailable')
    bot.wait(1)
    bot.run.tick()
    expect(bot.view().notice?.kind).toBe('unavailable')
  })

  it('property: whatever is skipped or timed out, a notice is never seen on more than two screens in a row', () => {
    /** The screen the person is looking at: a new key is a new screen. */
    const screenKey = (v: ReturnType<Bot['view']>): string | null => {
      switch (v.phase) {
        case 'interstitial':
          return `i:${v.segmentIndex}`
        case 'block':
          return `b:${v.block?.item_id ?? ''}`
        case 'item':
          return `q:${v.item?.item_id ?? ''}`
        case 'break_offer':
        case 'on_break':
          return v.phase
        default:
          return null
      }
    }
    let noticesSeen = 0
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('none', 'none', 'none', 'skip', 'timeout'), { minLength: 30, maxLength: 90 }),
        fc.boolean(),
        (actions, early) => {
          const bot = new Bot({ sessionId: 's_NOTICEPROP0001', ...(early ? { breakAtS: 60 } : {}) }, { onBreakOffer: 'take' })
          let screens = -1
          let last: string | null = null
          let step = 0
          const first = new Map<number, number>()
          const lastSeen = new Map<number, number>()
          bot.until((v) => {
            // What happens to the person: a skip now and then, a question left until it times out.
            const action = actions[step++ % actions.length]
            if (action === 'skip' && v.skippable !== null && v.phase !== 'break_offer' && v.phase !== 'on_break') bot.run.skipAxis()
            else if (action === 'timeout' && v.phase === 'item' && v.item !== null) {
              bot.wait(v.item.time_limit_s + 1)
              bot.run.tick()
            }
            const now = bot.view()
            const key = screenKey(now)
            if (key !== null && key !== last) {
              screens++
              last = key
            }
            if (now.notice !== null) {
              if (!first.has(now.notice.seq)) first.set(now.notice.seq, screens)
              lastSeen.set(now.notice.seq, screens)
            }
            return now.phase === 'finished'
          })
          noticesSeen += first.size
          for (const [seq, from] of first) expect(lastSeen.get(seq)! - from, `notice ${seq}`).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 12 },
    )
    expect(noticesSeen, 'the property saw notices at all').toBeGreaterThan(0)
  })
})


describe('a continuation of an interrupted session (UX-064; provisional default, D6 option B)', () => {
  it('shows the parts finished earlier as done, starts at the first part left, and is flagged as a continuation', () => {
    const bot = new Bot({ sessionId: 's_CONTINUE000001', continues: { done: ['rt', 'matrix_series'], skipped: [] } })
    const v = bot.view()
    expect(v.phase).toBe('interstitial')
    expect(v.segment?.id).toBe('spatial')
    expect(v.segments.map((x) => x.status)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'])
    expect(v.skipped).toEqual([])
    expect(bot.run.sessionState().flags[CONTINUATION_FLAG]).toBe(true)
    const seen: SegmentId[] = []
    for (let i = 0; i < 3000; i++) {
      const w = bot.view()
      if (w.phase === 'interstitial' && w.segment !== null && seen.at(-1) !== w.segment.id) seen.push(w.segment.id)
      if (w.phase === 'finished') break
      bot.run.tick()
      bot.step()
    }
    expect(seen).toEqual(['spatial', 'memory', 'quant', 'coding_reading'])
    const end = bot.view()
    expect(end.ended).toBe('complete')
    expect(end.segments.map((x) => x.status)).toEqual(ORDER.map(() => 'done'))
    expect(end.counts.blocks).toBe(5) // span ×3, coding, reading: no reaction-time block
    const st = bot.run.sessionState()
    const families = new Set(st.responses.map(([id]) => parseItemId(id)!.family))
    for (const f of ['rt_simple', 'rt_choice4']) expect(families.has(f)).toBe(false)
    expect(bot.run.result().itemsByAxis.MAT).toBeUndefined()
    // Its own parts are done here; the ones done earlier are the interrupted session's.
    expect(st.flags[doneFlag('rt')]).toBeUndefined()
    expect(st.flags[doneFlag('matrix_series')]).toBeUndefined()
    for (const id of ['spatial', 'memory', 'quant', 'coding_reading'] as const) expect(st.flags[doneFlag(id)]).toBe(true)
    expect(st.flags[COMPLETED_FLAG]).toBe(true)
    expect(st.flags[CONTINUATION_FLAG]).toBe(true)
    expect(bot.run.serverFlags()).not.toHaveProperty(CONTINUATION_FLAG)
  })

  it('a skill skipped earlier stays skipped: on the checklist, in the flags, and never run', () => {
    const bot = new Bot({ sessionId: 's_CONTINUE000002', continues: { done: ['rt'], skipped: ['MAT'] } })
    expect(bot.view().segment?.id).toBe('spatial')
    expect(bot.view().segments.map((x) => x.status)).toEqual(['done', 'skipped', 'current', 'upcoming', 'upcoming', 'upcoming'])
    expect(bot.view().skipped).toEqual(['MAT'])
    bot.finish()
    expect(bot.run.sessionState().flags.skipped_mat).toBe(true)
    expect(bot.run.result().itemsByAxis.MAT).toBeUndefined()
  })

  it('its target is the planned time of the parts it runs, and its parts keep their planned shares', () => {
    const id = 's_CONTINUE000003'
    const parts = plannedParts(id)
    const planned = (ids: readonly SegmentId[]): number => parts.filter((p) => ids.includes(p.id)).reduce((t, p) => t + p.s, 0)
    expect(new Bot({ sessionId: id, continues: { done: [], skipped: [] } }).view().targetS).toBeCloseTo(A15_PLANNED_S, 6)
    const bot = new Bot({ sessionId: id, continues: { done: ['rt', 'matrix_series'], skipped: [] } })
    expect(bot.view().targetS).toBeCloseTo(planned(['spatial', 'memory', 'quant', 'coding_reading']), 6)
    expect(bot.view().targetS).toBeLessThan(A15_PLANNED_S)
    bot.finish()
    for (const b of bot.run.result().budgets) expect(b.budgetS).toBeLessThanOrEqual(b.plannedS + 1e-9)
  })

  it('offers the break only between two of its own parts, never before its first one', () => {
    const late = new Bot({ sessionId: 's_CONTINUE000004', continues: { done: ['rt', 'matrix_series', 'spatial'], skipped: [] } }, { onBreakOffer: 'decline' })
    expect(late.view().breakBefore).toBeNull()
    expect(late.view().segment?.id).toBe('memory')
    late.finish()
    expect(late.phases).not.toContain('break_offer')
    const early = new Bot({ sessionId: 's_CONTINUE000005', continues: { done: ['rt'], skipped: [] } }, { onBreakOffer: 'decline' })
    expect(early.view().breakBefore).toBe('memory')
    early.finish()
    expect(early.phases.filter((p) => p === 'break_offer')).toHaveLength(1)
  })

  it('re-scores with the interrupted session as one sitting: the part run in both is not practice-adjusted', () => {
    const anonId = newAnonId()
    const first = new Bot({ sessionId: 's_CONTINUE000006', startedMs: 1_790_000_000_000 })
    first.until((v) => v.phase === 'item' && v.segment?.id === 'spatial')
    first.step() // one Spatial answer recorded, then the tab is reloaded
    const base = saveWithSession(null, first.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId })
    const u = findUnfinished(base, 1_790_000_200_000)!
    expect(u.next).toBe('spatial')
    const cont = new Bot({ sessionId: 's_CONTINUE000007', startedMs: 1_790_000_300_000, continues: { done: u.done, skipped: u.skipped }, seenFamilies: base.seen_families })
    cont.finish()
    const save = saveWithSession(base, cont.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_400_000, anonId })
    const r = rescoreSessions(save)
    expect(r.sessions.map((x) => x.session_id)).toEqual(['s_CONTINUE000006', 's_CONTINUE000007'])
    expect(r.sessions[1]!.continuation).toBe(true)
    expect(r.sessions[1]!.ordinals.SPA).toBe(1)
    expect(r.sessions[1]!.rho.SPA ?? 0).toBe(0)
    expect(Object.values(r.sessions[1]!.rho).every((x) => x === 0)).toBe(true)
  })
})
