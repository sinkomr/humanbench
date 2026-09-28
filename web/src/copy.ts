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

/** M0 placeholder heading: ROADMAP M0.1 "HumanBench — hello" page (DESIGN §14.3 M0: Pages serves "hello"). */
export const HEADING = 'HumanBench — hello'

/** M0 placeholder tagline (not DESIGN copy). */
export const TAGLINE = 'A jagged-blob cognitive profile — coming soon'
