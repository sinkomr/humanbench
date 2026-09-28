/**
 * Keyboard map and copy of the multiple-choice option group shared by the visual renderers
 * (ROADMAP M1.13; DESIGN §13 "keyboard navigation for everything").
 *
 * Options are labelled A, B, C, … in `spec.options` order (the display order, A18). Keys `1`–`9`
 * and `a`–`i` pick option 1–9 / A–I; arrow keys move between options (native radio group);
 * Enter on an option, or the Confirm button, sends the response. The single-character keys work
 * only while focus is inside the option group, which is WCAG 2.1.4's "active only on focus"
 * condition for character-key shortcuts.
 */

/** Option labels, by display position. */
export const OPTION_LETTERS = 'ABCDEFGHI'

/** Most options a group can show (one digit and one letter per option). */
export const MAX_OPTIONS = OPTION_LETTERS.length

/** The confirm button's label. */
export const CONFIRM_LABEL = 'Confirm'

/** The letter of display position `index` (0-based). */
export function optionLetter(index: number): string {
  const letter = OPTION_LETTERS[index]
  if (letter === undefined || !Number.isInteger(index)) throw new RangeError(`no option letter for position ${index}`)
  return letter
}

/**
 * The display position a key picks among `count` options, or null: `1`…`9` → 0…8 and
 * `a`/`A`…`i`/`I` → 0…8, when that position exists.
 */
export function optionIndexForKey(key: string, count: number): number | null {
  let i = -1
  if (/^[1-9]$/.test(key)) i = Number(key) - 1
  else if (/^[a-i]$/i.test(key)) i = key.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  return i >= 0 && i < count ? i : null
}
