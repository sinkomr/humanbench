/**
 * Reaction time compares like with like from the save to the screen (owner decision 2026-10-11,
 * UX-REVIEW D3): the blob's RT axis is re-scored from the raw blocks with the input type the
 * session stored, so a touch session at the touch reference and a keyboard session at the keyboard
 * reference both land at about 0 SD on the same axis; and the "your median against the reference"
 * line uses the reference of the person's own input type.
 */

import { describe, expect, it } from 'vitest'
import type { ResponseTuple } from '../engine/types'
import { blockContextOf, registryObservation, rescoreSessions } from '../save/rescore'
import type { SaveFileV1 } from '../save/types'
import { RT_TOUCH_NORMS, RT_WEB_NORMS, generateRtBlock, type RtMode } from '../tasks/rt'
import { axisEstimates } from '../viz/profile'
import { TOUCH_SIMPLE_RT_MEDIAN_MS, WEB_SIMPLE_RT_MEDIAN_MS, normFacts, simpleRtReferenceMs } from './norms'
import { buildResults } from './results'

/** A save with one session (the re-score reads nothing else). */
function saveOf(responses: ResponseTuple[]): SaveFileV1 {
  return {
    sessions: [
      {
        session_id: 's_RTREF00000000001',
        started_utc: '2026-10-01T10:00:00Z',
        duration_s: 60,
        device: { class: 'desktop', input: 'keyboard', os_family: 'macOS', browser_family: 'Chrome', refresh_hz_est: 60, timer_res_ms: 0.1, viewport: [1280, 800] },
        flags: {},
        responses,
      },
    ],
  } as unknown as SaveFileV1
}

/** Scored trials spread symmetrically about `median` (half faster, half slower), so the median log-RT is ln(median). */
function aroundMedian(positions: readonly number[], median: number): { rt_ms: number[]; choice: number[] } {
  const n = positions.length
  const rt_ms = positions.map((_, i) => median * Math.exp(0.012 * (i < n / 2 ? -(n / 2 - i) : i - n / 2 + 1)))
  return { rt_ms, choice: [...positions] }
}

/** An RT block tuple as `session/run.ts` writes it: the response, and the scorer's record in `extra`. */
function rtTuple(mode: RtMode, median: number, input?: string, seed = `rtref-${mode}`): ResponseTuple {
  const item = generateRtBlock(seed, mode)
  const extra = { mode, device_class: 'desktop', norms_version: 'rt-web-v1', ...(input === undefined ? {} : { input_type: input }) }
  return [item.item_id, 0, aroundMedian(item.key.positions, median), null, 90_000, null, extra]
}

const rtSpoke = (save: SaveFileV1) => axisEstimates(buildResults(save)!.input).find((e) => e.code === 'RT')!

describe('blockContextOf (what a re-score reads back from the tuple)', () => {
  const tuple = (extra?: unknown): ResponseTuple =>
    extra === undefined ? ['i:rt_simple:2.0.0:x', 0, { rt_ms: [] }, null, 1, null] : ['i:rt_simple:2.0.0:x', 0, { rt_ms: [] }, null, 1, null, extra as never]
  it('reads the device class and the input type the session stored', () => {
    expect(blockContextOf(tuple({ device_class: 'phone', input_type: 'touch', n_valid: 30 }))).toEqual({ device_class: 'phone', input_type: 'touch' })
    expect(blockContextOf(tuple({ input_type: 'keyboard' }))).toEqual({ input_type: 'keyboard' })
  })
  it('is empty without an extra, or with one that holds no such strings (older saves, other blocks)', () => {
    expect(blockContextOf(tuple())).toEqual({})
    expect(blockContextOf(tuple(null))).toEqual({})
    expect(blockContextOf(tuple([1, 2]))).toEqual({})
    expect(blockContextOf(tuple({ input_type: 3, device_class: '' }))).toEqual({})
    expect(blockContextOf(tuple({ flags: ['x'], reasons: [] }))).toEqual({})
  })
})

describe('the RT axis of the reveal: each input type at its own reference lands at about 0 SD', () => {
  const cases: [string, string | undefined, number, number][] = [
    ['touch at the touch reference', 'touch', TOUCH_SIMPLE_RT_MEDIAN_MS, RT_TOUCH_NORMS.choice4.median_rt_ms],
    ['keyboard at the keyboard/mouse reference', 'keyboard', WEB_SIMPLE_RT_MEDIAN_MS, RT_WEB_NORMS.choice4.median_rt_ms],
    ['mouse at the keyboard/mouse reference', 'mouse', WEB_SIMPLE_RT_MEDIAN_MS, RT_WEB_NORMS.choice4.median_rt_ms],
    ['an older save with no input type, at the keyboard/mouse reference', undefined, WEB_SIMPLE_RT_MEDIAN_MS, RT_WEB_NORMS.choice4.median_rt_ms],
  ]

  it.each(cases)('%s (simple and four-choice blocks)', (_label, input, simpleMs, choiceMs) => {
    const save = saveOf([rtTuple('simple', simpleMs, input), rtTuple('choice4', choiceMs, input)])
    const spoke = rtSpoke(save)
    expect(spoke.measured).toBe(true)
    expect(Math.abs(spoke.theta!)).toBeLessThan(1e-4)
    expect(spoke.relation).toBe('overlaps') // an interval around 0: neither above nor below
    expect(spoke.muted).toBe(true)
    // Each block alone, too.
    for (const tuple of [rtTuple('simple', simpleMs, input), rtTuple('choice4', choiceMs, input)]) {
      expect(Math.abs(rtSpoke(saveOf([tuple])).theta!)).toBeLessThan(1e-4)
    }
  })

  it('two sessions with different input types, each at its own reference, are the same SD on the same axis', () => {
    const touch = rtSpoke(saveOf([rtTuple('simple', TOUCH_SIMPLE_RT_MEDIAN_MS, 'touch')]))
    const keyboard = rtSpoke(saveOf([rtTuple('simple', WEB_SIMPLE_RT_MEDIAN_MS, 'keyboard')]))
    expect(touch.theta).toBeCloseTo(keyboard.theta!, 6)
    expect(Math.abs(touch.theta!)).toBeLessThan(1e-4)
    // The range differs only through each reference's own width s (0.20 for touch, 0.15 for keyboard/mouse), which the owner set.
    expect(touch.sd!).toBeGreaterThan(0)
    expect(touch.sd! / keyboard.sd!).toBeCloseTo(RT_WEB_NORMS.simple.s / RT_TOUCH_NORMS.simple.s, 1)
  })

  it('a block is read against the reference of its own input type, not the other: touch 300 ms is fast, keyboard 470 ms is slow', () => {
    // 300 ms on a touch screen is well under the touch reference (470 ms): above 0 SD.
    const quickTouch = rtSpoke(saveOf([rtTuple('simple', 300, 'touch')]))
    expect(quickTouch.theta!).toBeGreaterThan(1.5)
    // 470 ms on a keyboard is well over the keyboard/mouse reference (300 ms): below 0 SD (as before this change).
    const slowKeyboard = rtSpoke(saveOf([rtTuple('simple', 470, 'keyboard')]))
    expect(slowKeyboard.theta!).toBeLessThan(-1.5)
    // The same 470 ms on a touch screen is at the touch reference.
    expect(Math.abs(rtSpoke(saveOf([rtTuple('simple', 470, 'touch')])).theta!)).toBeLessThan(1e-4)
  })

  it('the re-score gives the observation the session built for the same block (registryObservation = rtBlockObservation with the stored device)', () => {
    for (const input of ['touch', 'keyboard', 'mouse', undefined]) {
      const t = rtTuple('simple', 350, input)
      const r = registryObservation(t)
      expect('observation' in r).toBe(true)
      if (!('observation' in r) || r.observation.kind !== 'gaussian') return
      const ref = input === 'touch' ? RT_TOUCH_NORMS.simple : RT_WEB_NORMS.simple
      expect(r.observation).toMatchObject({ axis: 'RT', lam: -ref.s, d: ref.beta })
    }
  })

  it('rescoreSessions passes the stored input type to the RT family', () => {
    const touchOnly = rescoreSessions(saveOf([rtTuple('simple', TOUCH_SIMPLE_RT_MEDIAN_MS, 'touch')]))
    const k = touchOnly.sessions[0]!.n_observations
    expect(k).toBe(1)
    expect(Math.abs(touchOnly.eap.RT!.mean)).toBeLessThan(1e-4)
  })
})

describe('the median-against-reference line uses the reference of the person\'s own input type', () => {
  it('normFacts reports the median and which reference it is compared with', () => {
    const touch = normFacts(saveOf([rtTuple('simple', 470, 'touch')]))
    expect(touch.simpleRtMs).toBe(470)
    expect(touch.simpleRtReference).toBe('touch')
    const keyboard = normFacts(saveOf([rtTuple('simple', 300, 'keyboard')]))
    expect(keyboard.simpleRtReference).toBe('keyboard_mouse')
    expect(normFacts(saveOf([rtTuple('simple', 300, 'mouse')])).simpleRtReference).toBe('keyboard_mouse')
    expect(normFacts(saveOf([rtTuple('simple', 300)])).simpleRtReference).toBe('keyboard_mouse') // an older save
    // The median does not depend on the reference.
    expect(normFacts(saveOf([rtTuple('simple', 470, 'keyboard')])).simpleRtMs).toBe(470)
  })

  it('the figure shown is that reference\'s median: 470 ms for touch, 300 ms for keyboard and mouse', () => {
    expect(simpleRtReferenceMs('touch')).toBe(470)
    expect(simpleRtReferenceMs('keyboard_mouse')).toBe(300)
    expect(simpleRtReferenceMs()).toBe(300)
    expect(simpleRtReferenceMs('touch')).toBe(TOUCH_SIMPLE_RT_MEDIAN_MS)
    expect(simpleRtReferenceMs('keyboard_mouse')).toBe(WEB_SIMPLE_RT_MEDIAN_MS)
  })

  it('the latest valid block decides, with its own input type (a person who switched device)', () => {
    const early = rtTuple('simple', 300, 'keyboard', 'rtref-early')
    const late = rtTuple('simple', 480, 'touch', 'rtref-late')
    const save = {
      sessions: [
        { ...saveOf([early]).sessions[0]!, session_id: 's_RTREF00000000002', started_utc: '2026-10-01T10:00:00Z' },
        { ...saveOf([late]).sessions[0]!, session_id: 's_RTREF00000000003', started_utc: '2026-10-09T10:00:00Z' },
      ],
    } as unknown as SaveFileV1
    const f = normFacts(save)
    expect(f.simpleRtMs).toBe(480)
    expect(f.simpleRtReference).toBe('touch')
  })
})
