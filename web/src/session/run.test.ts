import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, AXIS_INDEX, N_AXES, type AxisCode } from '../engine/axes'
import { createRng } from '../engine/prng'
import { A15_TARGET_S, STOP_SD, planSession, type SegmentId } from '../engine/selector'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { rescoreSessions } from '../save/rescore'
import { parseItemId } from '../tasks/ids'
import { CAL_NORMS } from '../tasks/priors'
import { RT_NORMS_VERSION } from '../tasks/rt'
import { CONTINUATION_FLAG } from '../save/types'
import { HARD_STOP_S, SAVE_CTX } from './constants'
import { priorItemCounts } from './coverage'
import { COMPLETED_FLAG, doneFlag, findUnfinished } from './resume'
import { SessionRun } from './run'
import { Bot, TEST_DEVICE } from './bot'

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
      if (v.phase === 'block' || v.phase === 'item') expect(['interstitial', 'block', 'item', 'confidence', 'break_offer']).toContain(prev)
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
    expect(bot.view().targetS).toBe(A15_TARGET_S)
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
 * Run to Working Memory's first block and spend `s` seconds on it (the clock runs during a block,
 * not on an "Up next" screen), then on to the Quantitative interstitial: the parts after it have no
 * budget left when `s` is the whole target.
 */
function slowMemoryThenQuant(bot: Bot, s: number): void {
  bot.until((v) => v.phase === 'block' && v.segment?.id === 'memory')
  bot.wait(s)
  bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'quant')
}

describe('coverage floor and the session clock (M1.15 known issue)', () => {
  it('every CAT axis reaches 3 items in session 1 even when the blocks before it ran very long', () => {
    // Memory blocks (and the rest) taking 6× their model time: the time budget of Quant is gone
    // before it starts. The floor still gives it exactly 3 items (before M1.15: 0–2 in some sessions).
    for (let i = 0; i < 12; i++) {
      const bot = new Bot({ sessionId: `s_FLOORLONG${String(i).padStart(5, '0')}` }, { blockScale: { span_fwd: 6, span_bwd: 6, corsi: 6 } })
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

  it('a segment with no budget left gets exactly the floor, not more', () => {
    // A Working Memory block that took the whole target: Quant starts with a budget of 0.
    const bot = new Bot({ sessionId: 's_FLOORZERO00001' })
    slowMemoryThenQuant(bot, A15_TARGET_S) // 27.5 more minutes: the budget of the rest is gone
    bot.run.tick()
    const before = bot.run.result().itemsByAxis.QR ?? 0
    expect(before).toBe(0)
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    expect(bot.run.result().itemsByAxis.QR).toBe(3)
    expect(bot.run.result().segmentEnds.find((e) => e.segment === 'quant')?.reason).toBe('time')
  })

  it('a slow enough session still ends at the hard stop, with the floor best-effort', () => {
    const bot = new Bot({ sessionId: 's_FLOORSLOW00001' }, { blockScale: 10, itemScale: 4 })
    bot.finish()
    const v = bot.run.view()
    expect(v.ended).toBe('hard_stop')
    expect(v.elapsedS).toBeLessThan(HARD_STOP_S + 20 * 60) // the last step may overshoot by one block
  })

  it('an axis that earlier sessions covered (3 items) has no floor: a segment without budget serves nothing', () => {
    const bot = new Bot({ sessionId: 's_FLOORSESS200001', priorItemCounts: { MAT: 3, SPA: 3, QR: 3 } })
    slowMemoryThenQuant(bot, A15_TARGET_S)
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    expect(bot.run.result().itemsByAxis.QR ?? 0).toBe(0)
  })
})

/** The prior counts a later session gets from a session that ended as `bot` left it (the real path: save, then count). */
function priorFrom(bot: Bot): ReturnType<typeof priorItemCounts> {
  const st = bot.run.sessionState()
  return priorItemCounts(saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 1000, anonId: newAnonId() }))
}

describe('the coverage floor follows the axes covered, not the session number (M1.15 review)', () => {
  const LONG_SPANS = { span_fwd: 6, span_bwd: 6, corsi: 6 }

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

  it('earlier items count toward the 3: an axis with 2 before needs only 1 more, and one with 3 needs none', () => {
    const one = new Bot({ sessionId: 's_FLOORSHORT0001', priorItemCounts: { QR: 2 } })
    slowMemoryThenQuant(one, A15_TARGET_S) // the budget of the rest is gone
    one.until((v) => v.phase === 'interstitial' && v.segment?.id === 'coding_reading')
    expect(one.run.result().itemsByAxis.QR).toBe(1)
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

  it('an answer waiting for its confidence is kept, unrated, when its axis is skipped', () => {
    const bot = new Bot({ sessionId: 's_SKIPCONF000001' })
    bot.until((v) => v.phase === 'confidence')
    bot.run.skipAxis()
    const last = bot.run.sessionState().responses.at(-1)!
    expect(last[5]).toBeNull()
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

  it('finish early with an answer waiting for its confidence keeps the answer unrated', () => {
    const bot = new Bot({ sessionId: 's_FINISHCONF0001' })
    bot.until((v) => v.phase === 'confidence')
    bot.run.finishEarly()
    const last = bot.run.sessionState().responses.at(-1)!
    expect(last[5]).toBeNull()
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

  it('an answer given just before the stop is kept, without a confidence', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000003' })
    bot.until((v) => v.phase === 'confidence')
    const n = bot.run.sessionState().responses.length
    bot.wait(HARD_STOP_S)
    bot.run.tick()
    const st = bot.run.sessionState()
    expect(bot.run.view().ended).toBe('hard_stop')
    expect(st.responses.length).toBe(n + 1)
    expect(st.responses.at(-1)![5]).toBeNull()
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
  for (const st of planSession({ sessionSeed: sessionId, weights, targetS: opts.targetS ?? A15_TARGET_S })) {
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
        expect(['confidence', 'block', 'item'], `phase before the offer`).toContain(prev)
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
    for (let i = 0; i < 8; i++) {
      const id = `s_CAPSKIP${String(i).padStart(7, '0')}`
      const plain = new Bot({ sessionId: id }).finish()
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
        expect(bot.run.sessionState().durationS, `skipping ${skip} shortens the session`).toBeLessThan(plain.sessionState().durationS)
      }
    }
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

  it('validates the confidence: an integer from the floor (1/k for multiple choice, 0 for entry) to 100', () => {
    const bot = new Bot({ sessionId: 's_CONFVALID00001', skipped: ['RT', 'WM', 'PS', 'QR', 'SPA'] })
    const floors = new Set<number>()
    for (let n = 0; n < 12; n++) {
      const v = bot.until((x) => x.phase === 'confidence')
      const c = v.confidence!
      const k = c.optionsCount
      expect(c.floorPct).toBe(k === null ? 0 : Math.ceil(100 / k))
      floors.add(c.floorPct)
      expect(c.startPct).toBeGreaterThanOrEqual(c.floorPct)
      expect(c.startPct).toBeLessThanOrEqual(100)
      for (const bad of [c.floorPct - 1, 101, 55.5, Number.NaN, -3]) {
        bot.run.confirmConfidence(bad)
        expect(bot.view().phase, `confidence ${bad}`).toBe('confidence')
      }
      bot.run.confirmConfidence(c.floorPct)
      expect(bot.run.sessionState().responses.at(-1)![5]).toBe(c.floorPct)
    }
    // Matrices (6 options) and series (entry) both occur in the MAT segment.
    expect(floors.has(0) || floors.has(17)).toBe(true)
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

  it('an untouched slider is recorded as not rated: null in the tuple, counted in confidence_untouched_n, and left out of the calibration (UX-063)', () => {
    const bot = new Bot({ sessionId: 's_UNTOUCHED00001', skipped: ['RT', 'WM', 'PS'] }, { touch: 'random', confidence: 'max' })
    bot.finish()
    const st = bot.run.sessionState()
    const items = st.responses.filter((t) => t[0].startsWith('i:') && t[3] !== null)
    const unrated = items.filter((t) => t[5] === null)
    const rated = items.filter((t) => t[5] !== null)
    expect(unrated.length).toBeGreaterThan(2)
    expect(rated.length).toBeGreaterThan(2)
    expect(st.flags.confidence_untouched_n).toBe(unrated.length)
    // A touched rating keeps its value; the untouched ones are not in the calibration at all.
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

  it('no untouched rating, no flag; every rating untouched, no calibration at all', () => {
    const touched = new Bot({ sessionId: 's_UNTOUCHED00002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    touched.finish()
    expect(touched.run.sessionState().flags.confidence_untouched_n).toBeUndefined()
    expect(touched.run.result().calibration!.n).toBeGreaterThan(0)
    const never = new Bot({ sessionId: 's_UNTOUCHED00003', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] }, { touch: 'never' })
    never.finish()
    const st = never.run.sessionState()
    expect(st.responses.every((t) => t[5] === null)).toBe(true)
    expect(st.flags.confidence_untouched_n).toBe(st.responses.length)
    expect(never.run.result().calibration).toBeNull()
    expect(never.run.result().observations.some((o) => o.axis === 'CAL')).toBe(false)
  })

  it('property: untouched gives null and one count, touched gives the value, whatever the order', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 100 })), { minLength: 1, maxLength: 12 }), (ratings) => {
        const bot = new Bot({ sessionId: 's_UNTOUCHPROP001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'], stopSd: 0.01 })
        const given: (number | null)[] = []
        for (const [touched, raw] of ratings) {
          const v = bot.until((x) => x.phase === 'confidence' || x.phase === 'finished')
          if (v.phase === 'finished') break
          const floor = v.confidence!.floorPct
          const pct = Math.max(floor, raw)
          bot.run.confirmConfidence(pct, touched)
          given.push(touched ? pct : null)
        }
        const st = bot.run.sessionState()
        expect(st.responses.map((t) => t[5])).toEqual(given)
        const n = given.filter((g) => g === null).length
        expect(st.flags.confidence_untouched_n).toBe(n === 0 ? undefined : n)
        expect(bot.run.result().calibration?.n ?? 0).toBe(given.length - n)
      }),
      { numRuns: 30 },
    )
  })

  it('an invalid percentage is refused whether or not the slider was touched', () => {
    const bot = new Bot({ sessionId: 's_UNTOUCHED00004', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((x) => x.phase === 'confidence')
    bot.run.confirmConfidence(101, false)
    bot.run.confirmConfidence(-1, false)
    expect(bot.view().phase).toBe('confidence')
    expect(bot.run.sessionState().flags.confidence_untouched_n).toBeUndefined()
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
    bot.run.itemResponded(0)
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
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
    bot.until((v) => v.phase === 'confidence')
    expect(kinds).toContain('phase')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
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
    expect([...axes].every((f) => f === 'rotation' || f === 'quant')).toBe(true)
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
    // Two parts, the break between them; Matrix & Series has no floor (covered before), so the time-out
    // that runs it past its budget ends the part.
    const bot = new Bot({ sessionId: 's_NOTICELIFE0003', skipped: ['RT', 'WM', 'PS', 'QR'], priorItemCounts: { MAT: 3 } })
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
    /** The screen the person is looking at: a new key is a new screen (the confidence slider belongs to its question). */
    const screenKey = (v: ReturnType<Bot['view']>): string | null => {
      switch (v.phase) {
        case 'interstitial':
          return `i:${v.segmentIndex}`
        case 'block':
          return `b:${v.block?.item_id ?? ''}`
        case 'item':
        case 'confidence':
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
    expect(new Bot({ sessionId: id, continues: { done: [], skipped: [] } }).view().targetS).toBeCloseTo(A15_TARGET_S, 6)
    const bot = new Bot({ sessionId: id, continues: { done: ['rt', 'matrix_series'], skipped: [] } })
    expect(bot.view().targetS).toBeCloseTo(planned(['spatial', 'memory', 'quant', 'coding_reading']), 6)
    expect(bot.view().targetS).toBeLessThan(A15_TARGET_S)
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
    first.until((v) => v.phase === 'confidence' && v.segment?.id === 'spatial')
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
