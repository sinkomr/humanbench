/**
 * Copy and input settings of the typed-entry box (ROADMAP M1.13, A18; DESIGN §10, §13). The notes
 * are about the format only: they never say or imply whether an entry is right (§10: no
 * correctness feedback on counted items), and they use plain, non-judgmental wording (R-5.6.x).
 */

import type { EntryFormat } from '../../tasks/family'

/** Shown when a submit is empty. */
export const EMPTY_NOTE = 'Type an answer first, then submit.'

/** Shown when the family's parser cannot read the entry in this format. */
export const FORMAT_NOTES: Readonly<Record<EntryFormat, string>> = Object.freeze({
  integer: 'That entry could not be read as a whole number. Use digits, with a minus sign if needed, for example 42 or -7.',
  decimal: 'That entry could not be read as a number. Use digits and an optional decimal point, for example 12.5.',
  fraction: 'That entry could not be read as a number. Use a fraction such as 3/8, or a whole number.',
  letter: 'That entry could not be read as a letter. Type one letter from A to Z.',
})

/** Format hints for families whose spec carries none (series). */
export const FORMAT_HINTS: Readonly<Record<EntryFormat, string>> = Object.freeze({
  integer: 'Enter a whole number, such as 42 or -7.',
  decimal: 'Enter a number; decimals are fine, such as 12.5.',
  fraction: 'Enter a fraction such as 3/8, or a whole number.',
  letter: 'Enter one letter, A to Z.',
})

/**
 * The on-screen keyboard to ask for. iOS number pads have no minus sign or slash, so signed
 * formats use the decimal pad plus the renderer's ± button, and fractions the full keyboard.
 */
export const INPUT_MODES: Readonly<Record<EntryFormat, 'decimal' | 'text'>> = Object.freeze({
  integer: 'decimal',
  decimal: 'decimal',
  fraction: 'text',
  letter: 'text',
})
