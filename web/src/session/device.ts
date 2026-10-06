/**
 * The device check (ROADMAP M1.15; DESIGN §8 `device`, §11.6, §13): the coarse device facts a
 * save records, and the RT input mode. Nothing here is precise enough to identify a device: the
 * operating system and browser are families without versions (`schema/save-v1.json`
 * `family_name`), the class is one of four words, and the rest is the screen size, the measured
 * refresh rate and the timer resolution (§11.6 items 2 and 4).
 */

import type { RtInputMode } from '../render/rt/keys'
import { measureRefreshRate, type Clock, type FrameCallback, type FrameSource } from '../tasks/rt/timing'
import type { DeviceClass, DeviceInfo } from '../save/types'

/** What the browser tells about itself, injectable for tests. */
export interface DeviceEnv {
  readonly userAgent: string
  /** `navigator.maxTouchPoints`. */
  readonly maxTouchPoints: number
  /** `matchMedia('(pointer: coarse)').matches`. */
  readonly coarsePointer: boolean
  readonly viewport: readonly [number, number]
}

/** {@link DeviceEnv} of the running browser. */
export function browserDeviceEnv(): DeviceEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer: coarse,
    viewport: [Math.round(globalThis.innerWidth ?? 0), Math.round(globalThis.innerHeight ?? 0)],
  }
}

/** Family names the save schema accepts: letters, spaces, `_`, `-`; never digits or dots. */
const FALLBACK_FAMILY = 'Other'

/** Operating-system family from a user-agent string (no versions). */
export function osFamily(ua: string, maxTouchPoints = 0): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'iOS' // iPadOS asks for the desktop site
  if (/Android/.test(ua)) return 'Android'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Linux|X11/.test(ua)) return 'Linux'
  return FALLBACK_FAMILY
}

/** Browser family from a user-agent string (no versions). */
export function browserFamily(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox'
  if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return FALLBACK_FAMILY
}

/** phone / tablet / desktop from the pointer and the short side of the viewport; other when unknown. */
export function deviceClass(env: DeviceEnv): DeviceClass {
  const [w, h] = env.viewport
  const side = Math.min(w, h)
  if (!(side > 0)) return 'other'
  const os = osFamily(env.userAgent, env.maxTouchPoints)
  const touch = env.coarsePointer || env.maxTouchPoints > 1 || os === 'iOS' || os === 'Android'
  if (!touch) return 'desktop'
  return side < 600 ? 'phone' : 'tablet'
}

/** The RT input mode to start from: touch on a touch-first device, else the keyboard (§13). */
export function defaultRtInput(env: DeviceEnv): RtInputMode {
  return env.coarsePointer ? 'touch' : 'keyboard'
}

/**
 * The timer resolution in ms: the smallest positive step between successive readings of `clock`
 * (§11.6 item 4). Each sample spins until the reading changes, at most `maxReads` reads, so a frozen
 * clock (a fake in a test) gives null rather than a hang.
 */
export function timerResolutionMs(clock: Clock, samples = 5, maxReads = 200_000): number | null {
  let best = Infinity
  for (let s = 0; s < samples; s++) {
    const t0 = clock.now()
    for (let i = 0; i < maxReads; i++) {
      const d = clock.now() - t0
      if (d > 0) {
        best = Math.min(best, d)
        break
      }
    }
  }
  return Number.isFinite(best) ? Math.round(best * 1000) / 1000 : null
}

export interface CheckDeps {
  readonly env: DeviceEnv
  /** Real (unscaled) animation frames: the refresh rate is a property of the screen, not of the session timeline. */
  readonly frames: FrameSource
  readonly clock: Clock
  /** Give up on the refresh-rate measurement after this long (a hidden tab draws no frames). Default 4000. */
  readonly timeoutMs?: number
  /** Timer for the give-up, injectable. */
  readonly setTimeout?: (fn: () => void, ms: number) => unknown
  readonly clearTimeout?: (handle: unknown) => void
}

/** A refresh-rate measurement that gives up after `timeoutMs` (null then). */
export async function measureHz(deps: Pick<CheckDeps, 'frames' | 'timeoutMs' | 'setTimeout' | 'clearTimeout'>): Promise<number | null> {
  const set = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const clear = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>))
  let handle: unknown
  const giveUp = new Promise<null>((resolve) => {
    handle = set(() => resolve(null), deps.timeoutMs ?? 4000)
  })
  try {
    const est = await Promise.race([measureRefreshRate(deps.frames).then((e) => e.hz, () => null), giveUp])
    return est !== null && est > 0 ? est : null
  } finally {
    clear(handle)
  }
}

/**
 * The facts of the device check once the refresh rate is known: the coarse facts, the timer resolution (a
 * moment's work) and the window as it is now. {@link checkDevice} is this after its own measurement; the
 * device screen calls it with the rate a {@link RefreshProbe} measured earlier, so the result is the same
 * {@link DeviceInfo} either way.
 */
export function describeDevice(deps: Pick<CheckDeps, 'env' | 'clock'>, hz: number | null, input: RtInputMode = defaultRtInput(deps.env)): DeviceInfo {
  const { env } = deps
  return {
    class: deviceClass(env),
    input,
    os_family: osFamily(env.userAgent, env.maxTouchPoints),
    browser_family: browserFamily(env.userAgent),
    refresh_hz_est: hz,
    timer_res_ms: timerResolutionMs(deps.clock),
    viewport: [Math.max(0, Math.round(env.viewport[0])), Math.max(0, Math.round(env.viewport[1]))],
  }
}

/**
 * Run the device check: the coarse facts, the refresh rate from 60 animation-frame deltas (about
 * a second) and the timer resolution. A measurement that fails leaves its field null; the check
 * itself never throws (a person on an unusual browser can still take part).
 */
export async function checkDevice(deps: CheckDeps, input: RtInputMode = defaultRtInput(deps.env)): Promise<DeviceInfo> {
  return describeDevice(deps, await measureHz(deps), input)
}

// ------------------------------------------------------------------------------ the refresh probe

/** What the probe needs to know about the page being in view: a hidden page draws no frames. */
export interface PageVisibility {
  hidden(): boolean
  /** Call `cb` whenever the page is shown or hidden; returns the way to stop. */
  onChange(cb: () => void): () => void
}

/** The page's own visibility (`document.visibilityState`). Only 'hidden' counts as hidden. */
export const browserVisibility: PageVisibility = Object.freeze({
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onChange: (cb: () => void) => {
    if (typeof document === 'undefined') return () => undefined
    document.addEventListener('visibilitychange', cb)
    return () => document.removeEventListener('visibilitychange', cb)
  },
})

/**
 * The refresh-rate measurement, started while the 18+ gate and the honour screen are shown, so the device
 * check does not make the person wait for it (provisional default, UX-REVIEW D23). It keeps its result in
 * memory only: nothing is stored, and the flow drops it when the person says they are under 18.
 */
export interface RefreshProbe {
  /** undefined while it measures; then the rate in Hz, or null when there is no usable measurement. */
  readonly hz: number | null | undefined
  /** When it settled, on the clock it was given; null while it measures. */
  readonly settledAt: number | null
  /** Settles with {@link hz}; never rejects. */
  readonly done: Promise<number | null>
  /** Stop and drop the measurement (the pending frame is cancelled; `done` settles with null at once). */
  cancel(): void
}

/** A measurement older than this is made again: the window may have moved to another screen since. */
export const PROBE_MAX_AGE_MS = 2 * 60_000

export interface ProbeDeps extends Pick<CheckDeps, 'frames' | 'clock' | 'timeoutMs' | 'setTimeout' | 'clearTimeout'> {
  /** Default {@link browserVisibility}. */
  readonly visibility?: PageVisibility
}

/**
 * Start measuring the refresh rate in the background (rAF and the real clock, as {@link measureHz}). Null when
 * the page is hidden now: no frames would come, and the device check measures as it always did. A page that
 * is hidden while it measures ends it with null, and so does `cancel()`. The result is the same estimate
 * {@link checkDevice} would make.
 */
export function startRefreshProbe(deps: ProbeDeps): RefreshProbe | null {
  const visibility = deps.visibility ?? browserVisibility
  if (visibility.hidden()) return null
  let value: number | null | undefined
  let settledAt: number | null = null
  let handle: number | null = null
  let stop: () => void = () => undefined
  const abandoned = new Promise<null>((resolve) => {
    stop = () => resolve(null)
  })
  // The frame source the measurement uses, so the one frame that is pending can be cancelled.
  const frames: FrameSource = {
    request: (cb: FrameCallback) => (handle = deps.frames.request(cb)),
    cancel: (h: number) => deps.frames.cancel(h),
  }
  const unwatch = visibility.onChange(() => {
    if (visibility.hidden()) cancel()
  })
  function cancel(): void {
    if (value !== undefined) return
    if (handle !== null) deps.frames.cancel(handle)
    stop()
  }
  const done = Promise.race([measureHz({ ...deps, frames }), abandoned]).then((hz) => {
    value = hz
    settledAt = deps.clock.now()
    unwatch()
    return hz
  })
  return {
    get hz() {
      return value
    },
    get settledAt() {
      return settledAt
    },
    done,
    cancel,
  }
}

/**
 * What a probe tells the device screen at `now` (the clock the probe was given): undefined while it still
 * measures (wait for `done`), a rate when it has one that is not too old, else null (measure again).
 */
export function probeHz(probe: RefreshProbe | null | undefined, now: number): number | null | undefined {
  if (probe === null || probe === undefined) return null
  const hz = probe.hz
  if (hz === undefined) return undefined
  return hz !== null && probe.settledAt !== null && now - probe.settledAt <= PROBE_MAX_AGE_MS ? hz : null
}

/** Plain-language remarks for the device screen, none of them about the person. */
export function deviceRemarks(info: DeviceInfo): string[] {
  const out: string[] = []
  if (info.refresh_hz_est !== null && info.refresh_hz_est < 50) out.push('Your screen updates slowly, so reaction times will be less precise.')
  if (info.viewport[0] > 0 && info.viewport[0] < 320) out.push('Your window is very narrow. Widen it, or turn your phone sideways.')
  if (info.refresh_hz_est === null) out.push('The screen refresh rate could not be measured. You can still continue.')
  return out
}
