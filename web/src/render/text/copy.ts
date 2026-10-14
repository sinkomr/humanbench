/**
 * Copy of the text multiple-choice renderer (ROADMAP M3.11 phase 1; DESIGN §10, R-5.6.x). Plain and
 * non-diagnostic: it names what is on screen and says that an answer was taken, never whether it was
 * right (no correctness feedback on finite-bank items, §10).
 */
export const TEXT_MC_COPY = Object.freeze({
  /** The group of paragraphs to read before the question. */
  readingLabel: 'Text for this question',
  /** Announced once the answer is taken. */
  recorded: 'Answer recorded.',
})

/**
 * Copy of the passage beside a served passage question (ROADMAP M3.11 phase 2; DESIGN §10, R-5.6.x): it names
 * what is on screen, and nothing else.
 */
export const PASSAGE_COPY = Object.freeze({
  /** The heading and the name of the passage's region. */
  heading: 'Passage',
  /** Read before the source line by a screen reader; the line itself is the bank's. */
  sourcePrefix: 'Source: ',
  /** The button that lifts the height limit of the passage on a narrow screen, and the one that puts it back. */
  showAll: 'Show the whole passage',
  showLess: 'Keep the passage small',
  /** "Question 2 of 4 about this passage": the place of the question among the passage's own. */
  position: (index: number, of: number): string => `Question ${index} of ${of} about this passage`,
})

/**
 * Copy of the setup beside a served logic-game question (the remaining families, 2026-10-13; DESIGN §3 row 3): the
 * same screen as a passage's, with the game's opening sentence and its rules in the passage's place.
 */
export const SETUP_COPY = Object.freeze({
  /** The heading and the name of the setup's region. */
  heading: 'Setup',
  /** The name of the list of the game's rules. */
  rulesLabel: 'Rules',
  showAll: 'Show the whole setup',
  showLess: 'Keep the setup small',
  /** "Question 2 of 4 about this setup". */
  position: (index: number, of: number): string => `Question ${index} of ${of} about this setup`,
})
