/**
 * What the session flow needs from the browser, in one injectable object (ROADMAP M1.15), so the
 * screens run in jsdom tests on fake clocks and storage. {@link browserSessionEnv} is the real
 * thing: `performance.now()` and animation frames (scaled by the `?fast=1` factor in dev builds,
 * `fast.ts`), lazy `localStorage` (touched only after the 18+ gate), the wall clock for save
 * metadata and the device facts.
 */

import { pageBackend, type Backend } from '../backend/backend'
import type { RendererTiming } from '../render/common/props'
import { browserStorage, type StorageLike } from '../save/autosave'
import { wallClockMs } from '../save/clock'
import { browserFrameSource, performanceClock, type Clock, type FrameSource } from '../tasks/rt/timing'
import type { NowMs } from './clock'
import { browserDeviceEnv, type DeviceEnv } from './device'
import { scaleNow, scaleTiming, sessionTimeScale } from './fast'

export interface SessionEnv {
  /** The `?fast=1` factor (1 in production). */
  readonly scale: number
  /** The session timeline: `performance.now()` × scale. */
  readonly now: NowMs
  /** rAF + clock on the same timeline, for the block renderers. */
  readonly timing: RendererTiming
  /** Real (unscaled) frames and clock, for the device check. */
  readonly realFrames: FrameSource
  readonly realClock: Clock
  /** localStorage, or null when unavailable. Called only after the person passed the gate. */
  readonly storage: () => StorageLike | null
  /** Wall-clock epoch ms (save metadata only). */
  readonly wallClockMs: () => number
  readonly device: () => DeviceEnv
  /**
   * The server (ROADMAP M2.7), or null/absent for the static fallback, which is the default build:
   * then the session runs, scores and saves entirely on the device, as in M1.
   */
  readonly backend?: Backend | null
}

export function browserSessionEnv(scale: number = sessionTimeScale()): SessionEnv {
  const realFrames = browserFrameSource()
  return {
    scale,
    now: scaleNow(() => performance.now(), scale),
    timing: scaleTiming({ frames: realFrames, clock: performanceClock }, scale),
    realFrames,
    realClock: performanceClock,
    storage: () => browserStorage(),
    wallClockMs,
    device: browserDeviceEnv,
    backend: pageBackend(),
  }
}
