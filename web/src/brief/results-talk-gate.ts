/**
 * The gate status of the results-talk preamble (AI.6b; ADR A22, gate metric E22): the entry for
 * line type `RT` in the bundled gates file (`brief-gates.json`, statuses only, copied from the bank
 * per A17). Kept apart from `results-talk.ts` so that file has no imports at all, and so the
 * Playwright specs can import the texts without loading JSON.
 */

import raw from './brief-gates.json'
import { RESULTS_TALK_ID, RESULTS_TALK_V } from './results-talk'

export type ResultsTalkStatus = 'shipped' | 'experimental' | 'blocked'

interface GateLike {
  readonly lines?: Readonly<Record<string, { readonly v?: unknown; readonly status?: unknown } | undefined>>
}

/**
 * The status of the preamble in a gates file: the entry for `RT` at the current wording version,
 * else `shipped`. An entry for other wording, or with a status this build does not know, is ignored
 * (the wording is the treatment; an unreadable status must not switch anything on or off).
 */
export function resultsTalkStatus(gates: GateLike = raw as GateLike): ResultsTalkStatus {
  const e = gates.lines?.[RESULTS_TALK_ID]
  if (e === undefined || e.v !== RESULTS_TALK_V) return 'shipped'
  return e.status === 'experimental' || e.status === 'blocked' || e.status === 'shipped' ? e.status : 'shipped'
}

