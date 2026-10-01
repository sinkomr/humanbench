import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cpuMs, judgedMs, median } from './bench-support'

describe('bench support (a benchmark must not fail because the machine is busy)', () => {
  it('takes the middle timing, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(() => median([])).toThrow(RangeError)
  })

  it('the median is between the least and the greatest timing, whatever the order', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 40 }), (xs) => {
        const m = median(xs)
        expect(m).toBeGreaterThanOrEqual(Math.min(...xs))
        expect(m).toBeLessThanOrEqual(Math.max(...xs))
        expect(median([...xs].reverse())).toBe(m)
      }),
    )
  })

  it('judges the CPU time per run when waiting for a core inflated the wall time, and the wall time when it is the smaller', () => {
    // 20 runs used 100 ms of CPU: 5 ms each, though the wall median says 43 ms (the process waited for a core).
    expect(judgedMs(43, 1000, 1100, 20)).toBe(5)
    // CPU time can exceed wall time per run (other threads): the wall median is the smaller.
    expect(judgedMs(3, 1000, 1400, 20)).toBe(3)
  })

  it('falls back to the wall time without CPU readings', () => {
    expect(judgedMs(43, null, 10, 20)).toBe(43)
    expect(judgedMs(43, 10, null, 20)).toBe(43)
    expect(judgedMs(43, 10, 20, 0)).toBe(43)
  })

  it('reads this process CPU time, which never goes backwards', () => {
    const a = cpuMs()
    expect(a === null || a >= 0).toBe(true)
    let x = 0
    for (let i = 0; i < 1e6; i++) x += Math.sqrt(i)
    const b = cpuMs()
    expect(x).toBeGreaterThan(0)
    if (a !== null && b !== null) expect(b).toBeGreaterThanOrEqual(a)
  })
})
