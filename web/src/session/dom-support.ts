/**
 * Test-only helpers for the session flow's jsdom tests (ROADMAP M1.15): a storage that records every
 * call (to prove what the under-18 path does not write) and a fake {@link SessionEnv} on a fake
 * display. Imported only by `*.dom.test.ts` files.
 */

import type { Backend } from '../backend/backend'
import type { RendererTiming } from '../render/common/props'
import type { DeviceEnv } from './device'
import type { SessionEnv } from './env'
import { SpyStorage } from './bot'

export interface FakeEnv<D extends RendererTiming = RendererTiming> {
  readonly env: SessionEnv
  readonly storage: SpyStorage
  readonly display: D
  /** The session timeline in ms; set it to move the session clock. */
  readonly time: { ms: number }
}

export const DESKTOP: DeviceEnv = Object.freeze({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  maxTouchPoints: 0,
  coarsePointer: false,
  viewport: [1280, 800] as const,
})

export { SpyStorage }

/** The session's browser services on a fake display (pass `fakeDisplay()` from `render/common/testing`). */
export function fakeEnv<D extends RendererTiming>(display: D, over: { device?: DeviceEnv; storage?: SpyStorage; scale?: number; backend?: Backend | null } = {}): FakeEnv<D> {
  const storage = over.storage ?? new SpyStorage()
  const time = { ms: 0 }
  const env: SessionEnv = {
    scale: over.scale ?? 1,
    now: () => time.ms,
    timing: display,
    realFrames: display.frames,
    realClock: display.clock,
    storage: () => storage,
    wallClockMs: () => 1_790_000_000_000,
    device: () => over.device ?? DESKTOP,
    backend: over.backend ?? null,
  }
  return { env, storage, display, time }
}
