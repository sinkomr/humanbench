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
 * - RT = response timestamp − onset frame timestamp, where the response timestamp is the input
 *   event's own `timeStamp` when that is on the `performance.now()` timeline (the monotonic
 *   high-resolution clock that rAF and event timestamps share), so the delay between the input
 *   and the handler running is not added to the RT; otherwise `performance.now()` read in the
 *   handler ({@link responseTimestampFromEvent}). The wall clock is never used: it is coarse and
 *   jumps when the system clock is set.
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

/** Where a response timestamp came from: the event's own `timeStamp`, or the clock read in the handler. */
export type TimestampSource = 'event' | 'handler'

/** A response timestamp and its {@link TimestampSource}. */
export interface ResponseStamp {
  readonly ts: number
  readonly source: TimestampSource
}

/**
 * The most (ms) an event timestamp may lag the handler's clock reading and still be trusted as
 * the input's own time (§11.6). A genuine dispatch delay is a few ms (Chrome at 120 Hz measured
 * 1-7 ms, max 11), so 25 ms is about 3 frames at 120 Hz or 1.5 at 60 Hz: generous for a busy main
 * thread, far below a timeline offset. Safari (macOS, 60 Hz) measured a constant ~205 ms between
 * performance.now() and event.timeStamp, which is a clock offset, not delay; using that
 * timestamp would shorten every RT by ~200 ms. Beyond the bound the handler clock is used.
 */
export const MAX_EVENT_LAG_MS = 25

/**
 * Once a block has judged the event clock consistent ({@link BlockTimestampPolicy}), a single
 * late dispatch (a long task or GC pause) is real delay on a good clock, so the bound relaxes to
 * this sanity limit instead of switching that one response to the other clock.
 */
export const EVENT_TS_MAX_AGE_MS = 1000

/** How far (ms) before the reference time (the onset) an event timestamp may lie and still be trusted. */
export const EVENT_TS_PRE_ONSET_MARGIN_MS = 1000

/** now - event.timeStamp (ms) if the timestamp is a finite number > 0 (0 and NaN are synthetic events), else null. */
export function eventLagMs(event: { readonly timeStamp: number }, clock: Clock = performanceClock): number | null {
  const ts: unknown = event.timeStamp
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null
  return clock.now() - ts
}

/**
 * The response timestamp of an input event (§11.6). The event's own `timeStamp` is when the
 * browser received the input, before any main-thread queueing, so using it keeps the handler
 * dispatch delay out of the RT. It is used only when it is on the performance.now() timeline: a
 * finite number > 0, with 0 <= clock.now() - timeStamp <= `maxLagMs` ({@link MAX_EVENT_LAG_MS}),
 * and, when `notBefore` (the onset frame, or the target before it) is given, not more than
 * {@link EVENT_TS_PRE_ONSET_MARGIN_MS} before it. Epoch milliseconds (about 1.7e12), 0 and NaN
 * (synthetic events), a timeline with another origin or offset (Safari, about 205 ms) all fail
 * those checks and fall back to `clock.now()`.
 */
export function responseTimestampFromEvent(
  event: { readonly timeStamp: number },
  clock: Clock = performanceClock,
  notBefore?: number,
  maxLagMs: number = MAX_EVENT_LAG_MS,
): ResponseStamp {
  const now = clock.now()
  const ts: unknown = event.timeStamp
  if (
    typeof ts === 'number' &&
    Number.isFinite(ts) &&
    ts > 0 &&
    ts <= now &&
    now - ts <= maxLagMs &&
    (notBefore === undefined || !Number.isFinite(notBefore) || ts >= notBefore - EVENT_TS_PRE_ONSET_MARGIN_MS)
  ) {
    return { ts, source: 'event' }
  }
  return { ts: now, source: 'handler' }
}

/** Why a block uses the handler clock for every response. */
export type TimestampReason = 'event_clock_offset' | 'event_lag_high'

/** A block's clock decision: which source every response uses, and why when it is the handler. */
export interface BlockClockDecision {
  readonly source: 'event' | 'handler'
  readonly reason?: TimestampReason
  readonly median_lag_ms: number
  readonly n: number
}

/**
 * Fewest lag samples a decision needs. Practice has 3+ trials; one clean sample is not enough
 * to call a clock consistent, but any single sample far beyond the bound is not noise.
 */
export const MIN_LAG_SAMPLES = 2

/**
 * Per-block event-clock consistency check (§11.6). Feed it the lag (now - event.timeStamp) of the
 * practice or early responses ({@link observe}); {@link decide} then fixes the source for the
 * whole block: the handler clock if the median lag is outside [0, {@link MAX_EVENT_LAG_MS}]
 * ('event_clock_offset' when the lags are tightly clustered, i.e. a constant offset, else
 * 'event_lag_high'), otherwise the event clock. Undecided (too few samples) blocks use the
 * per-response rule of {@link responseTimestampFromEvent}, and report 'mixed' if both sources occur.
 */
export class BlockTimestampPolicy {
  #lags: number[] = []
  #decision: BlockClockDecision | null = null

  get decision(): BlockClockDecision | null {
    return this.#decision
  }

  /** Record the lag of an event (no-op once decided, and for events without a usable timestamp). */
  observe(event: { readonly timeStamp: number }, clock: Clock = performanceClock): void {
    if (this.#decision !== null) return
    const lag = eventLagMs(event, clock)
    if (lag !== null) this.#lags.push(lag)
  }

  /** Decide from the lags seen so far; null (still undecided) with fewer than {@link MIN_LAG_SAMPLES}. */
  decide(): BlockClockDecision | null {
    if (this.#decision !== null) return this.#decision
    const n = this.#lags.length
    if (n < MIN_LAG_SAMPLES) return null
    const med = median(this.#lags)
    if (med >= 0 && med <= MAX_EVENT_LAG_MS) {
      this.#decision = { source: 'event', median_lag_ms: med, n }
    } else {
      const spread = Math.max(...this.#lags) - Math.min(...this.#lags)
      const reason: TimestampReason = spread <= MAX_EVENT_LAG_MS ? 'event_clock_offset' : 'event_lag_high'
      this.#decision = { source: 'handler', reason, median_lag_ms: med, n }
    }
    return this.#decision
  }

  /** The response timestamp under the block's decision (per-response rule while undecided). */
  stamp(event: { readonly timeStamp: number }, clock: Clock = performanceClock, notBefore?: number): ResponseStamp {
    const d = this.#decision
    if (d === null) return responseTimestampFromEvent(event, clock, notBefore)
    if (d.source === 'handler') return { ts: clock.now(), source: 'handler' }
    return responseTimestampFromEvent(event, clock, notBefore, EVENT_TS_MAX_AGE_MS)
  }
}

/** The overall source of a block's timestamps: 'event', 'handler', or 'mixed'; undefined with no samples. */
export function combineTimestampSources(sources: readonly TimestampSource[]): TimestampSource | 'mixed' | undefined {
  if (sources.length === 0) return undefined
  const first = sources[0] as TimestampSource
  return sources.every((s) => s === first) ? first : 'mixed'
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
