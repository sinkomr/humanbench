/**
 * Copy of the unusual-uses entry and its results (ROADMAP M6.4; DESIGN §5.4, §8, §10, R-5.6.x). Plain, neutral wording: the
 * task is labelled experimental, a result says what it counted and never whether an idea was good or right, and nothing is
 * a total, a percentile or a rank. The A13 language lint scans this file.
 */

import { AUT_MAX_IDEAS } from './spec'
import { AUT_PARAMS_V0 } from './params'

/** The name of the entry on screen; the results list it as "Unusual uses (experimental)" (`facetLabel('alternative_uses')`). */
export const AUT_NAME = 'Unusual uses'

/** The label every place that shows the task carries (DESIGN §5.4: "Label this axis experimental"). */
export const EXPERIMENTAL_LABEL = 'Experimental'

/** Labels, instructions and notes of the entry. */
export const ENTRY_COPY = Object.freeze({
  name: AUT_NAME,
  experimental: EXPERIMENTAL_LABEL,
  instructions: 'List as many unusual uses for the object as you can. Short answers work best.',
  objectLabel: 'Object',
  /** The warning of DESIGN §8, shown before any typing and kept in view while the round runs. */
  warningTitle: "Don't type personal info",
  warningBody: 'No names, addresses, phone numbers or emails. Your answers are kept in your save file, and anything that looks like contact details is left out.',
  start: 'Start',
  inputLabel: 'An unusual use',
  add: 'Add',
  done: 'Done',
  remove: 'Remove',
  timeLabel: 'Time left',
  ideasLabel: 'Your ideas',
  noIdeas: 'No ideas yet.',
  emptyNote: 'Type an idea first, then add it.',
  personalInfoNote: 'That looks like contact details (an email, phone number, address or web link), so it was not added. Take them out and add the idea again.',
  fullNote: `The list holds at most ${AUT_MAX_IDEAS} ideas.`,
  timeUp: 'Time is up. Your ideas are recorded.',
  finished: 'Done. Your ideas are recorded.',
})

/** The note under the title before the round: how long it lasts. */
export function secondsNote(seconds: number): string {
  return `You have ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
}

/** The coarse announcement made when this many seconds are left (a polite live region; never every second). */
export function secondsLeftNote(seconds: number): string {
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'} left.`
}

/** The seconds left at which the announcements are made (those below the round's own length). */
export const ANNOUNCE_AT_SECONDS: readonly number[] = Object.freeze([60, 30, 10])

/** The minutes and seconds of a time left, as `1:30`. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The scorer, its download and the experimental note (the copy of the spec of M6.4, word for word). */
export const SCORER_COPY = Object.freeze({
  heading: 'Scorer',
  note: 'Scoring runs on this device with a small language model (about 25 MB, downloaded once from Hugging Face). Your answers are not sent anywhere.',
  load: 'Load the scorer (about 25 MB)',
  retry: 'Try again',
  loading: 'Downloading the scorer',
  preparing: 'Preparing the scorer',
  ready: 'The scorer is ready.',
  mock: 'A test scorer is in use, with no download. It only checks that this page works.',
  failed: 'The scorer could not be loaded. Check your connection and try again. Your ideas stay on this page.',
  scoringFailed: 'Your ideas could not be scored. Try again.',
  waiting: 'Your ideas are ready. Load the scorer to see how they are counted.',
  scoring: 'Scoring your ideas on this device.',
})

/** The note that goes with every result (DESIGN §5.4). */
export const EXPERIMENTAL_NOTE =
  'Experimental: this is a rough measure of how far your ideas are from the object and from each other. Automated scoring like this agrees only loosely with human judges.'

/** The three measures of a result. No totals, percentiles or right/wrong. */
export const RESULT_LABELS = Object.freeze({
  count: 'Ideas counted',
  distance: 'Distance score (experimental)',
  groups: 'Idea groups',
})

/** Plain explanations under the labels, and notes for the cases a score carries a flag. */
export const RESULT_COPY = Object.freeze({
  heading: 'Your ideas, counted',
  distanceHint: 'The average distance of your three most distant ideas from the object. 0 is the same as the object; larger is further away.',
  groupsHint: 'How many different kinds of idea you gave.',
  none: 'Not available',
  fewIdeas: 'This is based on fewer than three counted ideas, so it moves around even more.',
  personalInfo: "Some answers looked like contact details and were left out. Please don't type personal info.",
  ideasHeading: 'What was counted',
  scorerLine: (modelId: string, version: string): string =>
    modelId === 'mock' ? `Scored with a test scorer (${version}). These numbers only check that this page works.` : `Scored on this device with ${modelId} (${version}).`,
})

/** What each way a response can be treated is called on screen: about counting, never about right or wrong. */
export const STATUS_LABELS = Object.freeze({
  scored: 'Counted',
  duplicate: 'Not counted: the same idea as an earlier one',
  too_long: `Not counted: more than ${AUT_PARAMS_V0.maxWords} words`,
  implausible: 'Not counted: it did not read as a use for the object',
  personal_info: 'Left out: it looked like contact details',
  empty: 'Not counted: empty',
})

/** The notice of the outside scoring service while it is off, and the words of its opt-in flow behind the flag. */
export const OCSAI_COPY = Object.freeze({
  off: 'An optional outside scoring service may be offered later. It is off, and nothing is sent.',
  heading: 'Outside scoring (optional)',
  sent: 'What would be sent: the object and the ideas you added, as plain text. Once sent, they are outside this site and cannot be taken back.',
  checkbox: 'Send my ideas to the outside scoring service',
  payloadLabel: 'What would be sent',
  none: 'Nothing is sent unless this box is ticked.',
})
