/**
 * The `bank_version` at the top of a save (DESIGN §8): which item bank the file's sessions were
 * served from, as far as the app that wrote it knows.
 *
 * A file whose sessions were all made on the device (the procedural generators, the timed tasks)
 * says {@link STATIC_BANK_VERSION}. A file that holds a session the server served says that
 * server's bank version, the tag `start_session` returns (e.g. `2026.10.12-b2`). A file can hold
 * sessions of several banks (two sittings a month apart); the field names the LATEST of them
 * ({@link laterBankVersion}), and a merge keeps the latest of its inputs and of the running app.
 *
 * It is a label. Nothing is scored, selected or verified by it: a served session is scored by the
 * server from its own rows, and the per-session MAC (A16) does not cover it. Before 2026-10-13 a
 * file written in the online version said `m1-static` whatever it held (the label was never set
 * from the server's answer); such files keep that label, since a session does not record its bank.
 */

/** The label of a file whose sessions were all made on the device. */
export const STATIC_BANK_VERSION = 'm1-static'

/** A dated bank tag: `YYYY.MM.DD-b<n>`. */
const DATED = /^(\d{4})\.(\d{2})\.(\d{2})-b(\d{1,6})$/u

/**
 * Where a tag stands: the device's label first, then tags that are not dated (by code-unit order),
 * then dated tags by date and build number (so `…-b10` is later than `…-b2`).
 */
function rank(tag: string): [number, string, number] {
  if (tag === STATIC_BANK_VERSION) return [0, '', 0]
  const m = DATED.exec(tag)
  return m === null ? [1, tag, 0] : [2, `${m[1]}${m[2]}${m[3]}`, Number(m[4])]
}

/** The later of two bank versions (a total order, so taking it over any set of files in any order gives one answer). */
export function laterBankVersion(a: string, b: string): string {
  const [ka, sa, na] = rank(a)
  const [kb, sb, nb] = rank(b)
  if (ka !== kb) return ka > kb ? a : b
  if (sa !== sb) return sa > sb ? a : b
  if (na !== nb) return na > nb ? a : b
  return a >= b ? a : b
}

/** The label of a file made from these: the latest of them. Throws a RangeError on an empty list. */
export function latestBankVersion(tags: readonly string[]): string {
  const first = tags[0]
  if (first === undefined) throw new RangeError('latestBankVersion: no versions')
  return tags.reduce(laterBankVersion, first)
}
