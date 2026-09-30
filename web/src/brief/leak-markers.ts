/**
 * Strings that belong to the notes and the results-talk helper and must never appear on a share
 * card or in its renderer's output (proposal §8 AI.6b: "the share-card renderer never contains
 * notes strings"; M1.18's test uses this list). The card is for showing a shape; the notes are for
 * an assistant.
 *
 * The list is built, not typed: every wording of every template in the grammar (both forms, and
 * the retired wordings of earlier releases, `retired.ts`), the header, the Skill descriptions, the
 * results-talk preamble and screen text, and the reveal-card copy. So a notes line that leaks into
 * a card's `<desc>`, `<title>`, text or alt text is caught whichever line it is, and a new template
 * or a new release joins the list without anyone remembering to add it (`leak-markers.test.ts`).
 * A template with a slot (`{Topics}`, `{interests}`, `{custom}`) is listed as its fixed pieces, and
 * every piece stops at a character that SVG or HTML escapes (`'`, `"`, `&`, `<`, `>`), so a probe
 * is found whether the output writes the character or its entity.
 *
 * TEST SUPPORT: import this from tests and e2e specs only. It is not part of `reveal.ts`, so the
 * strings are not shipped in the main app (`scripts/bundle.test.ts` checks that the reveal bundle
 * has none of the notes grammar).
 */

import { NOTES_TITLE, SKILL_DESCRIPTIONS, SKILL_NAME, TEMPLATES, headerBody, wording } from './grammar'
import { RESULTS_TALK, RESULTS_TALK_TEXT, PREAMBLE, REVEAL_CARD } from './results-talk'
import { RETIRED_WORDINGS } from './retired'

/** A piece shorter than this is too common a phrase to say that a card copied notes. */
export const MIN_MARKER_CHARS = 12

/** The fixed pieces of a wording: split at slots, months and escapable characters, trimmed, long enough to mean something. */
export function markerPieces(text: string): string[] {
  return text
    .split(/\{[A-Za-z]+\}|\d{4}-\d{2}|['"&<>]/u)
    .map((p) => p.replace(/^[\s:,;.()-]+|[\s:,;.()-]+$/gu, ''))
    .filter((p) => p.length >= MIN_MARKER_CHARS)
}

/** A wording that is only a slot (X1, the person's own line) has no fixed words to list. */
const hasFixedWords = (w: string): boolean => w.replace(/\{[A-Za-z]+\}/gu, '').trim() !== ''

function templateWordings(): string[] {
  const out: string[] = []
  for (const t of TEMPLATES) for (const form of ['long', 'short'] as const) {
    const w = wording(t, form)
    if (w !== null && hasFixedWords(w)) out.push(w)
  }
  for (const r of RETIRED_WORDINGS) for (const w of [r.long, r.short]) if (typeof w === 'string' && hasFixedWords(w)) out.push(w)
  return out
}

/** Everything of the notes that has a fixed wording, before it is cut into pieces. */
export function noteTexts(): string[] {
  return [
    ...templateWordings(),
    headerBody('0000-00', '0000-00', false),
    headerBody('0000-00', '0000-00', true),
    NOTES_TITLE,
    SKILL_NAME,
    ...Object.values(SKILL_DESCRIPTIONS),
  ]
}

export const NOTES_LEAK_MARKERS: readonly string[] = [
  ...new Set([
    'Notes for your AI',
    'How I like explanations',
    'not an assessment of me',
    REVEAL_CARD.heading,
    REVEAL_CARD.body,
    REVEAL_CARD.link,
    RESULTS_TALK.heading,
    RESULTS_TALK.neverPaste,
    RESULTS_TALK_TEXT,
    PREAMBLE,
    'rough, uncertain self-reflection results',
    // the pieces of the texts above that hold a character an SVG or HTML output would escape (`Don't`)
    ...[PREAMBLE, RESULTS_TALK_TEXT, RESULTS_TALK.neverPaste, REVEAL_CARD.body].flatMap(markerPieces),
    ...noteTexts().flatMap(markerPieces),
  ]),
]
