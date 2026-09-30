import { describe, expect, it } from 'vitest'
import type { RendererTiming } from '../render/common/props'
import { FAST_FACTOR } from './constants'
import { FAST_BANNER, parseFast, scaleNow, scaleTiming, sessionTimeScale } from './fast'

describe('the ?fast=1 dev flag (M1.15)', () => {
  it('parses fast=1 and fast=true into the factor, anything else into 1', () => {
    expect(parseFast('?fast=1')).toBe(FAST_FACTOR)
    expect(parseFast('?a=b&fast=true')).toBe(FAST_FACTOR)
    for (const q of ['', '?fast=0', '?fast=', '?fast=yes', '?fast=2', '?slow=1', '?FAST=1']) expect(parseFast(q), q).toBe(1)
  })

  it('is honoured where the dev constant is on (dev server, tests, the e2e build) and ignored where it is off', () => {
    // In this test run __HB_DEV_ROUTES__ is true (vite.config.ts `define`); the production build folds it to
    // false, which scripts/dev-routes.test.ts checks by building the module both ways and running it.
    expect(__HB_DEV_ROUTES__).toBe(true)
    expect(sessionTimeScale('?fast=1')).toBe(FAST_FACTOR)
    expect(sessionTimeScale('')).toBe(1)
  })

  it('says in plain words that response times in fast mode are not valid scores', () => {
    expect(FAST_BANNER).toMatch(/development only/)
    expect(FAST_BANNER).toMatch(/not valid scores/)
  })

  it('scales the session timeline: now × factor; factor 1 is the same function', () => {
    let t = 1000
    const now = () => t
    expect(scaleNow(now, 1)).toBe(now)
    const fast = scaleNow(now, FAST_FACTOR)
    expect(fast()).toBe(1000 * FAST_FACTOR)
    t = 2000
    expect(fast()).toBe(2000 * FAST_FACTOR)
  })

  it('scales the renderers’ frames and clock the same way, and leaves cancel alone', () => {
    let t = 500
    const cancelled: number[] = []
    let cb: ((ts: number) => void) | null = null
    const base: RendererTiming = {
      frames: {
        request: (fn) => {
          cb = fn
          return 7
        },
        cancel: (h) => void cancelled.push(h),
      },
      clock: { now: () => t },
    }
    expect(scaleTiming(base, 1)).toBe(base)
    const fast = scaleTiming(base, 20)
    const seen: number[] = []
    expect(fast.frames.request((ts) => seen.push(ts))).toBe(7)
    cb!(100)
    expect(seen).toEqual([2000])
    expect(fast.clock.now()).toBe(10_000)
    fast.frames.cancel(7)
    expect(cancelled).toEqual([7])
  })

  it('refuses a factor below 1 or not finite', () => {
    for (const k of [0, 0.5, -1, Number.NaN, Infinity]) {
      expect(() => scaleNow(() => 0, k)).toThrow(RangeError)
      expect(() => scaleTiming({ frames: { request: () => 0, cancel: () => undefined }, clock: { now: () => 0 } }, k)).toThrow(RangeError)
    }
  })
})
