/**
 * The fixed wording of the syllogism family (DESIGN §3 row 2, §4.2 "formal logic"; R-5.6.x plain language): the
 * made-up category words of the categorical and chain templates, the everyday propositions of the conditional
 * template, the question lines and the intro. The bank twin (`hb.gen.syllogism`) holds the same tables, and a bank
 * test compares them with this file.
 *
 * **Made-up words** ({@link NONCE_WORDS}): short, pronounceable non-words, each used in the plural with a plain "s".
 * Vetted by hand: none is an English word, a common brand or product name, or (as far as the author knows) a rude or
 * loaded word in English, French, German, Spanish, Italian or Portuguese; look-alikes of real words (hobbit, wombat,
 * trollop, drabbet, jandle, skellum, zorb, dax) were left out. An item's words all start with different letters, so
 * they are easy to tell apart.
 *
 * **Propositions** ({@link SCENES}): neutral everyday states of things (lamps, doors, shops, gates, trains), never of
 * people; each is "the <thing> is <state>" and its negation "the <thing> is not <state>". One item uses one scene, so
 * its statements read as one situation.
 */

/** Singular made-up words; the plural adds "s". */
export const NONCE_WORDS: readonly string[] = Object.freeze([
  'blicket',
  'brazzle',
  'florp',
  'frabbet',
  'grenick',
  'glumbet',
  'plimmet',
  'pranset',
  'snorvel',
  'stibbet',
  'quindle',
  'drindle',
  'dorvel',
  'vellop',
  'vorset',
  'kimbet',
  'lurket',
  'tulvan',
  'wemble',
  'clemmot',
  'cromlet',
  'noffle',
  'yembit',
  'ravick',
  'sporvin',
  'pellick',
  'fendle',
])

/** The plural of a made-up word as the statements use it. */
export const plural = (word: string): string => `${word}s`

/** One proposition of a scene: "the <thing> is <state>". */
export interface Proposition {
  readonly thing: string
  readonly state: string
}

/** A scene: six propositions about one place. */
export interface Scene {
  readonly name: string
  readonly propositions: readonly Proposition[]
}

export const SCENES: readonly Scene[] = Object.freeze([
  {
    name: 'house',
    propositions: [
      { thing: 'lamp', state: 'on' },
      { thing: 'door', state: 'locked' },
      { thing: 'kettle', state: 'hot' },
      { thing: 'heater', state: 'running' },
      { thing: 'radio', state: 'playing' },
      { thing: 'window', state: 'open' },
    ],
  },
  {
    name: 'street',
    propositions: [
      { thing: 'shop', state: 'open' },
      { thing: 'bus', state: 'full' },
      { thing: 'bakery', state: 'busy' },
      { thing: 'road', state: 'wet' },
      { thing: 'bell', state: 'ringing' },
      { thing: 'bridge', state: 'raised' },
    ],
  },
  {
    name: 'garden',
    propositions: [
      { thing: 'gate', state: 'shut' },
      { thing: 'tap', state: 'running' },
      { thing: 'path', state: 'clear' },
      { thing: 'shed', state: 'locked' },
      { thing: 'fountain', state: 'on' },
      { thing: 'grass', state: 'wet' },
    ],
  },
  {
    name: 'station',
    propositions: [
      { thing: 'train', state: 'late' },
      { thing: 'platform', state: 'crowded' },
      { thing: 'ticket office', state: 'open' },
      { thing: 'barrier', state: 'down' },
      { thing: 'clock', state: 'fast' },
      { thing: 'waiting room', state: 'warm' },
    ],
  },
])

/** "the lamp is on" / "the lamp is not on". */
export const phraseOf = (p: Proposition, neg: boolean): string => `the ${p.thing} is ${neg ? 'not ' : ''}${p.state}`

/** The stem line above the statements of the categorical and chain templates. */
export const INTRO = 'The words are made up.'

/** The three question types, easiest first. */
export type Question = 'must_true' | 'could_true' | 'must_false'

export const QUESTIONS: readonly Question[] = Object.freeze(['must_true', 'could_true', 'must_false'] as const)

export const QUESTION_TEXT: Readonly<Record<Question, string>> = Object.freeze({
  must_true: 'If these statements are true, which of the following must also be true?',
  could_true: 'If these statements are true, which of the following could also be true?',
  must_false: 'If these statements are true, which of the following must be false?',
})

/** A word that makes an option negative, for the option-only cue check. */
export const NEGATION_RE = /\b(?:no|not)\b/i
