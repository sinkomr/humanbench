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
