/**
 * Wall-clock time for save-file metadata only (DESIGN §8 `created_utc`, `started_utc`, session-id
 * time prefix). Never used for response times: those come from `performance.now()` and rAF
 * timestamps (CLAUDE.md, §11.6). This is the one file under `web/src` allowed to read the wall
 * clock (`scripts/timing-lint.test.ts` ALLOW list); everything else takes epoch ms as a parameter.
 */

/** Current wall-clock time in epoch ms. Metadata only, never RT. */
export function wallClockMs(): number {
  return Date.now()
}

/** `YYYY-MM-DDTHH:MM:SSZ` (UTC, whole seconds, fixed width so it sorts as text) for epoch ms. */
export function utcSeconds(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new RangeError(`utcSeconds: non-finite time ${epochMs}`)
  const iso = new Date(Math.floor(epochMs / 1000) * 1000).toISOString()
  if (!/^\d{4}-/.test(iso)) throw new RangeError(`utcSeconds: year out of range for ${epochMs}`)
  return `${iso.slice(0, 19)}Z`
}

/** Epoch ms of a `utcSeconds` string (NaN if malformed). */
export function parseUtcSeconds(s: string): number {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) ? Date.parse(s) : Number.NaN
}
