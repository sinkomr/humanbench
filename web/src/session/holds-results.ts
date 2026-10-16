/**
 * Whether a save holds results to look at (UX-REVIEW D22; `returning.ts` reads the welcome row without scoring). It scores
 * the save, so it lives in the session runtime (`runtime.ts`), not in the entry chunk (UX-100).
 */

import { buildResults } from '../reveal/results'
import type { SaveFileV1 } from '../save/types'

/**
 * Whether the save holds results to look at, exactly as `Ready.svelte` decides it: `buildResults` is null for
 * nothing scorable (every answer on a skipped skill, or none). It scores the whole save, which takes a
 * fraction of a second, so it is asked when "See my results" is pressed, not when the welcome screen is drawn.
 */
export function holdsResults(save: SaveFileV1): boolean {
  try {
    return buildResults(save) !== null
  } catch {
    return false
  }
}
