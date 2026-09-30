/**
 * "Talking about your results with an AI" (AI.6b; proposal §3.3, §6 row 5, requirement R-17.13,
 * gate metric E22). People will paste their results into a chatbot whatever HumanBench does, so the
 * reveal and share-card screens offer a words-only preamble to paste first, and say never to paste
 * the save file. The preamble carries no result, no number and no axis: it is the same 340
 * characters for everyone, and it makes no claim about the person (`results-talk.test.ts`).
 *
 * This file is deliberately light (no imports at all: no grammar, no topics, no gates code): the
 * session and reveal screens import it, and the notes grammar must not enter the main app bundle
 * (`scripts/bundle.test.ts`). The status of the preamble in the gates file is in `results-talk-gate.ts`.
 *
 * The preamble is a gated line type like the notes' own lines (ADR A22, "the wording is the
 * treatment"): its status is keyed by the wording version below, and a change to the text needs a
 * new version and a new pin (`results-talk.test.ts`). It ships before its check (generic and
 * words-only, like the T0 lines); a gate entry at the current version can make it `experimental`
 * (the screen says it is still being checked) or `blocked` (the preamble is not offered; the
 * warning about the save file always is).
 */

/** Line type id in the gates file, and the wording version of the preamble. */
export const RESULTS_TALK_ID = 'RT'
export const RESULTS_TALK_V = '1'

/** The preamble, word for word from proposal §3.3 (340 characters, 0 A13 hits). */
export const PREAMBLE =
  "These are rough, uncertain self-reflection results from a free online test. Ranges that overlap are not real differences. Don't turn them into an intelligence number, a rank against other people or one overall figure. Don't guess at health or medical explanations for them. Help me think about what I might practise or explore, if anything."

export const RESULTS_TALK = {
  heading: 'Talking about your results with an AI?',
  paste: 'Paste this first.',
  neverPaste: 'Never paste your save file: it holds your raw answers, and assistants may keep or learn from what you paste.',
  copyButton: 'Copy the text to paste first',
  copied: 'Copied to the clipboard.',
  copyFailed: 'Copying was blocked. The text is selected above; copy it yourself.',
  experimental: 'Still being checked',
  blockedNote: 'The text to paste first is not offered right now, because it is being reviewed.',
} as const

/** The approved screen text (proposal §6 "Copy drafts"), as one sentence run. */
export const RESULTS_TALK_TEXT = `${RESULTS_TALK.heading} ${RESULTS_TALK.paste} ${RESULTS_TALK.neverPaste}`

/** The "Working with AI" card on the reveal screen (proposal §3.3): shown only after the save download. */
export const REVEAL_CARD = {
  heading: 'Working with AI',
  // Purpose only (A22, proposal §3.7): this card is not a notes screen, so it carries no CLAIM sentence and may not say or imply any benefit either.
  body: 'You can make short, plain notes that tell your own AI assistant how you like explanations. They come from your own choices on a separate page, and they never contain your results.',
  link: 'Make notes for your AI',
  /** The notes page opens in its own tab, so the reveal (and its required save download) stays where it is. */
  newTab: ' (opens in a new tab)',
} as const
