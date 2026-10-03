import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMON_REFRESH_RATES_HZ,
  MIN_REFRESH_DELTAS,
  PRE_ONSET_MAX_RT_MS,
  browserFrameSource,
  classifyTrial,
  createOnsetScheduler,
  estimateRefreshRate,
  firstFrameAtOrAfter,
  frameDeltas,
  isOnsetFrame,
  measureRefreshRate,
  onsetTarget,
  performanceClock,
  reactionTimeMs,
  responseRtMs,
  responseTimestamp,
  responseTimestampFromEvent,
  combineTimestampSources,
  MAX_EVENT_LAG_MS,
  EVENT_TS_MAX_AGE_MS,
  BlockTimestampPolicy,
  eventLagMs,
  snapRefreshRate,
  type Clock,
  type FrameCallback,
  type FrameSource,
} from '.'

/** A manual requestAnimationFrame: `frame(ts)` runs the callbacks pending before it, like a real frame. */
class FakeFrames implements FrameSource {
  private nextHandle = 1
  private readonly pending = new Map<number, FrameCallback>()
  requests = 0
  request(cb: FrameCallback): number {
    const h = this.nextHandle++
    this.pending.set(h, cb)
    this.requests++
    return h
  }
  cancel(handle: number): void {
    this.pending.delete(handle)
  }
  frame(ts: number): void {
    const due = [...this.pending.values()]
    this.pending.clear()
    for (const cb of due) cb(ts)
  }
  get pendingCount(): number {
    return this.pending.size
  }
}

/** A settable monotonic clock. */
class FakeClock implements Clock {
  t = 0
  now(): number {
    return this.t
  }
}

const deltasAt = (hz: number, n = MIN_REFRESH_DELTAS): number[] => Array<number>(n).fill(1000 / hz)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('refresh-rate estimate (§11.6 item 2)', () => {
  it('snaps each common rate from its exact frame period', () => {
    for (const hz of COMMON_REFRESH_RATES_HZ) {
      const e = estimateRefreshRate(deltasAt(hz))
      expect(e.hz).toBe(hz)
      expect(e.snapped).toBe(true)
      expect(e.raw_hz).toBeCloseTo(hz, 9)
      expect(e.n_deltas).toBe(60)
    }
  })

  it('uses the median: jitter and dropped frames do not move it', () => {
    const jittered = deltasAt(120).map((d, i) => d + (i % 2 ? 0.4 : -0.4))
    expect(estimateRefreshRate(jittered).hz).toBe(120)
    const dropped = [...deltasAt(60, 50), ...deltasAt(30, 12)] // 12 of 62 frames took two periods
    expect(estimateRefreshRate(dropped)).toMatchObject({ hz: 60, snapped: true })
    expect(estimateRefreshRate([...deltasAt(144, 59), 500]).hz).toBe(144)
  })

  it('snaps within 3% only; otherwise reports the raw rate to 0.1 Hz', () => {
    expect(snapRefreshRate(61.7)).toEqual({ hz: 60, snapped: true })
    expect(snapRefreshRate(58.3)).toEqual({ hz: 60, snapped: true })
    expect(snapRefreshRate(62)).toEqual({ hz: 62, snapped: false })
    expect(snapRefreshRate(116.5)).toEqual({ hz: 120, snapped: true })
    expect(snapRefreshRate(116.3)).toEqual({ hz: 116.3, snapped: false })
    expect(snapRefreshRate(100)).toEqual({ hz: 100, snapped: false })
    expect(snapRefreshRate(30)).toEqual({ hz: 30, snapped: false })
    expect(snapRefreshRate(247)).toEqual({ hz: 240, snapped: true })
    expect(estimateRefreshRate(deltasAt(100))).toMatchObject({ hz: 100, snapped: false, median_delta_ms: 10 })
    expect(estimateRefreshRate(deltasAt(59.94)).hz).toBe(60) // NTSC-style 59.94 Hz
  })

  it('needs at least 60 finite positive deltas', () => {
    expect(() => estimateRefreshRate(deltasAt(60, 59))).toThrow(RangeError)
    expect(() => estimateRefreshRate([...deltasAt(60, 59), Number.NaN])).toThrow(RangeError)
    expect(() => estimateRefreshRate([...deltasAt(60, 59), 0])).toThrow(RangeError)
    expect(() => estimateRefreshRate([...deltasAt(60, 59), -16])).toThrow(RangeError)
    expect(() => snapRefreshRate(0)).toThrow(RangeError)
    expect(() => snapRefreshRate(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('frameDeltas: consecutive differences of strictly increasing finite timestamps', () => {
    expect(frameDeltas([10, 26.5, 43])).toEqual([16.5, 16.5])
    expect(frameDeltas([5])).toEqual([])
    expect(() => frameDeltas([10, 10])).toThrow(RangeError)
    expect(() => frameDeltas([10, 9])).toThrow(RangeError)
    expect(() => frameDeltas([10, Number.NaN])).toThrow(RangeError)
  })

  it('measureRefreshRate collects 61 frames from the frame source', async () => {
    const frames = new FakeFrames()
    const p = measureRefreshRate(frames)
    for (let i = 0; i <= 60; i++) frames.frame(500 + (i * 1000) / 120)
    await expect(p).resolves.toMatchObject({ hz: 120, snapped: true, n_deltas: 60 })
    expect(frames.requests).toBe(61)
    expect(frames.pendingCount).toBe(0)
  })

  it('measureRefreshRate rejects bad frames and a count below 60', async () => {
    const frames = new FakeFrames()
    const p = measureRefreshRate(frames)
    for (let i = 0; i <= 60; i++) frames.frame(100) // a frozen timestamp
    await expect(p).rejects.toThrow(RangeError)
    await expect(measureRefreshRate(new FakeFrames(), 59)).rejects.toThrow(RangeError)
    await expect(measureRefreshRate(new FakeFrames(), 60.5)).rejects.toThrow(RangeError)
  })
})

describe('rAF-locked onset scheduling (§11.6 item 1)', () => {
  it('the target is rafNow + onsetAfterMs; the onset frame is the first frame at or after it', () => {
    expect(onsetTarget(1234, 1000)).toBe(2234)
    expect(isOnsetFrame(2234, 2234)).toBe(true)
    expect(isOnsetFrame(2233.99, 2234)).toBe(false)
    expect(firstFrameAtOrAfter([0, 16.7, 33.4, 50.1], 20)).toBe(33.4)
    expect(firstFrameAtOrAfter([0, 16.7, 33.4], 33.4)).toBe(33.4)
    expect(firstFrameAtOrAfter([0, 16.7], 20)).toBeNull()
    expect(() => onsetTarget(-1, 0)).toThrow(RangeError)
    expect(() => onsetTarget(Number.NaN, 0)).toThrow(RangeError)
    expect(() => onsetTarget(800, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('shows the stimulus synchronously inside the first frame ≥ target and then stops requesting frames', () => {
    const frames = new FakeFrames()
    const shown: number[] = []
    const onset = createOnsetScheduler(frames).schedule(1234, 1000, (ts) => {
      shown.push(ts)
      expect(onset.onsetFrameTs).toBe(ts) // already recorded when the callback draws
    })
    expect(onset.target).toBe(2234)
    const period = 1000 / 60
    let k = 1
    while (shown.length === 0) frames.frame(1000 + period * k++)
    const expected = firstFrameAtOrAfter(Array.from({ length: k }, (_, i) => 1000 + period * i), 2234)
    expect(shown).toEqual([expected])
    expect(onset.onsetFrameTs).toBe(expected)
    expect(frames.pendingCount).toBe(0)
    frames.frame(9999)
    expect(shown).toHaveLength(1)
  })

  it('a frame exactly at the target is the onset frame; onsetAfterMs = 0 shows in the next frame', () => {
    const frames = new FakeFrames()
    const a = createOnsetScheduler(frames).schedule(800, 100, () => {})
    frames.frame(899.9)
    expect(a.onsetFrameTs).toBeNull()
    frames.frame(900)
    expect(a.onsetFrameTs).toBe(900)
    const b = createOnsetScheduler(frames).schedule(0, 950, () => {})
    frames.frame(966.7)
    expect(b.onsetFrameTs).toBe(966.7)
  })

  it('cancel() stops a pending onset (e.g. after an anticipation) and is a no-op once shown', () => {
    const frames = new FakeFrames()
    const onOnset = vi.fn()
    const s = createOnsetScheduler(frames)
    const a = s.schedule(1000, 0, onOnset)
    frames.frame(16.7)
    a.cancel()
    expect(a.cancelled).toBe(true)
    expect(frames.pendingCount).toBe(0)
    frames.frame(2000)
    expect(onOnset).not.toHaveBeenCalled()
    expect(a.onsetFrameTs).toBeNull()
    const b = s.schedule(0, 0, onOnset)
    frames.frame(16.7)
    b.cancel()
    expect(b.cancelled).toBe(false)
    expect(b.onsetFrameTs).toBe(16.7)
  })

  it('for any refresh period and foreperiod, the onset is the first frame ≥ target, within one period of it', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000 / 240, max: 1000 / 30, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.integer({ min: 800, max: 2000 }),
        (period, phase, rafNow, fp) => {
          const frames = new FakeFrames()
          const onset = createOnsetScheduler(frames).schedule(fp, rafNow, () => {})
          const stamps: number[] = []
          for (let k = 1; onset.onsetFrameTs === null; k++) {
            const ts = rafNow + period * (k - 1 + phase) + 1e-9 * k
            stamps.push(ts)
            frames.frame(ts)
          }
          const got = onset.onsetFrameTs as number
          expect(got).toBe(firstFrameAtOrAfter(stamps, rafNow + fp))
          expect(got - (rafNow + fp)).toBeGreaterThanOrEqual(0)
          expect(got - (rafNow + fp)).toBeLessThan(period + 1e-6)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('RT = response timestamp (performance.now) − onset frame timestamp', () => {
  it('reactionTimeMs subtracts and refuses non-finite timestamps', () => {
    expect(reactionTimeMs(2567.25, 2250)).toBe(317.25)
    expect(reactionTimeMs(2000, 2250)).toBe(-250)
    expect(() => reactionTimeMs(Number.NaN, 0)).toThrow(RangeError)
  })

  it('a whole trial with an injected clock: RT is measured from the onset frame, not the target', () => {
    const frames = new FakeFrames()
    const clock = new FakeClock()
    // 1210 ms is not a multiple of the 60 Hz period, so the onset frame lands well after the target.
    const onset = createOnsetScheduler(frames).schedule(1210, 5000, () => {})
    for (let ts = 5000 + 1000 / 60; onset.onsetFrameTs === null; ts += 1000 / 60) frames.frame(ts)
    const shownAt = onset.onsetFrameTs as number
    expect(shownAt - onset.target).toBeGreaterThan(1)
    clock.t = shownAt + 312.5
    expect(responseRtMs(onset, responseTimestamp(clock))).toBeCloseTo(312.5, 9)
    expect(classifyTrial('simple', responseRtMs(onset, shownAt + 312.5), 0, 0)).toBe('valid')
  })

  it('a press before the target is negative (an anticipation), measured from the target', () => {
    const frames = new FakeFrames()
    const onset = createOnsetScheduler(frames).schedule(1500, 0, () => {})
    frames.frame(16.7)
    expect(responseRtMs(onset, 1400)).toBe(-100)
    onset.cancel()
    expect(onset.cancelled).toBe(true)
    expect(responseRtMs(onset, 1400)).toBe(-100) // still before onset after the cancel
  })

  it('a press after the target but before the onset frame ran is an anticipation, not a fast RT', () => {
    const frames = new FakeFrames()
    // The sub-frame gap: target 20, next frame at 33.3, pressed at 25.
    const gap = createOnsetScheduler(frames).schedule(20, 0, () => {})
    frames.frame(16.7)
    expect(responseRtMs(gap, 25)).toBe(PRE_ONSET_MAX_RT_MS)
    expect(responseRtMs(gap, 20)).toBe(PRE_ONSET_MAX_RT_MS) // exactly at the target, not yet drawn
    expect(classifyTrial('simple', responseRtMs(gap, 25), 0, 0)).toBe('anticipation')
    // A press just before the target keeps its measured (more negative) RT.
    expect(responseRtMs(gap, 19.5)).toBe(-0.5)
  })

  it('a stalled main thread: no onset frame yet, a press 200 ms after the target is still an anticipation', () => {
    const frames = new FakeFrames()
    const onset = createOnsetScheduler(frames).schedule(800, 0, () => {})
    for (let k = 1; k <= 47; k++) frames.frame((k * 1000) / 60) // frames up to ≈ 783.3 ms, then a stall
    expect(onset.onsetFrameTs).toBeNull()
    const rtMs = responseRtMs(onset, 1000)
    expect(rtMs).toBeLessThan(0)
    for (const mode of ['simple', 'choice4'] as const) expect(classifyTrial(mode, rtMs, 0, 0)).toBe('anticipation')
    // The late frame finally runs: a press after it is measured from that frame.
    frames.frame(1016.7)
    expect(onset.onsetFrameTs).toBe(1016.7)
    expect(responseRtMs(onset, 1316.7)).toBeCloseTo(300, 9)
  })

  it('PRE_ONSET_MAX_RT_MS is strictly negative and survives rounding to 0.1 ms and JSON', () => {
    expect(PRE_ONSET_MAX_RT_MS).toBeLessThan(0)
    expect(Math.round(PRE_ONSET_MAX_RT_MS * 10) / 10).toBeLessThan(0)
    expect(JSON.parse(JSON.stringify(PRE_ONSET_MAX_RT_MS))).toBeLessThan(0)
  })

  it('the default clock is performance.now()', () => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(4242.5)
    expect(responseTimestamp()).toBe(4242.5)
    expect(performanceClock.now()).toBe(4242.5)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('browserFrameSource wraps requestAnimationFrame / cancelAnimationFrame', () => {
    const host = { requestAnimationFrame: vi.fn(() => 7), cancelAnimationFrame: vi.fn() }
    const src = browserFrameSource(host)
    const cb = (): void => {}
    expect(src.request(cb)).toBe(7)
    src.cancel(7)
    expect(host.requestAnimationFrame).toHaveBeenCalledWith(cb)
    expect(host.cancelAnimationFrame).toHaveBeenCalledWith(7)
  })
})

describe('responseTimestampFromEvent (§11.6)', () => {
  const clock: Clock = { now: () => 5000 }
  const from = (timeStamp: number, notBefore?: number) => responseTimestampFromEvent({ timeStamp }, clock, notBefore)

  it('uses the event timestamp when it is on the performance.now() timeline', () => {
    expect(from(4996.5)).toEqual({ ts: 4996.5, source: 'event' })
    expect(from(5000)).toEqual({ ts: 5000, source: 'event' })
    expect(from(4990, 4980)).toEqual({ ts: 4990, source: 'event' })
  })

  it('falls back to the clock for a future timestamp', () => {
    expect(from(5000.5)).toEqual({ ts: 5000, source: 'handler' })
    expect(from(1.7e12)).toEqual({ ts: 5000, source: 'handler' }) // epoch milliseconds
  })

  it('falls back for zero, negative, NaN, infinite and non-number timestamps', () => {
    for (const bad of [0, -3, NaN, Infinity, -Infinity]) expect(from(bad), String(bad)).toEqual({ ts: 5000, source: 'handler' })
    expect(responseTimestampFromEvent({ timeStamp: '4990' as unknown as number }, clock)).toEqual({ ts: 5000, source: 'handler' })
  })

  it('falls back for a timestamp before the onset minus the margin, or too far behind now()', () => {
    const notBefore = 2300 // cut-off notBefore - margin = 1300
    const c1400: Clock = { now: () => 1320 }
    expect(responseTimestampFromEvent({ timeStamp: 1299 }, c1400, notBefore)).toEqual({ ts: 1320, source: 'handler' })
    expect(responseTimestampFromEvent({ timeStamp: 1301 }, c1400, notBefore)).toEqual({ ts: 1301, source: 'event' })
    expect(responseTimestampFromEvent({ timeStamp: 1301 }, { now: () => 1400 }, notBefore).source).toBe('handler') // 99 ms lag
    expect(from(5000 - EVENT_TS_MAX_AGE_MS - 1)).toEqual({ ts: 5000, source: 'handler' })
  })

  it('accepts 0 <= lag <= MAX_EVENT_LAG_MS exactly, and rejects either side', () => {
    expect(MAX_EVENT_LAG_MS).toBe(25)
    expect(from(5000 - MAX_EVENT_LAG_MS)).toEqual({ ts: 4975, source: 'event' })
    expect(from(5000 - MAX_EVENT_LAG_MS - 0.01).source).toBe('handler')
    expect(from(5000).source).toBe('event')
    expect(from(5000.01).source).toBe('handler')
  })

  it('a 3 ms lag uses the event; a constant 205 ms offset (Safari) falls back to the handler', () => {
    expect(from(4997)).toEqual({ ts: 4997, source: 'event' })
    for (const lag of [203, 205, 209]) expect(from(5000 - lag), String(lag)).toEqual({ ts: 5000, source: 'handler' })
  })

  it('a decided-consistent block tolerates a long dispatch up to the sanity limit', () => {
    expect(responseTimestampFromEvent({ timeStamp: 4900 }, clock, undefined, EVENT_TS_MAX_AGE_MS).source).toBe('event')
    expect(responseTimestampFromEvent({ timeStamp: 5000 - EVENT_TS_MAX_AGE_MS - 1 }, clock, undefined, EVENT_TS_MAX_AGE_MS).source).toBe('handler')
  })

  it('RT = event timestamp − onset, without the handler delay', () => {
    const onset = { target: 4900, onsetFrameTs: 4950, cancelled: false, cancel() {} }
    const s = from(4990)
    expect(responseRtMs(onset, s.ts)).toBe(40) // the clock says 50 ms; the dispatch delay is excluded
  })

  it('never reads the wall clock', () => {
    const spy = vi.spyOn(Date, 'now')
    from(4000)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('combines the sources of a block', () => {
    expect(combineTimestampSources([])).toBeUndefined()
    expect(combineTimestampSources(['event', 'event'])).toBe('event')
    expect(combineTimestampSources(['handler'])).toBe('handler')
    expect(combineTimestampSources(['event', 'handler'])).toBe('mixed')
  })
})

describe('BlockTimestampPolicy: per-block clock consistency (§11.6)', () => {
  const clock: Clock = { now: () => 5000 }
  const ev = (lag: number) => ({ timeStamp: 5000 - lag })
  const policy = (lags: number[]) => {
    const p = new BlockTimestampPolicy()
    for (const l of lags) p.observe(ev(l), clock)
    return p
  }

  it('eventLagMs: now minus timeStamp; null for synthetic (0, NaN, negative) timestamps', () => {
    expect(eventLagMs(ev(7), clock)).toBe(7)
    for (const bad of [0, NaN, -1, Infinity]) expect(eventLagMs({ timeStamp: bad }, clock)).toBeNull()
  })

  it('constant offset (205 ms, low spread) -> handler, reason event_clock_offset, for every later response', () => {
    const p = policy([203, 205, 209, 205])
    expect(p.decide()).toMatchObject({ source: 'handler', reason: 'event_clock_offset', n: 4 })
    expect(p.stamp(ev(3), clock)).toEqual({ ts: 5000, source: 'handler' }) // even a 3 ms-lag event
  })

  it('consistent small lag -> event, no reason', () => {
    const p = policy([1, 3, 7, 2])
    const d = p.decide()
    expect(d).toMatchObject({ source: 'event' })
    expect(d?.reason).toBeUndefined()
    expect(p.stamp(ev(3), clock)).toEqual({ ts: 4997, source: 'event' })
    expect(p.stamp(ev(200), clock).source).toBe('event') // one late dispatch on a good clock keeps the block on one source
  })

  it('median at the bound is consistent; just over is not; a high-spread bad median is event_lag_high', () => {
    expect(policy([MAX_EVENT_LAG_MS, MAX_EVENT_LAG_MS]).decide()?.source).toBe('event')
    expect(policy([MAX_EVENT_LAG_MS + 0.5, MAX_EVENT_LAG_MS + 0.5]).decide()).toMatchObject({ source: 'handler', reason: 'event_clock_offset' })
    expect(policy([30, 400, 900]).decide()).toMatchObject({ source: 'handler', reason: 'event_lag_high' })
  })

  it('a median in the future (negative lag) is inconsistent too', () => {
    expect(policy([-5, -6, -4]).decide()?.source).toBe('handler')
  })

  it('too few samples: undecided, per-response rule applies', () => {
    const p = policy([205])
    expect(p.decide()).toBeNull()
    expect(p.stamp(ev(205), clock).source).toBe('handler')
    expect(p.stamp(ev(3), clock).source).toBe('event')
  })

  it('observations after the decision do not change it', () => {
    const p = policy([205, 205])
    p.decide()
    for (let i = 0; i < 10; i++) p.observe(ev(1), clock)
    expect(p.decide()?.source).toBe('handler')
  })
})
