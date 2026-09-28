/**
 * Input and pacing of the RT renderer (ROADMAP M1.10, M1.13; DESIGN §7.1, §11.6, §13: keyboard,
 * mouse or touch input, stored and normed separately).
 */

import { RT_MODE_CONFIG, type RtMode } from '../../tasks/rt/types'

/**
 * How the taker responds: keys, or tapping / clicking the stimulus positions (§13). This is the
 * control scheme only; the input type stored with the block is {@link RtInputType}.
 */
export type RtInputMode = 'keyboard' | 'touch'

/**
 * The input type stored with a block's observation (§11.6 items 2 and 5: touch, mouse and
 * keyboard latencies differ and get separate norms; `RtDevice.input_type`).
 */
export type RtInputType = 'keyboard' | 'mouse' | 'touch'

/**
 * The input type of a tap-or-click block, from the `PointerEvent.pointerType` of its responses:
 * 'mouse' when most of them came from a mouse, else 'touch' (a pen, or a device that reports no
 * type, is screen contact too; a tie goes to touch). With no pointer response at all, `fallback`
 * (the device's primary pointer).
 */
export function pointerInputType(pointerTypes: readonly string[], fallback: 'mouse' | 'touch'): 'mouse' | 'touch' {
  if (pointerTypes.length === 0) return fallback
  const mouse = pointerTypes.filter((t) => t === 'mouse').length
  return mouse > pointerTypes.length - mouse ? 'mouse' : 'touch'
}

/** Keys of the 4 choice positions, left to right (D F J K, or 1–4). */
export const CHOICE_KEYS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['d', '1']),
  Object.freeze(['f', '2']),
  Object.freeze(['j', '3']),
  Object.freeze(['k', '4']),
])

/** Key labels shown under the choice positions. */
export const CHOICE_KEY_LABELS: readonly string[] = Object.freeze(['D', 'F', 'J', 'K'])

/** The position a key press answers in this mode, or null for any other key. Simple RT: Space. */
export function positionOfKey(mode: RtMode, key: string): number | null {
  if (mode === 'simple') return key === ' ' || key === 'Spacebar' ? 0 : null
  const k = key.toLowerCase()
  const i = CHOICE_KEYS.findIndex((keys) => keys.includes(k))
  return i >= 0 ? i : null
}

/**
 * How long after onset a trial waits for a response before it counts as a miss: 1 s beyond the
 * mode's valid window (§7.1), so a slow but real response is recorded (and trimmed) rather than
 * missed.
 */
export function responseWindowMs(mode: RtMode): number {
  return RT_MODE_CONFIG[mode].max_rt_ms + 1000
}

/** Blank interval after a response before the next trial's fixation (ms). */
export const RT_ITI_MS = 800
/** Longer interval after an early press, so the "too early" note can be read (ms). */
export const RT_EARLY_ITI_MS = 1500
