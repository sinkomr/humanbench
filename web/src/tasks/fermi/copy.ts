/**
 * Copy of the magnitude + unit entry (ROADMAP M5.1; DESIGN §3 rows 11–12, §10, R-5.6.x). Plain,
 * neutral wording: a note is about the format of what was typed, never about whether an answer is
 * right (§10: no correctness feedback while the item counts), and nothing here describes a person.
 * The A13 language lint scans this file.
 */

import type { MagnitudeProblem } from './magnitude'
import { MAGNITUDE_MAX, MAGNITUDE_MIN, MAX_INTERVAL_DEX } from './scoring'

/** Labels and instructions of the entry. */
export const ENTRY_COPY = Object.freeze({
  region: 'Estimation question',
  instructions: 'Give your best guess, then a range you are 80% sure holds the real value. Type plain numbers such as 3200000, or 3.2e6, or 3.2 × 10^6.',
  value: 'Your best guess',
  low: 'Low end of your 80% range',
  high: 'High end of your 80% range',
  unit: 'Unit',
  unitHint: 'The unit applies to all three numbers.',
  unitPlaceholder: 'Choose a unit',
  rangeHint: '80% sure means you would be surprised about one time in five to find the real value outside your range. A wider range is safer, and a narrower one says more.',
  submit: 'Submit',
  recorded: 'Answer recorded.',
  readsAs: 'Reads as',
})

/** A power of ten the way the entry teaches it (`1 × 10^-30`), not as JavaScript writes it (`1e-30`). */
function tenToThe(power: number): string {
  const [mantissa, exponent] = power.toExponential(0).split('e') as [string, string]
  return `${mantissa} × 10^${Number(exponent)}`
}

/** A neutral note for a text that is not a magnitude. */
export const MAGNITUDE_NOTES: Readonly<Record<MagnitudeProblem, string>> = Object.freeze({
  empty: 'Type a number.',
  negative: 'Use a number above zero; there is no minus sign here.',
  zero: 'Use a number above zero.',
  unreadable: 'That could not be read as a number. Try 3200000, 3.2e6 or 3.2 × 10^6.',
  decimal_comma: 'Use a point for decimals, for example 2.5. A comma only groups thousands, as in 31,557,600.',
  has_unit: 'Type just the number here, and choose the unit in the unit box.',
  range: `Use a number between ${tenToThe(MAGNITUDE_MIN)} and ${tenToThe(MAGNITUDE_MAX)}.`,
})

/** Notes about the unit and the range as a whole. */
export const ENTRY_NOTES = Object.freeze({
  unit: 'Choose a unit.',
  order: 'Your range should run from the low end up to the high end, with your best guess inside it.',
  tooWide: `That range spans more than ${MAX_INTERVAL_DEX} orders of magnitude. Narrow it so it still holds the real value about four times in five.`,
})
