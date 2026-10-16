/**
 * The session runtime, a chunk of its own (UX-100; DESIGN §7.4, §10, §13; ROADMAP M3.12): what the flow needs from the
 * ready screen on and nothing before it. The session machine (`run.ts`) with the selector, the cross-skill aim, the
 * question timer and the confidence scale (`SessionScreen.svelte`), the practice round, the autosaver, the scoring of
 * earlier saves (the ready screen and "See my results") and the device's item generators (`tasks/registry.ts`) are
 * all here, so the welcome screen, the 18+ gate, the honour code and the device check come up without them.
 *
 * `runtime-loader.ts` imports this module dynamically: in idle time on the welcome screen, and at the latest when the
 * person presses Start (`SessionApp.svelte`); a screen that needs it before it has arrived says so and waits.
 * `scripts/results-split.test.ts` checks that none of it is reachable from the entry without a dynamic import.
 */

export { default as PracticeScreen } from './PracticeScreen.svelte'
export { default as Ready } from './Ready.svelte'
export { default as SessionScreen } from './SessionScreen.svelte'
export { priorItemCounts } from './coverage'
export { earlierObservations } from './earlier'
export { holdsResults } from './holds-results'
export { SessionPersister } from './persist'
export { PracticeRun } from './practice'
export { continuationStartMs, findUnfinished } from './resume'
export { SessionRun } from './run'
