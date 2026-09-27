/**
 * Timing utilities for RT blocks (DESIGN §11.6; ROADMAP M1.10, M1.23). Pure functions over an
 * injectable clock and frame source, so they are unit-tested without a browser:
 *
 * - refresh rate (§11.6 item 2): the median of ≥ 60 requestAnimationFrame deltas → Hz, snapped
 *   to a common rate (60, 75, 90, 120, 144, 165 or 240 Hz) when within 3%;
 * - rAF-locked onset (§11.6 item 1): a stimulus scheduled `onsetAfterMs` after the frame at
 *   `rafNow` appears in the first frame whose timestamp is ≥ rafNow + onsetAfterMs; the
 *   `onOnset` callback runs synchronously inside that frame's callback so the stimulus is drawn
 *   in that very frame, and the onset time is that frame's timestamp;
 * - RT = response timestamp − onset frame timestamp, where the response timestamp comes from
 *   `performance.now()` (the monotonic high-resolution clock that rAF and event timestamps
 *   share). The wall clock is never used: it is coarse and jumps when the system clock is set.
 *   A press before the onset frame has run is an anticipation (negative RT), even when it comes
 *   after the target time ({@link responseRtMs}).
 */

import { median } from './score'

/** A monotonic millisecond clock; {@link performanceClock} in the browser, a fake in tests. */
export interface Clock {
  now(): number
}

/** `performance.now()`. */
export const performanceClock: Clock = Object.freeze({ now: () => performance.now() })

/** The response timestamp for an input event handled now (§11.6: performance.now()). */
export function responseTimestamp(clock: Clock = performanceClock): number {
  return clock.now()
}

export type FrameCallback = (timestamp: number) => void

/** requestAnimationFrame / cancelAnimationFrame, injectable. */
export interface FrameSource {
  request(cb: FrameCallback): number
  cancel(handle: number): void
}

/** The minimal window surface {@link browserFrameSource} needs. */
export interface AnimationFrameHost {
  requestAnimationFrame(cb: FrameCallback): number
  cancelAnimationFrame(handle: number): void
}

/** The browser's rAF as a {@link FrameSource} (pass a host to wrap something other than `globalThis`). */
export function browserFrameSource(host: AnimationFrameHost = globalThis as unknown as AnimationFrameHost): FrameSource {
  return { request: (cb) => host.requestAnimationFrame(cb), cancel: (h) => host.cancelAnimationFrame(h) }
}

// ------------------------------------------------------------------------------ refresh rate

/** Display rates an estimate snaps to (§11.6). */
export const COMMON_REFRESH_RATES_HZ: readonly number[] = Object.freeze([60, 75, 90, 120, 144, 165, 240])
/** Snap when |raw − rate| / rate ≤ this. */
export const REFRESH_SNAP_TOLERANCE = 0.03
/** Fewest frame deltas an estimate uses (§11.6: "measured from 60 rAF deltas"). */
export const MIN_REFRESH_DELTAS = 60

export interface RefreshEstimate {
  /** The snapped common rate, or the raw rate rounded to 0.1 Hz. */
  readonly hz: number
  readonly snapped: boolean
  /** 1000 / median delta. */
  readonly raw_hz: number
  readonly median_delta_ms: number
  readonly n_deltas: number
}

/** Consecutive differences of frame timestamps; throws a RangeError unless they are finite and strictly increasing. */
export function frameDeltas(timestamps: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i] as number
    if (!Number.isFinite(t)) throw new RangeError(`frameDeltas(): timestamp ${i} is not finite`)
    if (i > 0) {
      const d = t - (timestamps[i - 1] as number)
      if (!(d > 0)) throw new RangeError(`frameDeltas(): timestamps must strictly increase (index ${i})`)
      out.push(d)
    }
  }
  return out
}

/** The nearest common rate if within {@link REFRESH_SNAP_TOLERANCE}, else the raw rate to 0.1 Hz. */
export function snapRefreshRate(rawHz: number): { hz: number; snapped: boolean } {
  if (!(Number.isFinite(rawHz) && rawHz > 0)) throw new RangeError(`snapRefreshRate(): rate must be finite and > 0, got ${rawHz}`)
  let best: number | undefined
  let bestRel = Infinity
  for (const r of COMMON_REFRESH_RATES_HZ) {
    const rel = Math.abs(rawHz - r) / r
    if (rel < bestRel) {
      best = r
      bestRel = rel
    }
  }
  return best !== undefined && bestRel <= REFRESH_SNAP_TOLERANCE ? { hz: best, snapped: true } : { hz: Math.round(rawHz * 10) / 10, snapped: false }
}

/**
 * Refresh rate from ≥ {@link MIN_REFRESH_DELTAS} rAF deltas in ms: 1000 / median delta, snapped
 * ({@link snapRefreshRate}). The median ignores dropped frames and the odd long delta.
 */
export function estimateRefreshRate(deltasMs: readonly number[]): RefreshEstimate {
  if (deltasMs.length < MIN_REFRESH_DELTAS) {
    throw new RangeError(`estimateRefreshRate(): need ≥ ${MIN_REFRESH_DELTAS} frame deltas, got ${deltasMs.length}`)
  }
  for (const d of deltasMs) {
    if (!(Number.isFinite(d) && d > 0)) throw new RangeError(`estimateRefreshRate(): deltas must be finite and > 0, got ${d}`)
  }
  const med = median(deltasMs)
  const raw = 1000 / med
  return { ...snapRefreshRate(raw), raw_hz: raw, median_delta_ms: med, n_deltas: deltasMs.length }
}

/** Collect `nDeltas` + 1 consecutive frames from `frames` and estimate the refresh rate. */
export function measureRefreshRate(frames: FrameSource, nDeltas = MIN_REFRESH_DELTAS): Promise<RefreshEstimate> {
  if (!(Number.isInteger(nDeltas) && nDeltas >= MIN_REFRESH_DELTAS)) {
    return Promise.reject(new RangeError(`measureRefreshRate(): nDeltas must be an integer ≥ ${MIN_REFRESH_DELTAS}`))
  }
  return new Promise((resolve, reject) => {
    const stamps: number[] = []
    const tick = (ts: number): void => {
      stamps.push(ts)
      if (stamps.length <= nDeltas) {
        frames.request(tick)
        return
      }
      try {
        resolve(estimateRefreshRate(frameDeltas(stamps)))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    frames.request(tick)
  })
}

// ------------------------------------------------------------------------------ onset and RT

/** The onset target time rafNow + onsetAfterMs; throws a RangeError on non-finite or negative inputs. */
export function onsetTarget(onsetAfterMs: number, rafNow: number): number {
  if (!(Number.isFinite(onsetAfterMs) && onsetAfterMs >= 0)) throw new RangeError(`onsetAfterMs must be finite and ≥ 0, got ${onsetAfterMs}`)
  if (!Number.isFinite(rafNow)) throw new RangeError(`rafNow must be finite, got ${rafNow}`)
  return rafNow + onsetAfterMs
}

/** A frame is the onset frame iff its timestamp is ≥ the target. */
export function isOnsetFrame(frameTs: number, target: number): boolean {
  return frameTs >= target
}

/** Pure form of the scheduling rule: the first timestamp ≥ target in a list of frame timestamps, or null. */
export function firstFrameAtOrAfter(frameTimestamps: readonly number[], target: number): number | null {
  for (const ts of frameTimestamps) if (isOnsetFrame(ts, target)) return ts
  return null
}

/** One scheduled stimulus onset. */
export interface ScheduledOnset {
  /** rafNow + onsetAfterMs. */
  readonly target: number
  /** Timestamp of the frame the stimulus appeared in; null before that (or after a cancel). */
  readonly onsetFrameTs: number | null
  readonly cancelled: boolean
  /** Stop a pending onset (e.g. after an anticipation); no effect once the stimulus is shown. */
  cancel(): void
}

export interface OnsetScheduler {
  /**
   * Show a stimulus in the first frame whose timestamp is ≥ rafNow + onsetAfterMs: `onOnset`
   * runs synchronously in that frame's callback with the frame timestamp.
   */
  schedule(onsetAfterMs: number, rafNow: number, onOnset: (onsetFrameTs: number) => void): ScheduledOnset
}

/** The rAF-locked onset scheduler over a frame source (§11.6 item 1). */
export function createOnsetScheduler(frames: FrameSource): OnsetScheduler {
  return {
    schedule(onsetAfterMs, rafNow, onOnset) {
      const target = onsetTarget(onsetAfterMs, rafNow)
      let handle: number | null = null
      let onsetFrameTs: number | null = null
      let cancelled = false
      const tick = (ts: number): void => {
        handle = null
        if (cancelled) return
        if (isOnsetFrame(ts, target)) {
          onsetFrameTs = ts
          onOnset(ts)
        } else {
          handle = frames.request(tick)
        }
      }
      handle = frames.request(tick)
      return {
        target,
        get onsetFrameTs() {
          return onsetFrameTs
        },
        get cancelled() {
          return cancelled
        },
        cancel() {
          if (onsetFrameTs !== null || cancelled) return
          cancelled = true
          if (handle !== null) frames.cancel(handle)
          handle = null
        },
      }
    },
  }
}

/** RT in ms = response timestamp − onset frame timestamp (both on the performance.now() timeline). */
export function reactionTimeMs(responseTs: number, onsetFrameTs: number): number {
  if (!Number.isFinite(responseTs) || !Number.isFinite(onsetFrameTs)) throw new RangeError('reactionTimeMs(): timestamps must be finite')
  return responseTs - onsetFrameTs
}

/**
 * The largest RT {@link responseRtMs} records for a press before the onset frame: strictly
 * negative, and still negative on the 0.1 ms grid, so such a press is always an anticipation.
 */
export const PRE_ONSET_MAX_RT_MS = -0.1

/**
 * The RT to record for a response at `responseTs` to a scheduled onset (§11.6). Once the
 * stimulus is shown: response timestamp − onset frame timestamp. Before that, the stimulus has
 * not been drawn, so the press is an anticipation (§7.1) and the RT is negative whatever the
 * clock says: responseTs − target when the press precedes the target, else
 * {@link PRE_ONSET_MAX_RT_MS}. The second case is a press after the target whose onset frame has
 * not run yet (the sub-frame gap before the next frame, or a stalled main thread: GC, a long
 * task); measuring it from the target would give it a positive RT and could score it as valid.
 */
export function responseRtMs(onset: ScheduledOnset, responseTs: number): number {
  const shownAt = onset.onsetFrameTs
  if (shownAt !== null) return reactionTimeMs(responseTs, shownAt)
  return Math.min(reactionTimeMs(responseTs, onset.target), PRE_ONSET_MAX_RT_MS)
}
