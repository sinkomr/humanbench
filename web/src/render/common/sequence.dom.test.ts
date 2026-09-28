/**
 * rAF-locked sequences (ROADMAP M1.13; DESIGN §11.6 item 1): each element shows in the first frame
 * at or after its onset, for at least on_ms, with at least off_ms blank between elements, on any
 * frame rate; cancelling stops every callback.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { afterFrames, presentSequence } from './sequence'
import { fakeDisplay } from './testing'

describe('presentSequence', () => {
  it('shows, hides and finishes in order with the right durations (property over frame rates and timings)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(60, 90, 120, 144, 30),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 50, max: 900 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 800 }),
        (hz, count, on, off, lead) => {
          const frame = 1000 / hz
          const d = fakeDisplay(frame)
          const log: [string, number, number][] = []
          const start = d.now()
          presentSequence(d.frames, count, { on_ms: on, off_ms: off }, {
            show: (i, ts) => log.push(['show', i, ts]),
            hide: (i, ts) => log.push(['hide', i, ts]),
            done: (ts) => log.push(['done', -1, ts]),
          }, lead)
          d.advance(lead + count * (on + off) + 20 * frame + 100)
          expect(log.map(([k, i]) => `${k}${i}`)).toEqual([...Array.from({ length: count }, (_, i) => [`show${i}`, `hide${i}`]).flat(), 'done-1'])
          if (count === 0) return
          const first = log[0]?.[2] ?? 0
          expect(first).toBeGreaterThanOrEqual(start + frame + lead - 1e-6)
          expect(first).toBeLessThan(start + 2 * frame + lead + 1e-6)
          for (let k = 1; k < log.length - 1; k++) {
            const [kind, , ts] = log[k] as [string, number, number]
            const prev = (log[k - 1] as [string, number, number])[2]
            const min = kind === 'hide' ? on : off
            expect(ts - prev).toBeGreaterThanOrEqual(min - 1e-6)
            expect(ts - prev).toBeLessThan(min + frame + 1e-6)
          }
        },
      ),
      { numRuns: 120 },
    )
  })

  it('cancel stops the sequence at once', () => {
    const d = fakeDisplay()
    const log: string[] = []
    const run = presentSequence(d.frames, 5, { on_ms: 100, off_ms: 100 }, { show: (i) => log.push(`s${i}`), hide: (i) => log.push(`h${i}`), done: () => log.push('done') })
    d.advance(250)
    run.cancel()
    d.advance(5000)
    expect(log).toEqual(['s0', 'h0', 's1'])
    expect(d.pending()).toBe(0)
  })

  it('rejects bad arguments', () => {
    const d = fakeDisplay()
    const cb = { show: () => {}, hide: () => {}, done: () => {} }
    expect(() => presentSequence(d.frames, -1, { on_ms: 1, off_ms: 1 }, cb)).toThrow(RangeError)
    expect(() => presentSequence(d.frames, 1.5, { on_ms: 1, off_ms: 1 }, cb)).toThrow(RangeError)
    expect(() => presentSequence(d.frames, 1, { on_ms: -1, off_ms: 1 }, cb)).toThrow(RangeError)
    expect(() => presentSequence(d.frames, 1, { on_ms: 1, off_ms: Number.NaN }, cb)).toThrow(RangeError)
  })
})

describe('afterFrames', () => {
  it('runs once in the first frame at or after the delay, unless cancelled', () => {
    const d = fakeDisplay()
    const at: number[] = []
    afterFrames(d.frames, 500, (ts) => at.push(ts))
    const cancel = afterFrames(d.frames, 500, (ts) => at.push(-ts))
    cancel()
    d.advance(2000)
    expect(at).toHaveLength(1)
    const start = 1000 + 1000 / 60
    expect(at[0]).toBeGreaterThanOrEqual(start + 500 - 1e-6)
    expect(at[0]).toBeLessThan(start + 500 + 1000 / 60 + 1e-6)
  })
})
