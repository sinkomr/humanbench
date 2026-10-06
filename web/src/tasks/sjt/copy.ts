/**
 * Copy of the situational judgment entry (ROADMAP M6.2; DESIGN §5.2, §5.3, §10, R-5.6.x). Plain, neutral wording:
 * nothing here describes a person, a note is never about right or wrong (§10: no correctness feedback while the item
 * counts), and the axis is named and explained in the words of R-5.6.2 (`EMO_AXIS_NAME`, `EMO_TOOLTIP` in `src/copy.ts`)
 * with the facet's own note ({@link FACET_NOTE}) after it. The A13 language lint scans this file.
 */

/** Labels and instructions of the entry. */
export const ENTRY_COPY = Object.freeze({
  instructions: 'Read the situation, then rate how well each response would work.',
  instructionsMostLeast: 'Read the situation, then choose the response that would work best and the one that would work least well.',
  scenarioLabel: 'Situation',
  /** The legend of the responses in most/least mode (in rate mode the item's own question is). */
  legendMostLeast: 'Choose one response for each question',
  most: 'Which response would work best?',
  least: 'Which response would work least well?',
  /** Shown when the same response is chosen for both questions in most/least mode. */
  mostLeastSame: 'Choose two different responses: one that would work best and one that would work least well.',
  submit: 'Confirm',
  recorded: 'Answer recorded.',
  tipButton: 'About this skill',
  tipClose: 'Press Escape to close.',
})

/** The labels of the four points of the rating scale, 1 to 4. */
export const SCALE_LABELS = Object.freeze(['Very ineffective', 'Somewhat ineffective', 'Somewhat effective', 'Very effective'] as const)

/**
 * What the skill measures and does not (DESIGN §5.2: "The UI must say so: measures agreement with typical and expert
 * judgments"; §5.3: the SJT axis overlaps Verbal, "report that honestly in the tooltip"). Shown with the R-5.6.2 tooltip.
 */
export const FACET_NOTE =
  'Measures how closely your ratings agree with typical and expert judgments of what works in everyday situations. It rewards conventional choices and overlaps with reading and vocabulary skills.'

/** How many responses are rated so far, as the entry says it ("2 of 4 responses rated."). */
export function progressText(rated: number, total: number): string {
  return `${rated} of ${total} responses rated.`
}
