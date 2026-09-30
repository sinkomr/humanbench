/**
 * The `?fast=1` dev flag (ROADMAP M1.15: "compresses timings; production builds ignore it").
 *
 * It scales the session timeline: every duration the session and its renderers measure (the block
 * trials, item times, the 30-minute break, the 57-minute hard stop, the item caps) runs
 * {@link FAST_FACTOR} times faster than real time, because the session reads `performance.now()`
 * and the animation-frame timestamps through {@link scaleNow} and {@link scaleTiming}. The rules
 * themselves (thresholds, order, floors) are unchanged, so a bot can walk a whole session in a
 * couple of minutes (M1.22). Response times measured this way are not valid scores.
 *
 * The flag exists only where the build-time constant `__HB_DEV_ROUTES__` (vite.config.ts) is true:
 * `vite` dev, tests and the Playwright build. A plain production build folds `sessionTimeScale` to
 * 1, drops this module's parser and banner from the bundle, and ignores the query
 * (`scripts/dev-routes.test.ts` builds it and evaluates it).
 */

import { browserFrameSource, performanceClock, type Clock, type FrameSource } from '../tasks/rt/timing'
import type { RendererTiming } from '../render/common/props'
import { FAST_FACTOR } from './constants'
import type { NowMs } from './clock'

/** Text of the dev banner; present in the bundle only when the flag can be on. */
export const FAST_BANNER = 'Fast mode (development only): timings run 20 times faster. Response times are not valid scores.'

/** The scale a query string asks for: {@link FAST_FACTOR} for `fast=1` (or `fast=true`), else 1. */
export function parseFast(search: string): number {
  const v = new URLSearchParams(search).get('fast')
  return v === '1' || v === 'true' ? FAST_FACTOR : 1
}

/**
 * The session time scale: 1 in a production build whatever the query says, else what `search`
 * asks for. `__HB_DEV_ROUTES__` is a build-time constant, so the production branch is dead code.
 */
export function sessionTimeScale(search: string = typeof location === 'undefined' ? '' : location.search): number {
  return __HB_DEV_ROUTES__ ? parseFast(search) : 1
}

/** `now` scaled by `factor` (1 returns it unchanged). */
export function scaleNow(now: NowMs, factor: number): NowMs {
  if (!(Number.isFinite(factor) && factor >= 1)) throw new RangeError(`time scale must be a finite number ≥ 1, got ${factor}`)
  return factor === 1 ? now : () => now() * factor
}

function scaleFrames(frames: FrameSource, factor: number): FrameSource {
  return factor === 1 ? frames : { request: (cb) => frames.request((ts) => cb(ts * factor)), cancel: (h) => frames.cancel(h) }
}

function scaleClock(clock: Clock, factor: number): Clock {
  return factor === 1 ? clock : { now: () => clock.now() * factor }
}

/** The renderers' timing (rAF frames and clock) on the same scaled timeline as {@link scaleNow}. */
export function scaleTiming(base: RendererTiming, factor: number): RendererTiming {
  if (!(Number.isFinite(factor) && factor >= 1)) throw new RangeError(`time scale must be a finite number ≥ 1, got ${factor}`)
  return factor === 1 ? base : { frames: scaleFrames(base.frames, factor), clock: scaleClock(base.clock, factor) }
}

/** The browser's timing on the timeline of `factor` (rAF + `performance.now()` × factor). */
export function browserScaledTiming(factor: number): RendererTiming {
  return scaleTiming({ frames: browserFrameSource(), clock: performanceClock }, factor)
}
