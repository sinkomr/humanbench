import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Clock, FrameCallback, FrameSource } from '../tasks/rt/timing'
import {
  DEFAULT_PLAN,
  GATED_METRICS,
  INPUT_LATENCY_NOTE,
  ONSET_DELAY_MIN_MS,
  ONSET_DELAY_SPAN_MS,
  QUICK_PLAN,
  SELFTEST_REPORT_VERSION,
  WARMUP_FRAMES,
  SELFTEST_THRESHOLD_MS,
  buildReport,
  collectFrames,
  frameMetrics,
  inputLatency,
  isHighResEventTs,
  onsetDelays,
  onsetMetrics,
  passes,
  quantileSorted,
  reportJson,
  runOnsetTrials,
  sampleEvent,
  sampleTimer,
  scheduledFrameTs,
  summarize,
  timerIncrements,
  type InputSample,
  type OnsetTrial,
  type SelfTestMeasurements,
} from './measure'

/** A manual requestAnimationFrame: `frame(ts)` runs the callbacks pending before it, like a real frame. */
class FakeFrames implements FrameSource {
  private nextHandle = 1
  private readonly pending = new Map<number, FrameCallback>()
  request(cb: FrameCallback): number {
    const h = this.nextHandle++
    this.pending.set(h, cb)
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

/** A clock that advances `step` ms every `every` readings (a coarse, quantised timer). */
class SteppingClock implements Clock {
  private reads = 0
  constructor(
    private readonly step: number,
    private readonly every: number,
    private t = 1000,
  ) {}
  now(): number {
    this.reads++
    if (this.reads % this.every === 0) this.t += this.step
    return this.t
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

/**
 * Drive `frames` with timestamps from `next()` until `done()`, letting promise continuations run
 * between frames (as the browser does between rAF callbacks).
 */
async function pump(frames: FakeFrames, next: () => number, done: () => boolean, maxFrames = 100_000): Promise<void> {
  for (let i = 0; i < maxFrames && !done(); i++) {
    await flush()
    if (frames.pendingCount > 0) frames.frame(next())
  }
  await flush()
}

const grid = (n: number, period: number, t0 = 100): number[] => Array.from({ length: n }, (_, i) => t0 + i * period)
const P120 = 1000 / 120

describe('statistics', () => {
  it('quantileSorted is linear interpolation between order statistics (numpy type 7)', () => {
    const xs = [1, 2, 3, 4, 10]
    expect(quantileSorted(xs, 0)).toBe(1)
    expect(quantileSorted(xs, 0.5)).toBe(3)
    expect(quantileSorted(xs, 1)).toBe(10)
    expect(quantileSorted(xs, 0.95)).toBeCloseTo(8.8, 12) // h = 3.8: 4 + 0.8·6
    expect(quantileSorted([7], 0.95)).toBe(7)
    expect(() => quantileSorted([], 0.5)).toThrow(RangeError)
    expect(() => quantileSorted([1], 1.5)).toThrow(RangeError)
  })

  it('summarize: n, p50 ≤ p95 ≤ max, all within the sample range (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 200 }), (xs) => {
        const s = summarize(xs)
        expect(s.n).toBe(xs.length)
        expect(s.p50).toBeLessThanOrEqual(s.p95)
        expect(s.p95).toBeLessThanOrEqual(s.max)
        // === and not toBe (Object.is): for the samples [0, -0] the max is -0 here and +0 from Math.max, the same number
        expect(s.max === Math.max(...xs)).toBe(true)
        expect(s.p50).toBeGreaterThanOrEqual(Math.min(...xs))
      }),
    )
  })

  it('summarize rejects empty and non-finite samples', () => {
    expect(() => summarize([])).toThrow(RangeError)
    expect(() => summarize([1, Number.NaN])).toThrow(RangeError)
    expect(() => summarize([Infinity])).toThrow(RangeError)
  })

  it('passes() is p95 < threshold (strict), whatever the max', () => {
    expect(passes({ n: 3, p50: 1, p95: 4.99, max: 40 })).toBe(true)
    expect(passes({ n: 3, p50: 1, p95: SELFTEST_THRESHOLD_MS, max: 5 })).toBe(false)
    expect(passes({ n: 3, p50: 1, p95: 2, max: 3 }, 1.5)).toBe(false)
  })
})

describe('frame metrics: refresh, rAF interval, jitter', () => {
  it('a perfect 120 Hz stream: 120 Hz, interval 8.33 ms, zero jitter', () => {
    const m = frameMetrics(grid(241, P120))
    expect(m.refresh).toMatchObject({ hz: 120, snapped: true, n_deltas: 240 })
    expect(m.interval.p50).toBeCloseTo(P120, 9)
    expect(m.jitter.max).toBeCloseTo(0, 9)
    expect(passes(m.jitter)).toBe(true)
  })

  it('jitter is |Δ − median Δ|: ±0.4 ms alternation gives 0.4 ms', () => {
    const ts = [0]
    for (let i = 0; i < 120; i++) ts.push((ts[i] as number) + P120 + (i % 2 ? 0.4 : -0.4))
    const m = frameMetrics(ts)
    expect(m.refresh.hz).toBe(120)
    expect(m.jitter.p50).toBeCloseTo(0.4, 9)
    expect(m.jitter.max).toBeCloseTo(0.4, 9)
  })

  it('a few dropped frames raise the max but not the p95; many fail the gate', () => {
    const few = grid(200, P120).filter((_, i) => i !== 50 && i !== 120) // two dropped frames
    const m = frameMetrics(few)
    expect(m.jitter.max).toBeCloseTo(P120, 9)
    expect(m.jitter.p95).toBeLessThan(1e-9)
    expect(passes(m.jitter)).toBe(true)
    const many = grid(300, P120).filter((_, i) => i % 10 !== 5) // every 10th frame dropped
    expect(passes(frameMetrics(many).jitter)).toBe(false)
  })

  it('needs at least 60 positive deltas (the §11.6 refresh estimate)', () => {
    expect(() => frameMetrics(grid(30, P120))).toThrow(RangeError)
  })

  it('counts a repeated timestamp (a stale frame time) as a full period of jitter instead of failing', () => {
    const ts = grid(121, P120)
    ts.splice(1, 0, ts[0] as number) // Chromium can stamp the first frames after idle with one time
    const m = frameMetrics(ts)
    expect(m.repeated).toBe(1)
    expect(m.refresh).toMatchObject({ hz: 120, n_deltas: 120 })
    expect(m.interval.n).toBe(121)
    expect(m.jitter.max).toBeCloseTo(P120, 9)
    expect(passes(m.jitter)).toBe(true)
  })

  it('a timestamp that goes backwards is an error', () => {
    const ts = grid(80, P120)
    ts[40] = 0
    expect(() => frameMetrics(ts)).toThrow(/backwards/)
    expect(() => frameMetrics([0, Number.NaN, ...grid(70, P120)])).toThrow(RangeError)
  })
})

describe('timer resolution', () => {
  it('keeps only positive increments', () => {
    expect(timerIncrements([1, 1, 1.1, 1.1, 1.1, 2.1, 5])).toEqual([1.1 - 1, 2.1 - 1.1, 5 - 2.1])
    expect(timerIncrements([3])).toEqual([])
    expect(() => timerIncrements([2, 1])).toThrow(RangeError)
  })

  it('sampleTimer finds the granularity of a coarse clock', () => {
    const inc = sampleTimer(new SteppingClock(1, 50), 20)
    expect(inc).toHaveLength(20)
    expect(summarize(inc)).toMatchObject({ p50: 1, p95: 1, max: 1 })
    const fine = sampleTimer(new SteppingClock(0.005, 3), 100)
    expect(summarize(fine).p95).toBeCloseTo(0.005, 12)
  })

  it('stops at the budget or read cap; a frozen clock yields nothing', () => {
    expect(sampleTimer(new SteppingClock(0, 1), 10, { maxReads: 1000 })).toEqual([])
    const budget = sampleTimer(new SteppingClock(10, 1), 1000, { budgetMs: 100 })
    expect(budget.length).toBe(10)
    expect(() => sampleTimer(new SteppingClock(1, 1), 0)).toThrow(RangeError)
  })

  it('a clock that goes backwards is an error', () => {
    let t = 10
    expect(() => sampleTimer({ now: () => (t -= 1) }, 5)).toThrow(/backwards/)
  })
})

describe('onset scheduling error (§11.6 item 1)', () => {
  it('on a regular grid the stimulus is in the scheduled frame: error 0, lag < one period', () => {
    const t: OnsetTrial = { prevFrameTs: 100, target: 103, onsetFrameTs: 100 + P120 }
    expect(scheduledFrameTs(t, P120)).toBeCloseTo(100 + P120, 12)
    const m = onsetMetrics([t], P120)
    expect(m.error.max).toBeCloseTo(0, 9)
    expect(m.lag.max).toBeCloseTo(P120 - 3, 9)
  })

  it('a frame dropped after the target costs one period', () => {
    const t: OnsetTrial = { prevFrameTs: 100, target: 103, onsetFrameTs: 100 + 2 * P120 }
    expect(onsetMetrics([t], P120).error.max).toBeCloseTo(P120, 9)
  })

  it('a frame dropped before the target costs nothing (the stimulus is in the first refresh ≥ target)', () => {
    const t: OnsetTrial = { prevFrameTs: 100, target: 100 + P120 + 1, onsetFrameTs: 100 + 2 * P120 }
    expect(onsetMetrics([t], P120).error.max).toBeCloseTo(0, 9)
  })

  it('a late frame whose target fell in its lateness is on time, not a frame early', () => {
    const t: OnsetTrial = { prevFrameTs: 100, target: 100 + P120 + 0.2, onsetFrameTs: 100 + P120 + 0.5 }
    expect(scheduledFrameTs(t, P120)).toBeCloseTo(100 + P120, 12)
    expect(onsetMetrics([t], P120).error.max).toBeCloseTo(0.5, 9)
  })

  it('property: on a periodic grid with dropped frames, error = the refreshes dropped at or after the target', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom(60, 120, 144),
        (phase, droppedBefore, droppedAfter, hz) => {
          const period = 1000 / hz
          const prev = 500
          // The target falls `droppedBefore` refreshes after prev (those refreshes produced no frame), plus a phase.
          const target = prev + (droppedBefore + phase) * period
          const onset = prev + (droppedBefore + 1 + droppedAfter) * period
          const err = Math.abs(onset - scheduledFrameTs({ prevFrameTs: prev, target, onsetFrameTs: onset }, period))
          expect(err).toBeCloseTo(droppedAfter * period, 6)
        },
      ),
    )
  })

  it('rejects inconsistent trials and bad periods', () => {
    expect(() => scheduledFrameTs({ prevFrameTs: 5, target: 5, onsetFrameTs: 10 }, P120)).toThrow(RangeError)
    expect(() => scheduledFrameTs({ prevFrameTs: 0, target: 11, onsetFrameTs: 10 }, P120)).toThrow(RangeError)
    expect(() => scheduledFrameTs({ prevFrameTs: 0, target: 1, onsetFrameTs: 10 }, 0)).toThrow(RangeError)
  })

  it('onsetDelays spreads targets over the refresh cycle, deterministically, ≥ 350 ms apart', () => {
    const d = onsetDelays(30)
    expect(d).toEqual(onsetDelays(30))
    for (const x of d) {
      expect(x).toBeGreaterThanOrEqual(ONSET_DELAY_MIN_MS)
      expect(x).toBeLessThan(ONSET_DELAY_MIN_MS + ONSET_DELAY_SPAN_MS)
    }
    const phases = new Set(d.map((x) => Math.floor((x % P120) / (P120 / 4))))
    expect(phases.size).toBe(4) // every quarter of a 120 Hz frame is hit
    expect(() => onsetDelays(0)).toThrow(RangeError)
  })
})

describe('runOnsetTrials through the production scheduler', () => {
  it('records the onset frame and the frame before the target on a clean 120 Hz stream', async () => {
    const frames = new FakeFrames()
    let t = 0
    const shown: number[] = []
    const started: number[] = []
    const delays = onsetDelays(6)
    const run = runOnsetTrials(frames, delays, { onOnset: (i, ts) => shown.push(i, ts), onTrialStart: (i) => started.push(i) })
    let done = false
    void run.then(() => (done = true))
    await pump(frames, () => (t += P120), () => done)
    const trials = await run
    expect(trials).toHaveLength(6)
    expect(started).toEqual([0, 1, 2, 3, 4, 5])
    for (const [i, tr] of trials.entries()) {
      expect(tr.prevFrameTs).toBeLessThan(tr.target)
      expect(tr.onsetFrameTs).toBeGreaterThanOrEqual(tr.target)
      expect(tr.onsetFrameTs - tr.prevFrameTs).toBeCloseTo(P120, 9)
      expect(shown[2 * i]).toBe(i)
      expect(shown[2 * i + 1]).toBe(tr.onsetFrameTs)
    }
    const m = onsetMetrics(trials, P120)
    expect(m.error.max).toBeLessThan(1e-6)
    expect(m.lag.max).toBeLessThan(P120)
    expect(frames.pendingCount).toBe(0)
  })

  it('a stalled main thread (dropped frames) shows up as onset error', async () => {
    const frames = new FakeFrames()
    let t = 0
    let n = 0
    // Every 7th refresh is skipped (no callback), as when a long task blocks the main thread.
    const next = (): number => {
      t += P120
      if (++n % 7 === 0) t += P120
      return t
    }
    const run = runOnsetTrials(frames, onsetDelays(20))
    let done = false
    void run.then(() => (done = true))
    await pump(frames, next, () => done)
    const m = onsetMetrics(await run, P120)
    expect(m.error.max).toBeCloseTo(P120, 6)
    expect(m.error.p50).toBeLessThan(1e-6)
  })

  it('rejects non-positive delays', async () => {
    await expect(runOnsetTrials(new FakeFrames(), [0])).rejects.toThrow(RangeError)
  })
})

describe('collectFrames', () => {
  it('captures n + 1 consecutive timestamps', async () => {
    const frames = new FakeFrames()
    let t = 0
    const run = collectFrames(frames, 60)
    let done = false
    void run.then(() => (done = true))
    await pump(frames, () => (t += P120), () => done)
    const ts = await run
    expect(ts).toHaveLength(61)
    expect(ts[0]).toBeCloseTo((WARMUP_FRAMES + 1) * P120, 9) // the warm-up frames are dropped
    expect(frameMetrics(ts).refresh.hz).toBe(120)
    await expect(collectFrames(frames, 0)).rejects.toThrow(RangeError)
    await expect(collectFrames(frames, 60, -1)).rejects.toThrow(RangeError)
  })
})

describe('input event latency', () => {
  it('is |handler − event.timeStamp| on the performance.now() timeline', () => {
    const s: InputSample[] = [
      { eventTs: 100, handlerTs: 100.4 },
      { eventTs: 200, handlerTs: 201 },
      { eventTs: 300, handlerTs: 300 },
    ]
    const l = inputLatency(s)
    expect(l).toMatchObject({ n: 3, max: 1 })
    expect(l?.p50).toBeCloseTo(0.4, 9)
    expect(inputLatency([])).toBeNull()
  })

  it('an epoch-based event.timeStamp is unsupported, not a huge latency', () => {
    expect(isHighResEventTs(1.7e12, 5000)).toBe(false)
    expect(isHighResEventTs(4999.5, 5000)).toBe(true)
    expect(inputLatency([{ eventTs: 1.7e12, handlerTs: 5000 }])).toBeNull()
  })

  it('sampleEvent reads the clock for the handler time', () => {
    expect(sampleEvent({ timeStamp: 12.5 }, { now: () => 13 })).toEqual({ eventTs: 12.5, handlerTs: 13 })
  })
})

describe('report and verdict', () => {
  const base = (over: Partial<SelfTestMeasurements> = {}): SelfTestMeasurements => ({
    quick: false,
    frameTimestamps: grid(241, P120),
    timerIncrements: Array<number>(100).fill(0.1),
    onsets: onsetDelays(10).map((d, i) => {
      const prev = 1000 * i
      const target = prev + (d % P120) // a phase within the frame
      return { prevFrameTs: prev, target: Math.max(target, prev + 0.01), onsetFrameTs: prev + P120 }
    }),
    keys: [{ eventTs: 10, handlerTs: 10.3 }],
    pointers: [{ eventTs: 20, handlerTs: 20.6 }],
    context: { cross_origin_isolated: false, hidden_during_run: false, device_pixel_ratio: 2 },
    ...over,
  })

  it('a clean run passes, with every metric reported', () => {
    const r = buildReport(base())
    expect(r.report_version).toBe(SELFTEST_REPORT_VERSION)
    expect(r.threshold_ms).toBe(5)
    expect(r.refresh).toMatchObject({ hz: 120, repeated_timestamps: 0 })
    expect(r.pass).toBe(true)
    for (const k of GATED_METRICS) expect(r.metrics[k].pass, k).toBe(true)
    expect(r.metrics.key_latency_ms.pass).toBeNull()
    expect(r.metrics.pointer_latency_ms.pass).toBeNull()
    expect(r.metrics.raf_interval_ms.pass).toBeNull()
    expect(r.metrics.onset_lag_ms.pass).toBeNull()
    expect(JSON.parse(reportJson(r))).toEqual(r)
  })

  it('skipped input phases are reported but do not fail the run', () => {
    const r = buildReport(base({ keys: null, pointers: [] }))
    expect(r.metrics.key_latency_ms).toEqual({ summary: null, pass: null, note: 'skipped' })
    expect(r.metrics.pointer_latency_ms).toMatchObject({ summary: null, pass: null, note: 'no events' })
    expect(r.pass).toBe(true)
  })

  it('slow input handling is reported but informational: it does not fail the run', () => {
    const slow = Array.from({ length: 20 }, (_, i) => ({ eventTs: i * 100, handlerTs: i * 100 + 12 }))
    const r = buildReport(base({ pointers: slow, keys: slow }))
    for (const k of ['key_latency_ms', 'pointer_latency_ms'] as const) {
      expect(r.metrics[k].pass, k).toBeNull()
      expect(r.metrics[k].summary?.p95, k).toBeCloseTo(12, 9)
      expect(r.metrics[k].note, k).toBe(INPUT_LATENCY_NOTE)
    }
    expect(r.metrics.key_latency_ms.note).toMatch(/event timestamp/)
    expect(r.pass).toBe(true)
  })

  it('the overall verdict depends only on the jitter, timer and onset metrics', () => {
    expect([...GATED_METRICS]).toEqual(['raf_jitter_ms', 'timer_resolution_ms', 'onset_error_ms'])
    const late = base().onsets.map((o) => ({ ...o, onsetFrameTs: o.onsetFrameTs + 3 * P120 }))
    expect(buildReport(base({ onsets: late })).pass).toBe(false)
  })

  it('a clock that never advanced fails (the required metrics must be measured)', () => {
    const r = buildReport(base({ timerIncrements: [] }))
    expect(r.metrics.timer_resolution_ms).toMatchObject({ summary: null, pass: null })
    expect(r.pass).toBe(false)
  })

  it('a 1 ms timer (Safari-style coarsening) still passes the 5 ms bar', () => {
    expect(buildReport(base({ timerIncrements: Array<number>(50).fill(1) })).metrics.timer_resolution_ms.pass).toBe(true)
  })

  it('property: pass ⇔ the timer p95 < 5 ms, whatever the (informational) input latency', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 12, noNaN: true }), fc.double({ min: 0.001, max: 12, noNaN: true }), fc.boolean(), (lat, tick, skip) => {
        const keys = skip ? null : Array.from({ length: 10 }, (_, i) => ({ eventTs: i * 100, handlerTs: i * 100 + lat }))
        const r = buildReport(base({ keys, timerIncrements: Array<number>(20).fill(tick) }))
        const expected = tick < 5
        expect(r.pass).toBe(expected)
      }),
    )
  })

  it('the default plan meets the §11.6 refresh minimum and keeps flashes ≤ 3/s', () => {
    for (const p of [DEFAULT_PLAN, QUICK_PLAN]) {
      expect(p.frames).toBeGreaterThanOrEqual(60)
      expect(p.onsets).toBeGreaterThanOrEqual(1)
      expect(p.presses).toBeGreaterThanOrEqual(1)
    }
    expect(1000 / ONSET_DELAY_MIN_MS).toBeLessThanOrEqual(3)
  })
})
