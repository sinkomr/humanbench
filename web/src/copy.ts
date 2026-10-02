/**
 * Non-diagnostic disclaimer, DESIGN §13 (shown on every results page).
 * Must stay word-for-word with docs/DESIGN.md; copy.test.ts enforces this.
 * The language lint (ROADMAP A13, `scripts/language-lint.ts`) allows "clinical" and "IQ" only
 * inside this exact text.
 */
export const DISCLAIMER =
  'For curiosity and self-reflection. Not an IQ test, a clinical assessment, or a basis for decisions about education, employment, or health.'

/**
 * The neutral resource line of DESIGN R-5.6.5, word-for-word (copy.test.ts). It is the only
 * allow-listed sentence of the language lint (ROADMAP A13): it may name what R-5.6.1 otherwise
 * bans because it points away from the app. This module is the only place it may be spelled out
 * (the lint fails on a copy elsewhere; import it). Render it only in the results footer, never on
 * share cards (A13; enforced by M1.R and M1.18).
 */
export const RESOURCE_LINE =
  "If you're curious about autism or social-communication differences, a qualified clinician is the right route; online tests can't tell you."

/**
 * The user-facing name of the emotion axis, DESIGN R-5.6.2 word-for-word (copy.test.ts). It is the
 * name of axis EMO in `engine/axes.ts` and, on two lines, the label in `viz/profile.ts`. It says what
 * is measured (reading emotions in text scenarios) and nothing about people.
 */
export const EMO_AXIS_NAME = 'Emotion Reading (text scenarios)'

/**
 * The tooltip of the emotion axis, DESIGN R-5.6.2 word-for-word (copy.test.ts). It states the
 * non-diagnostic limits in the words the spec fixes, so it names "diagnostic" and "clinical": it is
 * the third allow-listed text of the language lint (ROADMAP A13 as amended by M6.1, after
 * RESOURCE_LINE and DISCLAIMER), masked only when it is exactly this sentence, and this module is the
 * only place it may be spelled out (the lint fails on a copy elsewhere; import it). Shown wherever
 * the axis is named and an explanation fits: the vignette renderer (`render/emotion`).
 */
export const EMO_TOOLTIP =
  'Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure; scores are strongly affected by vocabulary, culture and test familiarity.'

/** The product name: the heading of the start screen (ROADMAP M0.1 hello page, replaced by the M1.15 session flow). */
export const HEADING = 'HumanBench'
