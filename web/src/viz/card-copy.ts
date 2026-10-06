/**
 * The words ON a share card (DESIGN §9.9, §10, §13; ROADMAP M1.18, A12, A13; R-5.6.1, R-5.6.4).
 * Every text a card can carry is here or is an axis label, a ring label or the ring note of the
 * blob (`viz/copy.ts`); `card.test.ts` checks the rendered card against exactly that list, so
 * nothing else (notes for an AI, the resource line, the save file) can reach a card. The language
 * lint scans this file: plain, non-diagnostic, no total and no single score (CLAUDE.md blob rule).
 * The R-5.6.5 resource line and the §13 disclaimer are not on a card (A13: the resource line is a
 * results-footer text; the card is a picture people post out of context, so it carries its own
 * short purpose line instead).
 */

export const CARD_BRAND = 'HumanBench'
export const CARD_TITLE = 'My skill profile'

/** "Based on 1 session" / "Based on 3 sessions" (a count of sittings, never a level). */
export function cardSessions(n: number): string {
  return `Based on ${n} session${n === 1 ? '' : 's'}`
}

export const CARD_PEAKS_HEADING = 'Most distinctive peaks'
export const CARD_PEAKS_SUB = "Compared with this card's skills as a whole"
/** "Stands out by about 0.9 SD" */
export function cardPeakStands(contrast: string): string {
  return `Stands out by about ${contrast} SD`
}
/** "90% range +0.4 to +1.4 SD" (the card's uncertainty for a peak: a range, not a single figure). */
export function cardPeakRange(lo: string, hi: string): string {
  return `90% range ${lo} to ${hi} SD`
}
export const CARD_NO_PEAKS = 'No skill stands out clearly among those shown.'

/** The card's small print: the scale is provisional, the shape carries no total, and the choice of skills is mine. */
export const CARD_NOTE_SCALE = 'Rough estimates on a provisional scale. Where ranges overlap, a difference may not be real.'
export const CARD_NOTE_READING = 'Compare spokes one at a time; the size of the shape means nothing. Only skills I chose are shown.'
export const CARD_PURPOSE = 'For curiosity and self-reflection.'
/**
 * The key to the marks, and what "SD" is (UX-038): a card travels without its page; "range" is the
 * 90% range the thin lines show. On a card only a range above 0 SD is filled: a credible low is drawn
 * hollow and grey like a range that overlaps 0 SD (UX review D15 A, a provisional default), so the
 * only strong colour on a picture people post is never a low.
 */
export const CARD_KEY = 'Filled: range above 0 SD. Hollow: range overlaps or is below 0 SD.'
/** D15 A: the card's named peaks are ringed on the chart (only on a card that lists peaks). */
export const CARD_KEY_PEAKS = 'Ringed: a named peak.'
export const CARD_SD_MEANING = 'SD means standard deviation.'

/** The picture's title and its text alternative's first sentence (the shown skills follow). */
export function cardAlt(count: number, peaks: readonly string[]): string {
  const lead = `Skill profile blob with ${count} skills; rings are standard-deviation units on a provisional scale.`
  return peaks.length === 0 ? lead : `${lead} Most distinctive peaks: ${peaks.join(', ')}.`
}
