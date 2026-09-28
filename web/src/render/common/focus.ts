/**
 * Keyboard helpers of the block renderers (ROADMAP M1.13; DESIGN §13 keyboard navigation).
 * Block renderers listen for keys on the window while they run and act only on keys meant for
 * them: the event target is inside the renderer, or nothing has focus (the body), so two
 * renderers on one page (the dev gallery) never steal each other's keys.
 */

/** True iff a key event is meant for the renderer rooted at `root`. */
export function isOwnKey(root: Element | null | undefined, event: KeyboardEvent): boolean {
  if (!root || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  const t = event.target
  if (t === null || t === document.body || t === document.documentElement || t === document) return true
  return t instanceof Node && root.contains(t)
}

/** True iff the event target is a control that handles Enter/Space itself (a button, a link, a form field). */
export function isControlTarget(event: KeyboardEvent): boolean {
  const t = event.target
  return t instanceof HTMLElement && t.closest('button, a[href], input, select, textarea, [role="radio"]') !== null
}

/** The digit 0–9 a key stands for (top row or numeric keypad), or null. */
export function digitOfKey(event: KeyboardEvent): number | null {
  return /^[0-9]$/.test(event.key) ? Number(event.key) : null
}
