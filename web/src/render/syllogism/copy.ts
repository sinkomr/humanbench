/**
 * Copy of the syllogism renderer (DESIGN §3 row 2, §13 screen-reader labels; R-5.6.x plain language; ROADMAP A13).
 * Every word the renderer adds to the item's own text is here. The item's text (the intro, the statements, the
 * question, the options) comes from the spec and is its own text alternative.
 */

/** The accessible name of the numbered list of statements. */
export const STATEMENTS_LABEL = 'Statements'

/** The accessible name of an option's radio: its letter, then its text ("B. Some florps are blickets."). */
export const optionName = (letter: string, text: string): string => `${letter}. ${text}`
