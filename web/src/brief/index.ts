/**
 * "Notes for your AI" core (Phase AI; proposal v2, ADR A20-A23; requirements R-17.x): a pure,
 * deterministic generator of short notes a person pastes into their own AI assistant. No LLM, no
 * network, no storage, no results input (Part 1).
 *
 * This barrel is used by the notes page (`web/notes.html`) only. It is deliberately NOT re-exported
 * from `tasks/index.ts`, `save/index.ts` or `viz/index.ts`, so the main app and the light barrels
 * never carry the grammar (`scripts/bundle.test.ts` checks both).
 */

export * from './build'
export * from './check'
export * from './contexts'
export * from './diff'
export * from './gates'
export * from './grammar'
export * from './interests'
export * from './lint'
export * from './match'
export * from './meaning'
export * from './normalize'
export * from './parse'
export * from './prefs'
export * from './render'
export * from './results-talk'
export * from './results-talk-gate'
export * from './retired'
export * from './returning'
export * from './sanitize'
export * from './surfaces'
export * from './topics'
export * from './types'
export * from './validate'
