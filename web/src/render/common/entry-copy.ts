/**
 * Copy and input settings of the typed-entry box (ROADMAP M1.13, A18; DESIGN §10, §13). The notes
 * are about the format only: they never say or imply whether an entry is right (§10: no
 * correctness feedback on counted items), and they use plain, non-judgmental wording (R-5.6.x).
 */

import type { EntryFormat } from '../../tasks/family'

/** Shown when a submit is empty. */
export const EMPTY_NOTE = 'Type an answer first, then submit.'

/**
 * Shown when a number is written with thousands commas (`1,500`): a person who writes decimals
 * with a comma may mean 1.5, so the box asks for 1500 or 1.5 instead of guessing (UX-079).
 */
export const THOUSANDS_NOTE = 'Write thousands without a comma (1500) and decimals with a point (1.5).'

/**
 * A family's verdict on a typed entry (the box's `check`): `'ok'` submits it, `'format'` shows the
 * format's note ({@link FORMAT_NOTES}), `'thousands'` shows {@link THOUSANDS_NOTE}.
 */
export type EntryVerdict = 'ok' | 'format' | 'thousands'

/** Shown when the family's parser cannot read the entry in this format. */
export const FORMAT_NOTES: Readonly<Record<EntryFormat, string>> = Object.freeze({
  integer: 'That entry could not be read as a whole number. Use only the digits 0 to 9, with no spaces or commas, and a minus sign if needed, for example 42 or -7.',
  decimal: 'That entry could not be read as a number. Use only the digits 0 to 9 and a point (.) for decimals, with no spaces or commas, for example 12.5.',
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
