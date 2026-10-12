/**
 * The words for how many parts a session has and how long it takes (ROADMAP A15, M3.11 phase 1; DESIGN
 * §10). A module of its own, with no import of the other copy, so both `session/copy.ts` and
 * `backend/copy.ts` can build their sentences from it when they load.
 */

import { aboutMinutes as aboutPlannedMinutes, sessionOutline, type SessionOutline } from '../engine/plan-table'

/**
 * How many parts and how long (ROADMAP A15, M3.11 phase 1): said in one way by the welcome screen, the
 * ready screen and the page's description, from the plan itself (`engine/plan-table.ts`), so the words
 * cannot drift from what the session does. The six-part session of M1 reads "six parts" and "about 30
 * minutes", as it always did. A session that asks the server for text parts reads "up to eleven parts"
 * and "about 40 minutes": "up to", because a part the server has no questions for is left out.
 */
const COUNT_WORDS: readonly string[] = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n)
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** "six" or "up to eleven". */
export const partsPhrase = (o: SessionOutline): string => `${o.upTo ? 'up to ' : ''}${countWord(o.parts)}`
/** The planned minutes as they are said: to the nearest five ("30" for 27.5, "40" for 41). */
export const plannedMinutes = (o: SessionOutline): number => aboutPlannedMinutes(o.planned_s)

/** The six-part session of M1. */
export const BASE_OUTLINE: SessionOutline = sessionOutline()

/** "Six short parts, about 30 minutes." / "Up to eleven short parts, about 40 minutes." */
export const lengthSentence = (o: SessionOutline): string => `${capital(partsPhrase(o))} short parts, about ${plannedMinutes(o)} minutes.`
