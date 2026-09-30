/**
 * The blob's build-up, axis by axis (DESIGN §10 reveal flow "animated blob build-up, axis by
 * axis"; ROADMAP M1.R). A pure frame function plus a small rAF controller.
 *
 * {@link frameEstimates} maps the final estimates and a progress p ∈ [0, n] (n = the measured
 * skills) to the estimates of one animation frame: measured skill i (in spoke order) grows from
 * the centre (−3 SD, no uncertainty) to its final estimate while p goes from i to i + 1, so skills
 * appear one after another around the circle. Stubs (skipped, not measured) are drawn from the
 * start as they will stay. The frame's `muted` and `relation` are the FINAL ones for the whole
 * build-up, so a spoke does not change colour as it grows; the interval and whisker grow with it.
 * At p ≥ n the input array's own objects are returned, so the last frame is exactly the static
 * profile.
 *
 * The animation is progressive enhancement: the table (the screen-reader default, §9.5 c) always
 * holds the final data, `prefers-reduced-motion` skips it, and it can be skipped at any time
 * (WCAG 2.2.2). Time comes from rAF timestamps (§11.6), never the wall clock.
 */

import type { FrameSource } from '../tasks/rt/timing'
import { THETA_MIN } from '../viz/geometry'
import { measuredFields, type AxisEstimate } from '../viz/profile'

/** Time to draw one skill, in ms (about 4 s for ten skills). */
export const REVEAL_AXIS_MS = 380

export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

/** How many spokes the build-up draws: the measured ones. */
export function revealCount(estimates: readonly AxisEstimate[]): number {
  return estimates.filter((e) => e.measured).length
}

/** The estimates of the frame at `progress` (module comment). */
export function frameEstimates(estimates: readonly AxisEstimate[], progress: number): AxisEstimate[] {
  if (!Number.isFinite(progress)) throw new RangeError('progress must be finite')
  const n = revealCount(estimates)
  if (progress >= n) return [...estimates]
  let i = 0
  return estimates.map((e) => {
    if (!e.measured || e.theta === undefined || e.sd === undefined) return e
    const t = progress - i++
    if (t >= 1) return e
    const k = easeOutCubic(t)
    const grown = measuredFields(THETA_MIN + (e.theta - THETA_MIN) * k, e.sd * k)
    return { ...e, ...grown, muted: e.muted, ...(e.relation === undefined ? {} : { relation: e.relation }) }
  })
}

/** The measured skill being drawn at `progress`: its name and 1-based position, or null when done or not started. */
export function revealingNow(estimates: readonly AxisEstimate[], progress: number): { name: string; index: number; count: number } | null {
  const measured = estimates.filter((e) => e.measured)
  const i = Math.floor(progress)
  const e = measured[i]
  return progress < 0 || e === undefined ? null : { name: e.name, index: i + 1, count: measured.length }
}

export interface RevealOptions {
  /** Skills to draw (see {@link revealCount}). */
  readonly count: number
  readonly frames: FrameSource
  /** Called with the progress on frames that changed it enough to redraw. */
  readonly onProgress: (progress: number) => void
  /** Called once, when the last skill is drawn or the build-up is skipped. */
  readonly onDone: () => void
  readonly axisMs?: number
  /** Least time between redraws, in ms (the blob's paths are recomputed per frame; default 30). */
  readonly minFrameMs?: number
}

export interface RevealHandle {
  /** Jump to the finished profile. */
  skip(): void
  /** Stop without a final frame (the component went away). */
  stop(): void
}

/** Run the build-up on `opts.frames`. Progress starts at the first frame's timestamp. */
export function startReveal(opts: RevealOptions): RevealHandle {
  const axisMs = opts.axisMs ?? REVEAL_AXIS_MS
  const minFrameMs = opts.minFrameMs ?? 30
  let live = true
  let handle: number | null = null
  let t0: number | null = null
  let lastDrawn = -Infinity

  const finish = (): void => {
    if (!live) return
    live = false
    if (handle !== null) opts.frames.cancel(handle)
    handle = null
    opts.onProgress(opts.count)
    opts.onDone()
  }
  const frame = (ts: number): void => {
    handle = null
    if (!live) return
    t0 ??= ts
    const p = Math.min(opts.count, Math.max(0, (ts - t0) / axisMs))
    if (p >= opts.count) return finish()
    if (ts - lastDrawn >= minFrameMs) {
      lastDrawn = ts
      opts.onProgress(p)
    }
    handle = opts.frames.request(frame)
  }

  if (opts.count <= 0) {
    queueMicrotask(finish)
  } else {
    opts.onProgress(0)
    handle = opts.frames.request(frame)
  }
  return {
    skip: finish,
    stop() {
      live = false
      if (handle !== null) opts.frames.cancel(handle)
      handle = null
    },
  }
}
