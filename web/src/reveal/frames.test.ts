import { describe, expect, it, vi } from 'vitest'
import type { FrameSource } from '../tasks/rt/timing'
import { THETA_MIN } from '../viz/geometry'
import { axisEstimates } from '../viz/profile'
import { syntheticProfile } from '../viz/synthetic'
import { REVEAL_AXIS_MS, easeOutCubic, frameEstimates, revealCount, revealingNow, startReveal } from './frames'

const estimates = () => axisEstimates(syntheticProfile('full')!.input)

/** A frame source the test steps by hand, with a clock of its own. */
function fakeFrames(): { frames: FrameSource; step: (ts: number) => void; pending: () => number } {
  let next = 1
  const q = new Map<number, (ts: number) => void>()
  return {
    frames: {
      request: (cb) => {
        const h = next++
        q.set(h, cb)
        return h
      },
      cancel: (h) => void q.delete(h),
    },
    step(ts) {
      const batch = [...q.entries()]
      q.clear()
      for (const [, cb] of batch) cb(ts)
    },
    pending: () => q.size,
  }
}

describe('frameEstimates (§10 build-up axis by axis)', () => {
  const est = estimates()
  const n = revealCount(est)

  it('the last frame is exactly the static profile', () => {
    const last = frameEstimates(est, n)
    expect(last).toHaveLength(est.length)
    last.forEach((e, i) => expect(e).toBe(est[i]))
    expect(frameEstimates(est, n + 5).every((e, i) => e === est[i])).toBe(true)
  })

  it('starts with every measured skill at the centre with no uncertainty, and stubs unchanged', () => {
    const first = frameEstimates(est, 0)
    first.forEach((e, i) => {
      if (!est[i]!.measured) return expect(e).toBe(est[i])
      expect(e.theta).toBeCloseTo(THETA_MIN, 12)
      expect(e.sd).toBe(0)
    })
  })

  it('draws skills one after another: skill i is untouched before progress i and final after i + 1', () => {
    const measured = est.filter((e) => e.measured)
    const mid = frameEstimates(est, 2.5).filter((e) => e.measured)
    expect(mid[0]).toBe(measured[0]) // done
    expect(mid[1]).toBe(measured[1]) // done
    expect(mid[2]!.theta).toBeGreaterThan(THETA_MIN) // growing
    expect(mid[2]!.theta).toBeLessThan(measured[2]!.theta!) // not there yet
    expect(mid[3]!.theta).toBeCloseTo(THETA_MIN, 12) // not started
    expect(mid[3]!.sd).toBe(0)
  })

  it('keeps each spoke’s final muting and relation for the whole build-up (no colour flicker)', () => {
    for (const p of [0, 0.3, 1.7, 3.2, n - 0.4]) {
      const frame = frameEstimates(est, p)
      frame.forEach((e, i) => {
        expect(e.muted).toBe(est[i]!.muted)
        expect(e.relation).toBe(est[i]!.relation)
      })
    }
  })

  it('grows monotonically per skill and never overshoots its final estimate', () => {
    const measured = est.filter((e) => e.measured)
    for (let k = 0; k < measured.length; k++) {
      let prev = -Infinity
      for (let p = 0; p <= n; p += 0.05) {
        const e = frameEstimates(est, p).filter((x) => x.measured)[k]!
        expect(e.theta!).toBeGreaterThanOrEqual(prev - 1e-12)
        prev = e.theta!
        expect(Math.abs(e.theta! - THETA_MIN)).toBeLessThanOrEqual(Math.abs(measured[k]!.theta! - THETA_MIN) + 1e-9)
        expect(e.sd!).toBeLessThanOrEqual(measured[k]!.sd! + 1e-12)
      }
    }
  })

  it('rejects a progress that is not a number', () => {
    expect(() => frameEstimates(est, Number.NaN)).toThrow(RangeError)
  })

  it('names the skill being drawn', () => {
    const measured = est.filter((e) => e.measured)
    expect(revealingNow(est, 0)).toEqual({ name: measured[0]!.name, index: 1, count: n })
    expect(revealingNow(est, 2.4)).toEqual({ name: measured[2]!.name, index: 3, count: n })
    expect(revealingNow(est, n)).toBeNull()
  })

  it('easing runs 0 to 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeOutCubic(-3)).toBe(0)
    expect(easeOutCubic(3)).toBe(1)
  })
})

describe('startReveal (rAF timestamps, never the wall clock)', () => {
  it('runs from the first frame’s timestamp and finishes after count × axisMs', () => {
    const f = fakeFrames()
    const seen: number[] = []
    const done = vi.fn()
    startReveal({ count: 3, frames: f.frames, onProgress: (p) => seen.push(p), onDone: done, minFrameMs: 0 })
    expect(seen).toEqual([0])
    f.step(5000) // the first frame sets t0
    f.step(5000 + REVEAL_AXIS_MS)
    expect(seen.at(-1)).toBeCloseTo(1, 12)
    f.step(5000 + 2.5 * REVEAL_AXIS_MS)
    expect(seen.at(-1)).toBeCloseTo(2.5, 12)
    expect(done).not.toHaveBeenCalled()
    f.step(5000 + 3 * REVEAL_AXIS_MS)
    expect(seen.at(-1)).toBe(3)
    expect(done).toHaveBeenCalledTimes(1)
    expect(f.pending()).toBe(0)
  })

  it('skip jumps to the finished profile once and stops the loop', () => {
    const f = fakeFrames()
    const seen: number[] = []
    const done = vi.fn()
    const h = startReveal({ count: 5, frames: f.frames, onProgress: (p) => seen.push(p), onDone: done })
    h.skip()
    h.skip()
    expect(seen.at(-1)).toBe(5)
    expect(done).toHaveBeenCalledTimes(1)
    expect(f.pending()).toBe(0)
  })

  it('stop ends it without a final frame', () => {
    const f = fakeFrames()
    const done = vi.fn()
    const h = startReveal({ count: 5, frames: f.frames, onProgress: () => undefined, onDone: done })
    h.stop()
    expect(f.pending()).toBe(0)
    f.step(1)
    expect(done).not.toHaveBeenCalled()
  })

  it('with nothing to draw it finishes at once (asynchronously)', async () => {
    const f = fakeFrames()
    const done = vi.fn()
    startReveal({ count: 0, frames: f.frames, onProgress: () => undefined, onDone: done })
    await Promise.resolve()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('throttles redraws to minFrameMs', () => {
    const f = fakeFrames()
    const seen: number[] = []
    startReveal({ count: 10, frames: f.frames, onProgress: (p) => seen.push(p), onDone: () => undefined, minFrameMs: 30 })
    for (let t = 0; t <= 100; t += 10) f.step(1000 + t)
    // 11 frames over 100 ms at 30 ms: the initial 0, then about one per 30 ms.
    expect(seen.length).toBeLessThan(7)
    expect(seen.length).toBeGreaterThan(2)
  })
})
