/**
 * Wording that used to be released and has since changed (ADR A22: "changing a template's wording
 * resets its gate"; R-17.11: "all released versions parse"). When a template's wording changes, its
 * `v` goes up and its old wording is added here, so notes copied or pasted from an earlier release
 * still read as that line (with a note that the wording is older) instead of as a foreign line.
 * `parse.ts` and `match.ts` read this list; `check.ts` reports each such line as out of date and
 * `diff.ts` shows the old and the current wording side by side.
 *
 * The list is empty for now: the only release is templates 2026.09, wording version 1 of every
 * line. `wording-pins.json` (grammar.test.ts) fails a wording change that comes without a new
 * version; `released.test.ts` fails a change that comes without an entry here, because the frozen
 * fixtures of each released `hb-brief/N` (`__fixtures__/released/`) would stop reading.
 *
 * Wording keeps its slot markers (`{Topics}`, `{topics}`, `{interests}`), exactly as in `grammar.ts`.
 */

import type { LineId } from './types'

export interface RetiredWording {
  /** The template the wording belonged to (it still exists in the grammar). */
  readonly id: LineId
  /** The wording version this text had. */
  readonly v: string
  readonly long: string | null
  /** Short-form wording when it differed from `long`; `undefined` means the same as `long`. */
  readonly short?: string | null
}

export const RETIRED_WORDINGS: readonly RetiredWording[] = []
