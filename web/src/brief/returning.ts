/**
 * Coming back to the page (AI.6; proposal §3.3 "Returning later", §3.6 items 3 and 4; requirement
 * R-17.11): on every load the app compares what the person copied earlier with the bundled gate
 * file and the grammar, and says so when
 * - a line they copied has since been **withdrawn** (its type is blocked for the wording they
 *   copied): "A line in notes you made in 2026-11 has been withdrawn. Re-copy your notes to replace it.";
 * - a line they copied now has **new wording** (or no longer exists); or
 * - the notes' **review-by** month has passed (there are no push notifications; this banner is the
 *   main way people learn that old notes are old).
 * The record of what was copied (`CopiedRecord`) is stored with the person's settings (AI.7,
 * `brief_prefs.contexts[].copied`). Nothing here reads a clock: `today` comes in.
 *
 * The in-app changelog (`switchedOffLines`) lists the line types that are switched off now. The
 * notes themselves never link to it.
 */

import { lineStatus, type GateFile } from './gates'
import { TEMPLATES, TEMPLATE_BY_ID } from './grammar'
import { genericMeaning } from './meaning'
import { REVISIT_MONTHS, TEMPLATES_VERSION, addMonths, MONTH_RE, type BriefLine, type LineId } from './types'

/** One line as it was copied: its template id and the wording version it had. */
export interface CopiedLine {
  readonly id: LineId
  readonly v: string
}

/** What a person copied or downloaded from the builder: the release, the month, and the lines. */
export interface CopiedRecord {
  /** The template release stamp (`TEMPLATES_VERSION`) at the time. */
  readonly templates: string
  /** `YYYY-MM`. */
  readonly month: string
  readonly lines: readonly CopiedLine[]
}

/**
 * The record of what was written for one set of notes: the release, the month, and each standard
 * line's template id and wording version. A custom line is left out (it is the person's own words
 * and is never stored, R-17.12).
 */
export function copiedRecordOf(lines: readonly BriefLine[], month: string): CopiedRecord {
  const seen = new Set<string>()
  const out: CopiedLine[] = []
  for (const l of lines) {
    const t = TEMPLATE_BY_ID.get(l.id)
    if (t === undefined || l.id === 'X1' || seen.has(l.id)) continue
    seen.add(l.id)
    out.push({ id: l.id, v: t.v })
  }
  return { templates: TEMPLATES_VERSION, month, lines: out }
}

export type ReturningKind = 'withdrawn' | 'outdated' | 'review_by'

export interface ReturningNotice {
  readonly kind: ReturningKind
  /** Which set of notes it is about, when the caller labelled them ("Coding and data, Claude Code"). */
  readonly label?: string
  readonly month: string
  /** The line types it is about (empty for `review_by`). */
  readonly lines: readonly LineId[]
  /** The sentence to show. For one withdrawn line it is the approved draft, word for word. */
  readonly message: string
}

export interface CopiedSet {
  readonly label?: string
  readonly copied: CopiedRecord
}

/** Approved draft (proposal §6 "Withdrawal"), used word for word for one withdrawn line. */
export const withdrawnMessage = (month: string, n = 1): string =>
  n === 1
    ? `A line in notes you made in ${month} has been withdrawn. Re-copy your notes to replace it.`
    : `Some lines in notes you made in ${month} have been withdrawn. Re-copy your notes to replace them.`

export const outdatedMessage = (month: string, n = 1): string =>
  n === 1
    ? `A line in notes you made in ${month} has new wording. Re-copy your notes to use it.`
    : `Some lines in notes you made in ${month} have new wording. Re-copy your notes to use it.`

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

/**
 * A `YYYY-MM` month as a person says it ("January 2025"); the stored month stays `YYYY-MM`. A table, not a
 * date object: this file reads no clock (R-17.1, `scripts/brief-source.test.ts`) and a month name does not
 * move with the time zone. Anything that is not a month is returned as it came.
 *
 * The review-by sentence uses it (UX-052); the withdrawal and new-wording sentences keep the stored month,
 * because the approved withdrawal draft is pinned word for word.
 */
export function monthName(month: string): string {
  if (!MONTH_RE.test(month)) return month
  return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
}

export const reviewByMessage = (month: string): string =>
  `The notes you made in ${monthName(month)} may need another look. Check that they still say what you want, and copy them again if you change anything.`

/**
 * Whether the wording a person copied is now withdrawn: its gate entry blocks that wording version,
 * or the wording is the current one and the current status is blocked (which covers a line type that
 * is blocked for lack of an entry, `gates.ts` GATE_REQUIRED).
 */
export function isWithdrawn(line: CopiedLine, gates: GateFile): boolean {
  const e = gates.lines[line.id]
  if (e !== undefined && e.v === line.v && e.status === 'blocked') return true
  const t = TEMPLATE_BY_ID.get(line.id)
  return t !== undefined && t.v === line.v && lineStatus(gates, line.id) === 'blocked'
}

/** Whether a copied line's wording is no longer the current wording (or the line type is gone). */
export function isOutdated(line: CopiedLine): boolean {
  const t = TEMPLATE_BY_ID.get(line.id)
  return t === undefined || t.v !== line.v
}

const monthOf = (today: string): string => today.slice(0, 7)

/** All notices for the sets of notes a person copied, withdrawn first. `today` is `YYYY-MM-DD` or `YYYY-MM`. */
export function returningNotices(sets: readonly CopiedSet[], gates: GateFile, today: string): ReturningNotice[] {
  const now = monthOf(today)
  const out: ReturningNotice[] = []
  for (const kind of ['withdrawn', 'outdated', 'review_by'] as const) {
    for (const { label, copied } of sets) {
      if (!MONTH_RE.test(copied.month)) continue
      const named = label === undefined ? {} : { label }
      if (kind === 'withdrawn') {
        const ids = unique(copied.lines.filter((l) => isWithdrawn(l, gates)).map((l) => l.id))
        if (ids.length > 0) out.push({ kind, ...named, month: copied.month, lines: ids, message: withdrawnMessage(copied.month, ids.length) })
      } else if (kind === 'outdated') {
        const ids = unique(copied.lines.filter((l) => !isWithdrawn(l, gates) && isOutdated(l)).map((l) => l.id))
        if (ids.length > 0) out.push({ kind, ...named, month: copied.month, lines: ids, message: outdatedMessage(copied.month, ids.length) })
      } else if (now > addMonths(copied.month, REVISIT_MONTHS)) {
        out.push({ kind, ...named, month: copied.month, lines: [], message: reviewByMessage(copied.month) })
      }
    }
  }
  return out
}

const unique = (xs: readonly string[]): string[] => [...new Set(xs)]

export interface SwitchedOff {
  readonly id: LineId
  readonly says: string
}

/** The line types that are switched off now (blocked), for the in-app changelog, in the grammar's order. */
export function switchedOffLines(gates: GateFile): SwitchedOff[] {
  return TEMPLATES.filter((t) => t.header !== true && lineStatus(gates, t.id) === 'blocked').map((t) => ({ id: t.id, says: genericMeaning(t.id) ?? '' }))
}
