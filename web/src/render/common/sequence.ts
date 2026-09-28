/**
 * rAF-locked stimulus sequences for the span boards (ROADMAP M1.9, M1.13; DESIGN §11.6 item 1):
 * each element is drawn in the first frame at or after its onset time and hidden in the first frame
 * at or after `on_ms` later, then the next one appears `off_ms` after that, using the RT onset
 * scheduler (`tasks/rt/timing.ts`), so presentation times come from frame timestamps, never the
 * wall clock. Each onset is timed from the previous frame actually drawn, so an element is never
 * shown for less than `on_ms` or blanked for less than `off_ms`, even after a dropped frame.
 */

import { createOnsetScheduler, type FrameSource, type ScheduledOnset } from '../../tasks/rt/timing'

export interface SequenceTiming {
  /** How long each element is shown (ms). */
  readonly on_ms: number
  /** Blank gap before the next element (ms). */
  readonly off_ms: number
}

export interface SequenceCallbacks {
  /** Draw element `index` now (called inside the frame's rAF callback). */
  show(index: number, frameTs: number): void
  /** Blank element `index` now. */
  hide(index: number, frameTs: number): void
  /** The last element was hidden. */
  done(frameTs: number): void
}

export interface SequenceRun {
  /** Stop the sequence; no callback runs after this. */
  cancel(): void
}

/**
 * Present `count` elements: the first `leadMs` after the next frame, each for `on_ms`, with
 * `off_ms` blank between them. Throws a RangeError on a negative count or bad timing.
 */
export function presentSequence(frames: FrameSource, count: number, timing: SequenceTiming, cb: SequenceCallbacks, leadMs = 0): SequenceRun {
  if (!(Number.isInteger(count) && count >= 0)) throw new RangeError(`presentSequence(): count must be an integer ≥ 0, got ${count}`)
  for (const [name, v] of [['on_ms', timing.on_ms], ['off_ms', timing.off_ms], ['leadMs', leadMs]] as const) {
    if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`presentSequence(): ${name} must be finite and ≥ 0, got ${v}`)
  }
  const scheduler = createOnsetScheduler(frames)
  let cancelled = false
  let pending: ScheduledOnset | null = null
  let startHandle: number | null = null

  const step = (index: number, from: number, delay: number): void => {
    pending = scheduler.schedule(delay, from, (shownTs) => {
      if (cancelled) return
      cb.show(index, shownTs)
      pending = scheduler.schedule(timing.on_ms, shownTs, (hiddenTs) => {
        if (cancelled) return
        cb.hide(index, hiddenTs)
        if (index + 1 < count) step(index + 1, hiddenTs, timing.off_ms)
        else {
          pending = null
          cb.done(hiddenTs)
        }
      })
    })
  }

  startHandle = frames.request((ts) => {
    startHandle = null
    if (cancelled) return
    if (count === 0) cb.done(ts)
    else step(0, ts, leadMs)
  })

  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      if (startHandle !== null) frames.cancel(startHandle)
      startHandle = null
      pending?.cancel()
      pending = null
    },
  }
}

/**
 * Run `cb` in the first frame at or after `delayMs` from the next frame (a rAF-locked pause, e.g.
 * between trials). Returns a cancel function.
 */
export function afterFrames(frames: FrameSource, delayMs: number, cb: (frameTs: number) => void): () => void {
  const scheduler = createOnsetScheduler(frames)
  let cancelled = false
  let pending: ScheduledOnset | null = null
  let handle: number | null = frames.request((ts) => {
    handle = null
    if (cancelled) return
    pending = scheduler.schedule(delayMs, ts, (at) => {
      if (!cancelled) cb(at)
    })
  })
  return () => {
    cancelled = true
    if (handle !== null) frames.cancel(handle)
    handle = null
    pending?.cancel()
  }
}
