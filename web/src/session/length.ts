/**
 * The words for how many parts a session has and how long it takes (ROADMAP A15, M3.11 phase 1; DESIGN
 * §10). A module of its own, with no import of the other copy, so both `session/copy.ts` and
 * `backend/copy.ts` can build their sentences from it when they load.
 */

import { aboutMinutes as aboutPlannedMinutes, sessionOutline, type SessionOutline } from '../engine/plan-table'

/**
 * How many parts and how long (ROADMAP A15, M3.11): said in one way by the welcome screen, the
 * ready screen and the page's description, from the plan table itself (`engine/plan-table.ts`), so the words
 * cannot drift from what the session does. The six-part session of M1 reads "six parts" and "about 30
 * minutes", as it always did. A session that asks the server for the five text parts of phase 1 reads "up to
 * eleven parts" and "about 45 minutes", with Reading Comprehension "up to twelve" and "about 55": "up to",
 * because a part the server has no questions for is left out.
 */
const COUNT_WORDS: readonly string[] = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n)
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** "six" or "up to eleven". */
export const partsPhrase = (o: SessionOutline): string => `${o.upTo ? 'up to ' : ''}${countWord(o.parts)}`
/**
 * The minutes a session is said to take: its typical length (the simulated median of the parts it asks for,
 * `plan-table.ts` "How long a session is said to be"), to the nearest five ("30" for 31, "45" for 44.5).
 * The name is from when the figure was the plan's sum, which ran three minutes short of the eleven-part session.
 */
export const plannedMinutes = (o: SessionOutline): number => aboutPlannedMinutes(o.typical_s)

/** The six-part session of M1. */
export const BASE_OUTLINE: SessionOutline = sessionOutline()

/** "Six short parts, about 30 minutes." / "Up to eleven short parts, about 40 minutes." */
export const lengthSentence = (o: SessionOutline): string => `${capital(partsPhrase(o))} short parts, about ${plannedMinutes(o)} minutes.`
