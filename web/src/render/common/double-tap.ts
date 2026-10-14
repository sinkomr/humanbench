/**
 * The second tap of a double tap (ROADMAP M1.13; SKIM-15): the second tap of a double tap on the button of the
 * previous screen lands on whatever the new screen has under the finger. A control that a person chooses by
 * tapping (an option card, a point of the confidence scale) asks {@link repeatsEarlierTap} on click and holds the
 * tap back when it is the repeat of a touch tap made before the control appeared, in the first 350 ms after it
 * appeared. A tap anywhere else, a later tap, and mouse, pen and keyboard selection are never held back.
 *
 * One listener for the page, installed before any control exists: the tap that made the screen change happened on
 * another component. Shared by `choice/OptionGroup.svelte` and the session's `ConfidenceScale.svelte`.
 */

/** Where and when (performance.now()) a touch press was. */
interface Tap {
  readonly x: number
  readonly y: number
  readonly at: number
}

/** A pointer press on the page, and the touch press before it. */
interface Press extends Tap {
  readonly type: string
  readonly before: Tap | null
}

let lastTouch: Tap | null = null
let lastPress: Press | null = null

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const at = performance.now()
      lastPress = { type: e.pointerType, x: e.clientX, y: e.clientY, at, before: lastTouch }
      if (e.pointerType === 'touch') lastTouch = { x: e.clientX, y: e.clientY, at }
    },
    { capture: true, passive: true },
  )
}

/** How long after it appeared a control holds back the repeat of an earlier tap. */
const SETTLE_MS = 350
/** How close in time and in space two taps are to be one double tap. */
const DOUBLE_TAP_MS = 600
const DOUBLE_TAP_PX = 32

/** True iff a click made now is the second tap of a double tap whose first tap came before a control appeared at `mountedAt`. */
export function repeatsEarlierTap(mountedAt: number): boolean {
  const now = performance.now()
  const press = lastPress
  if (now - mountedAt >= SETTLE_MS || press === null || press.type !== 'touch' || now - press.at > DOUBLE_TAP_MS) return false
  const first = press.before
  return first !== null && first.at < mountedAt && press.at - first.at <= DOUBLE_TAP_MS && Math.hypot(press.x - first.x, press.y - first.y) <= DOUBLE_TAP_PX
}
