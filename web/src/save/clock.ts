/**
 * Wall-clock time for file metadata only (DESIGN §8 `created_utc`, `started_utc`, session-id time
 * prefix; the date in the name of an exported share card, M1.18). Never used for response times: those come from `performance.now()` and rAF
 * timestamps (CLAUDE.md, §11.6). This is the one file under `web/src` allowed to read the wall
 * clock (`scripts/timing-lint.test.ts` ALLOW list); everything else takes epoch ms as a parameter.
 *
 * Range: 1970-01-01T00:00:00Z to 9999-12-31T23:59:59Z, the times a session id (a ULID of epoch
 * ms ≥ 0, `ids.ts`) and the fixed-width format can both carry; the save schema's `utc_seconds`
 * accepts exactly the real calendar times in it (`UTC_SECONDS_RE`).
 */

import { UTC_SECONDS_RE } from './validate'

/** Current wall-clock time in epoch ms. Metadata only, never RT. */
export function wallClockMs(): number {
  return Date.now()
}

/** `YYYY-MM-DDTHH:MM:SSZ` (UTC, whole seconds, fixed width so it sorts as text) for epoch ms ≥ 0. */
export function utcSeconds(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new RangeError(`utcSeconds: non-finite time ${epochMs}`)
  if (epochMs < 0) throw new RangeError(`utcSeconds: time ${epochMs} is before 1970`)
  const iso = new Date(Math.floor(epochMs / 1000) * 1000).toISOString()
  if (!/^\d{4}-/.test(iso)) throw new RangeError(`utcSeconds: year out of range for ${epochMs}`)
  return `${iso.slice(0, 19)}Z`
}

/**
 * Epoch ms of a `utcSeconds` string; NaN if malformed or not a real calendar time (Feb 30, Feb 29
 * of a common year, a year before 1970), which `Date.parse` would otherwise roll over into the
 * next month.
 */
export function parseUtcSeconds(s: string): number {
  if (typeof s !== 'string' || !UTC_SECONDS_RE.test(s)) return Number.NaN
  const ms = Date.parse(s)
  return utcSeconds(ms) === s ? ms : Number.NaN
}
