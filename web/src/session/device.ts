/**
 * The device check (ROADMAP M1.15; DESIGN §8 `device`, §11.6, §13): the coarse device facts a
 * save records, and the RT input mode. Nothing here is precise enough to identify a device: the
 * operating system and browser are families without versions (`schema/save-v1.json`
 * `family_name`), the class is one of four words, and the rest is the screen size, the measured
 * refresh rate and the timer resolution (§11.6 items 2 and 4).
 */

import type { RtInputMode } from '../render/rt/keys'
import { measureRefreshRate, type Clock, type FrameSource } from '../tasks/rt/timing'
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
async function measureHz(deps: CheckDeps): Promise<number | null> {
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
 * Run the device check: the coarse facts, the refresh rate from 60 animation-frame deltas (about
 * a second) and the timer resolution. A measurement that fails leaves its field null; the check
 * itself never throws (a person on an unusual browser can still take part).
 */
export async function checkDevice(deps: CheckDeps, input: RtInputMode = defaultRtInput(deps.env)): Promise<DeviceInfo> {
  const { env } = deps
  const hz = await measureHz(deps)
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

/** Plain-language remarks for the device screen, none of them about the person. */
export function deviceRemarks(info: DeviceInfo): string[] {
  const out: string[] = []
  if (info.refresh_hz_est !== null && info.refresh_hz_est < 50) out.push('Your screen updates slowly, so reaction times will be less precise.')
  if (info.viewport[0] > 0 && info.viewport[0] < 320) out.push('Your window is very narrow. Widen it, or turn your phone sideways.')
  if (info.refresh_hz_est === null) out.push('The screen refresh rate could not be measured. You can still continue.')
  return out
}
