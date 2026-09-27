import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMON_REFRESH_RATES_HZ,
  MIN_REFRESH_DELTAS,
  browserFrameSource,
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

  it('a whole trial with an injected clock: onset frame, then a response 312.5 ms later', () => {
    const frames = new FakeFrames()
    const clock = new FakeClock()
    const onset = createOnsetScheduler(frames).schedule(1200, 5000, () => {})
    for (let ts = 5000 + 1000 / 60; onset.onsetFrameTs === null; ts += 1000 / 60) frames.frame(ts)
    clock.t = (onset.onsetFrameTs as number) + 312.5
    expect(responseRtMs(onset, responseTimestamp(clock))).toBeCloseTo(312.5, 9)
  })

  it('a press before onset is negative (an anticipation) and measured from the target', () => {
    const frames = new FakeFrames()
    const onset = createOnsetScheduler(frames).schedule(1500, 0, () => {})
    frames.frame(16.7)
    expect(responseRtMs(onset, 1400)).toBe(-100)
    onset.cancel()
    expect(onset.cancelled).toBe(true)
    // In the sub-frame gap after the target but before the onset frame: 0 ≤ RT < 1 frame (trimmed as too fast).
    const late = createOnsetScheduler(frames).schedule(20, 0, () => {})
    expect(responseRtMs(late, 25)).toBe(5)
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
