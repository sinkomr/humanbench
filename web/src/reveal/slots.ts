/**
 * The slots the reveal offers to later tasks (ROADMAP M1.R; Phase AI proposal v2 §3.3, §8
 * "Amendments to existing tasks": "M1.R: card slot after the save download; results-talk helper
 * slot"). Both are shown only after the save download and never on a share card.
 *
 * - **Notes for your AI** (AI.5): a link to the builder page once it exists. It does not yet, so
 *   the card shows a placeholder. AI.5 sets {@link NOTES_BUILDER_HREF} to that page (the notes
 *   module serves `notes.html` under the app's base path) and the card becomes a link that opens in
 *   a new tab, so the results and their required save stay where they are. At merge the notes
 *   module's own reveal card (AI.6b `RevealCard`) can fill `AfterSave`'s `ai` snippet instead; the
 *   `TALK_*` constants of `copy.ts` are then the ones to delete, so the gated preamble has one home.
 * - **Results-talk helper** (AI.6b): the preamble (at most {@link TALK_PREAMBLE_MAX_CHARS}
 *   characters) to paste before talking about results with an assistant, and the line that says
 *   never to paste the save file. The text is `copy.ts` TALK_PREAMBLE; the card only offers it.
 *   Notes text never appears on a share card (M1.18 test) and no results enter the preamble.
 * - **Share card** (M1.18): a section that M1.18 fills; until then it says so.
 */

/** Route of the "Notes for your AI" builder, or null while there is none (AI.5). */
export const NOTES_BUILDER_HREF: string | null = null

/** The most characters the results-talk preamble may have (proposal §3.3). */
export const TALK_PREAMBLE_MAX_CHARS = 340
