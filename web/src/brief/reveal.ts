/**
 * What the reveal and share-card screens import from the notes module (AI.6b; requirement R-17.13):
 * the "Working with AI" card, the results-talk helper and its copy. This barrel is light on
 * purpose: it does not reach the notes grammar, topics or gates code, so importing it does not put
 * the notes into the main app bundle (`scripts/bundle.test.ts`). The session chain wires it into
 * M1.R (the card after the save download; the helper on the share-card screen) and M1.18 (the
 * share-card renderer's output must contain none of `NOTES_LEAK_MARKERS`, `leak-markers.ts`, which
 * tests import and the app does not).
 *
 * ```svelte
 * <RevealCard saved={saveDownloaded} notesHref={`${import.meta.env.BASE_URL}notes.html`} />
 * <ResultsTalk level={2} />
 * ```
 */

export { default as ResultsTalk } from './ui/ResultsTalk.svelte'
export { default as RevealCard } from './ui/RevealCard.svelte'
export * from './results-talk'
export * from './results-talk-gate'
export * from './save-copy'
