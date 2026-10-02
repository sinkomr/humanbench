import { describe, expect, it } from 'vitest'
import { AXIS_INDEX, N_AXES, type AxisCode } from '../engine/axes'
import { createRng } from '../engine/prng'
import { A15_TARGET_S, STOP_SD, type SegmentId } from '../engine/selector'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { rescoreSessions } from '../save/rescore'
import { parseItemId } from '../tasks/ids'
import { CAL_NORMS } from '../tasks/priors'
import { RT_NORMS_VERSION } from '../tasks/rt'
import { BREAK_AT_S, HARD_STOP_S, SAVE_CTX } from './constants'
import { priorItemCounts } from './coverage'
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
    // Jump the timeline past the target while the person is at the Quant interstitial: budget 0.
    const bot = new Bot({ sessionId: 's_FLOORZERO00001' })
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'quant')
    bot.wait(A15_TARGET_S) // 27.5 more minutes: the budget of the rest is gone
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
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'quant')
    bot.wait(A15_TARGET_S)
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
    one.until((v) => v.phase === 'interstitial' && v.segment?.id === 'quant')
    one.wait(A15_TARGET_S) // the budget of the rest is gone
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
    const bot = new Bot({ sessionId: 's_SKIPINTER00001' })
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

  it('pins the limits of the spec: a break at 30 active minutes and the hard stop at 57 (DESIGN §7.4, §10)', () => {
    expect(BREAK_AT_S).toBe(30 * 60)
    expect(HARD_STOP_S).toBe(57 * 60)
  })

  it('does not stop a second early: at 56:59 the session is still going, and at 57:00 it ends', () => {
    const bot = new Bot({ sessionId: 's_HARDSTOP000002' })
    bot.until((v) => v.phase === 'item')
    bot.wait(HARD_STOP_S - 1 - bot.run.view().elapsedS) // the session has already run a few seconds
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

describe('the 30-minute break (§10)', () => {
  it('is offered once, at a boundary, after 30 active minutes; declining carries on', () => {
    const bot = new Bot({ sessionId: 's_BREAKDECLINE01' }, { blockScale: 2, itemScale: 1.5, onBreakOffer: 'decline' })
    let offers = 0
    let prev = ''
    for (let i = 0; i < 3000; i++) {
      const v = bot.view()
      if (v.phase === 'finished') break
      if (v.phase === 'break_offer') {
        offers++
        expect(v.elapsedS).toBeGreaterThanOrEqual(BREAK_AT_S)
        // Never mid-unit: it comes right after a unit ended (an answer rated, a block done, an item timed out), with nothing on screen.
        expect(['confidence', 'block', 'item'], `phase before the offer`).toContain(prev)
        expect(v.item).toBeNull()
        expect(v.block).toBeNull()
      }
      prev = v.phase
      bot.run.tick()
      bot.step()
    }
    expect(offers).toBe(1)
    expect(bot.run.view().phase).toBe('finished')
  })

  it('a break pauses the clock; the time on it is not session time', () => {
    const bot = new Bot({ sessionId: 's_BREAKTAKE00004' }, { blockScale: 2, itemScale: 1.5, onBreakOffer: 'take', breakS: 1200 })
    const v = bot.until((x) => x.phase === 'break_offer')
    const at = v.elapsedS
    bot.run.takeBreak()
    expect(bot.view().phase).toBe('on_break')
    bot.wait(1200)
    expect(bot.view().elapsedS).toBeCloseTo(at, 3)
    bot.run.resume()
    expect(['interstitial', 'item', 'block']).toContain(bot.view().phase)
    expect(bot.view().elapsedS).toBeCloseTo(at, 3)
    expect(bot.run.sessionState().flags.breaks).toBe(1)
  })

  it('the offer waits for the end of an item in progress', () => {
    const bot = new Bot({ sessionId: 's_BREAKWAITS0001' })
    const v = bot.until((x) => x.phase === 'item')
    bot.wait(BREAK_AT_S - 10 - v.elapsedS) // 10 s before the 30th minute
    bot.run.itemShown(bot.t)
    bot.wait(20) // the item is on screen when the 30th minute passes
    bot.run.tick()
    expect(bot.view().phase).toBe('item') // not interrupted
    const full = bot.fullItem(bot.view().item!.item_id)
    bot.run.itemResponded(full.options_count === undefined ? '1' : 0)
    expect(bot.view().phase).toBe('confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    expect(bot.view().phase).toBe('break_offer')
    expect(bot.view().elapsedS).toBeGreaterThan(BREAK_AT_S)
  })

  it('is not offered in a short session, nor once the hard stop has come first', () => {
    const short = new Bot({ sessionId: 's_BREAKSHORT0001' })
    short.finish()
    expect(short.phases).not.toContain('break_offer')
    expect(short.run.view().elapsedS).toBeLessThan(BREAK_AT_S)
    // A hard stop earlier than the break time ends the session first, and never offers a break after it.
    const early = new Bot({ sessionId: 's_BREAKSTOP00001', hardStopS: 600, breakAtS: 1200 }, { blockScale: 2, itemScale: 2 })
    early.finish()
    expect(early.run.view().ended).toBe('hard_stop')
    expect(early.phases).not.toContain('break_offer')
    early.run.takeBreak()
    expect(early.run.view().phase).toBe('finished')
    expect(early.run.sessionState().flags.breaks).toBeUndefined()
  })

  it('a break cannot be taken when none is offered', () => {
    const bot = new Bot({ sessionId: 's_BREAKNONE00001' })
    bot.run.takeBreak()
    expect(bot.view().phase).toBe('interstitial')
    bot.run.resume()
    expect(bot.view().phase).toBe('interstitial')
  })
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
