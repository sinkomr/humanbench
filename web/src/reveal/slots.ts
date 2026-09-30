/**
 * The slots the reveal offers to later tasks (ROADMAP M1.R; Phase AI proposal v2 §3.3, §8
 * "Amendments to existing tasks": "M1.R: card slot after the save download; results-talk helper
 * slot"). Both are shown only after the save download and never on a share card.
 *
 * - **Working with AI** (AI.6b `RevealCard`, `AfterSave`): a link to the "Notes for your AI"
 *   builder page {@link NOTES_BUILDER_HREF} (AI.5, `notes.html` under the app's base path), which
 *   opens in a new tab so the results and their required save stay where they are, and the
 *   results-talk helper (AI.6b `ResultsTalk`): the gated preamble (at most
 *   {@link TALK_PREAMBLE_MAX_CHARS} characters) to paste before talking about results with an
 *   assistant, and the line that says never to paste the save file. The text has one home,
 *   `brief/results-talk.ts`. Notes text never appears on a share card (M1.18 test) and no results
 *   enter the preamble.
 * - **Share card** (M1.18, `ShareCard.svelte`): the picture, its skill toggles and its exports fill
 *   the share slot. The slot also links to the results-talk helper by {@link TALK_ANCHOR_ID}, which
 *   `AfterSave` passes to the helper, so the link moves focus to it.
 */

/** The id of the results-talk helper's card, which the share card links to (proposal §8, M1.18). */
export const TALK_ANCHOR_ID = 'hb-results-talk'

/** The "Notes for your AI" builder page (AI.5), under the app's base path. */
export const NOTES_BUILDER_HREF: string = `${import.meta.env.BASE_URL}notes.html`

/** The most characters the results-talk preamble may have (proposal §3.3). */
export const TALK_PREAMBLE_MAX_CHARS = 340
