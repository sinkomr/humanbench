/**
 * Copy of the emotion vignette entry (ROADMAP M6.1; DESIGN §5.1, §10, R-5.6.x). Plain, neutral
 * wording: nothing here describes a person, a note is never about right or wrong (§10: no correctness
 * feedback while the item counts), and the axis is named and explained only in the words of R-5.6.2
 * (`EMO_AXIS_NAME`, `EMO_TOOLTIP` in `src/copy.ts`). The A13 language lint scans this file.
 */

/** Labels and instructions of the entry. */
export const ENTRY_COPY = Object.freeze({
  instructions: 'Read the situation, then choose the one feeling this person is most likely to have.',
  legendFallback: 'Choose the feeling this person is most likely to have',
  scenarioLabel: 'Situation',
  submit: 'Confirm',
  recorded: 'Answer recorded.',
  tipButton: 'About this skill',
  tipClose: 'Press Escape to close.',
})
