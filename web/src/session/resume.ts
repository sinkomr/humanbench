/**
 * Picking up an interrupted session (UX-064; provisional default, UX-REVIEW D6 option B; DESIGN §8 "crash
 * recovery", §7.8). A refresh or a crash mid-session leaves the session's autosave behind with no recorded end.
 * When the newest session this browser holds is such a session and started less than 24 hours ago, the ready
 * screen offers to continue it: a NEW session, flagged as a continuation (`CONTINUATION_FLAG`), that does not run
 * again the parts the interrupted one finished and starts the part it was in from its beginning. The two are one
 * sitting: the retest model does not practice-adjust them against each other, and every count the person reads
 * counts them once (`save/sittings.ts`). True resume (the same session, its clock and its next item) is not this.
 *
 * What a session records about how far it got (`run.ts` writes these flags; snake_case booleans, as the save
 * schema's flags allow):
 * - `done_<part>` (e.g. `done_matrix_series`): the part ended normally in this session (not skipped, not cut off);
 * - `completed`: the session reached its end; `finished_early` and `hard_stop` (older) are the other two ends;
 * - `focus_session`: a 20-minute focus session, which is not offered for continuation (its parts were the person's
 *   choice, and the save does not say which).
 *
 * Older autosaves have no `done_` flags, so the flags are read together with what the answers show: a part also
 * counts as finished when a later part has answers, or when every timed task of a part of timed tasks has its answer
 * (the last part included, so an older session that reached its end is not taken for an unfinished one). Both are
 * true of the sitting for any session (a continuation never runs a part its sitting finished or skipped). A part
 * whose skills were all skipped (`skipped_<skill>`) is finished too: it stays skipped in the continuation.
 *
 * Not offered (the flow's part of the rule is in `SessionApp.svelte`): with a server, for a session of the online
 * version (`timed_tasks_only`, a signed session), for a focus session, for a session that ended, or one with nothing
 * left to run. The 24-hour window reads the wall clock: metadata only, never a response time.
 */

import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { orderSessions } from '../engine/retest'
import { A15_SEGMENTS, type SegmentDef, type SegmentId } from '../engine/selector'
import { parseUtcSeconds } from '../save/clock'
import { sittingIndex } from '../save/sittings'
import { CONTINUATION_FLAG, TIMED_TASKS_ONLY_FLAG, type SaveFileV1, type SaveSession } from '../save/types'
import { parseItemId } from '../tasks/ids'
import { getFamily } from '../tasks/registry'

/** How recent an unfinished session must be for the offer: it started less than this long ago. */
export const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000

/** The session reached its end (`run.ts`, end reason `complete`). */
export const COMPLETED_FLAG = 'completed'

/** A focus session (`RunConfig.focus`): only the parts of the chosen skills were planned. */
export const FOCUS_SESSION_FLAG = 'focus_session'

/** The flag of a part that ended normally in a session: `done_<part>`. */
export const doneFlag = (segment: SegmentId): string => `done_${segment}`

/**
 * The flags of how far a session got, which only this browser's crash recovery reads: they stay in the save and are
 * not sent to the server (`SessionRun.serverFlags`).
 */
export function isProgressFlag(name: string): boolean {
  return name.startsWith('done_') || name === COMPLETED_FLAG || name === FOCUS_SESSION_FLAG || name === CONTINUATION_FLAG
}

/** The newest session of this browser, unfinished and recent: what a continuation picks up. */
export interface Unfinished {
  /** The interrupted session (the newest of the save). */
  readonly sessionId: string
  /** Its start (`started_utc`), for "Your session from today at 14:03". */
  readonly startedUtc: string
  /** Parts the sitting finished: shown as done and not run again. */
  readonly done: readonly SegmentId[]
  /** Skills the sitting skipped: skipped again. */
  readonly skipped: readonly AxisCode[]
  /** The first part the continuation runs: the part that was interrupted, from its start. */
  readonly next: SegmentId
}

const SEGMENT_OF_AXIS: ReadonlyMap<AxisCode, SegmentId> = new Map(A15_SEGMENTS.flatMap((s): [AxisCode, SegmentId][] => (s.kind === 'block' ? [[s.axis, s.id]] : s.axes.map((k) => [k, s.id]))))

const axesOf = (s: SegmentDef): readonly AxisCode[] => (s.kind === 'block' ? [s.axis] : s.axes)

/** The part of the A15 plan a response belongs to, by its family's skill; undefined for an id this build cannot place. */
export function segmentOfItem(itemId: string): SegmentId | undefined {
  const ids = parseItemId(itemId)
  const axis = ids === null ? undefined : getFamily(ids.family)?.axis
  return axis === undefined ? undefined : SEGMENT_OF_AXIS.get(axis)
}

/** The session has a recorded end: it reached the end, was finished early, or stopped at the time limit. */
export function sessionEnded(session: Pick<SaveSession, 'flags'>): boolean {
  const f = session.flags
  return f[COMPLETED_FLAG] === true || f.finished_early === true || f.hard_stop === true
}

/** The skills a session skipped (`skipped_<skill>`). */
export function skippedAxes(session: Pick<SaveSession, 'flags'>): AxisCode[] {
  return AXIS_CODES.filter((k) => session.flags[`skipped_${k.toLowerCase()}`] === true)
}

/**
 * The parts one session finished (module comment): `done` ended normally (its `done_` flag, or inferred for an
 * older autosave), `skipped` are the skills it skipped. A part whose skills were all skipped is not in `done`.
 */
export function partsFinished(session: Pick<SaveSession, 'flags' | 'responses'>): { done: Set<SegmentId>; skipped: Set<AxisCode> } {
  const skipped = new Set(skippedAxes(session))
  const answered = new Set<SegmentId>()
  const families = new Set<string>()
  for (const [itemId] of session.responses) {
    const seg = segmentOfItem(itemId)
    if (seg !== undefined) answered.add(seg)
    const ids = parseItemId(itemId)
    if (ids !== null) families.add(ids.family)
  }
  const done = new Set<SegmentId>()
  A15_SEGMENTS.forEach((s, i) => {
    if (axesOf(s).every((k) => skipped.has(k))) return
    const later = A15_SEGMENTS.slice(i + 1).some((t) => answered.has(t.id))
    const allBlocks = s.kind === 'block' && s.blocks.every((b) => families.has(b.family))
    if (session.flags[doneFlag(s.id)] === true || later || allBlocks) done.add(s.id)
  })
  return { done, skipped }
}

/**
 * The unfinished session a continuation would pick up in `save`, or null (module comment): the newest session,
 * with answers and no recorded end, started within {@link RESUME_WINDOW_MS} of `nowMs` (either way: a clock set
 * back does not hide it), not a part of an online sitting or a focus session, with a part left to run. The parts
 * finished are those of its whole sitting (it may itself be a continuation). Never throws.
 */
export function findUnfinished(save: SaveFileV1 | null, nowMs: number): Unfinished | null {
  if (save === null || save.sessions.length === 0) return null
  let ordered: SaveSession[]
  let index: Map<string, number>
  try {
    ordered = orderSessions(save.sessions)
    index = sittingIndex(save.sessions)
  } catch {
    return null
  }
  const newest = ordered[ordered.length - 1]!
  if (newest.responses.length === 0 || sessionEnded(newest)) return null
  const startMs = parseUtcSeconds(newest.started_utc)
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || Math.abs(nowMs - startMs) >= RESUME_WINDOW_MS) return null
  const sitting = ordered.filter((s) => index.get(s.session_id) === index.get(newest.session_id))
  // The online version: its sitting is a device half and a session the server holds, started together.
  const online = (s: SaveSession): boolean => s.sig !== undefined || s.flags[TIMED_TASKS_ONLY_FLAG] === true
  if (sitting.some(online) || ordered.some((s) => s.started_utc === newest.started_utc && online(s))) return null
  if (sitting.some((s) => s.flags[FOCUS_SESSION_FLAG] === true)) return null
  const done = new Set<SegmentId>()
  const skipped = new Set<AxisCode>()
  for (const s of sitting) {
    const f = partsFinished(s)
    for (const id of f.done) done.add(id)
    for (const k of f.skipped) skipped.add(k)
  }
  const next = A15_SEGMENTS.find((s) => !done.has(s.id) && !axesOf(s).every((k) => skipped.has(k)))
  if (next === undefined) return null
  return {
    sessionId: newest.session_id,
    startedUtc: newest.started_utc,
    done: A15_SEGMENTS.filter((s) => done.has(s.id)).map((s) => s.id),
    skipped: AXIS_CODES.filter((k) => skipped.has(k)),
    next: next.id,
  }
}

/**
 * The wall-clock start of the continuation (metadata only, `save/clock.ts`): now, or one second after the
 * interrupted session's start when now is not later to the second (a clock set back, or a very quick return), so the
 * continuation comes right after the session it continues in time order, as the retest model reads it.
 */
export function continuationStartMs(nowMs: number, interruptedUtc: string): number {
  const now = Math.floor(nowMs)
  const prev = parseUtcSeconds(interruptedUtc)
  if (!Number.isFinite(prev) || Math.floor(now / 1000) * 1000 > prev) return now
  return prev + 1000
}
