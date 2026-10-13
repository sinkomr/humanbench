/**
 * The running part of an M1 session (ROADMAP M1.15; DESIGN §7.4 "Session composition", §10, §13;
 * ROADMAP A15, A18): a state machine over the A15 plan that owns the session clock, the response
 * log and the scoring, with no DOM and no timers of its own. The UI (`SessionScreen.svelte`) shows
 * {@link SessionRun.view}, feeds it the renderers' events and calls {@link SessionRun.tick} a few
 * times a second; every duration comes from the injected `now()` (the `performance.now()` timeline),
 * so a test or a fake browser clock drives it deterministically.
 *
 * ## Flow
 *
 * The plan is `planSession` (M1.14): RT → Matrix/Series → Spatial → Memory → Quant →
 * Coding/Reading. Each segment opens with an interstitial ("Up next: Spatial. About 6 min"); the
 * person can start it or skip its axis. A block segment then runs its fixed blocks one after the
 * other (a renderer each, one whole-block response, scored by the family); a CAT segment loops on
 * `selectNext` (information per second) until its axes are done (posterior SD < 0.3), no candidate
 * is left or the segment's time is used up. After every counted power answer the person rates how
 * sure they are (the confidence slider; Brier, `calibration.ts`).
 *
 * ## Time
 *
 * - **Progress** is time, not items: elapsed active seconds over the A15 target.
 * - **Between parts the clock waits** (UX-066): from the moment a part ends (or the session begins)
 *   until Start on the next "Up next" screen, the clock is held, the break offer and Skip on an
 *   interstitial included, so reading what comes next is not session time. The holds are named
 *   (`clock.ts`): the wait for a served item and a break hold it for reasons of their own, so one of
 *   them ending never restarts a clock another still holds.
 * - **Segment budgets.** A CAT segment starts with its planned share (the plan's `budget_s`) or
 *   `(target − elapsed − time of the blocks still to run) / CAT segments left`, whichever is less
 *   (never below 0): slow blocks shorten the parts after them, but a skipped part or time left
 *   unused never makes a later part longer than planned, so a skip shortens the session (UX-066).
 * - **Coverage floor** (§7.4 L584, the M1.15 fix). The ≥ 3-item floor is a requirement, not part
 *   of a segment's budget: the selector is given the time to the hard stop as `floorRemainingS`,
 *   so a segment whose budget ran out (long span blocks, slow items before it) still gets its 3
 *   items, and no more than that once the budget is gone. Before this, QR fell below 3 items in
 *   about 5% of simulated sessions. The floor is per axis, not per session number: earlier
 *   sessions' items are given as `priorItemCounts` (`coverage.ts`), so an axis that no earlier
 *   session covered keeps its floor, e.g. after a session that was abandoned before it.
 * - **Break** (§10, UX-066): offered once, between two parts: before the "Up next" screen of the
 *   part whose planned start (the plan's cumulative time) is nearest half the target (`breakAtS`),
 *   or, when that part was skipped, before the next interstitial shown after it. A plan of one part
 *   has no break. The clock is already held there; taking the break adds a hold of its own.
 * - **Hard stop** (§7.4): at 57 active minutes the session ends where it is; an item in progress is
 *   dropped, an answered item still waiting for its confidence is kept without one. The hard stop
 *   is noticed on the next `tick()`, but the recorded time is the limit, not the late reading.
 * - **Item cap** (§13): a power item that gets no answer within `time_limit_s` is recorded as not
 *   correct (a time-out).
 *
 * ## Served parts (M2.7)
 *
 * With `RunConfig.cat` (a server session, `backend/session.ts`) the CAT parts are not selected
 * here: the server picks every counted item (DESIGN §11.2) and scores the answer where the key
 * is, so this machine never learns whether an answer was right (R-11.1) and the confidence slider
 * is the only thing between an answer and the server. The run waits in the `loading` phase for each
 * item (the clock is paused: waiting for the network is not working), keeps every answer in an
 * outbox until the server has acknowledged it (a failed call leaves the phase `loading` with a
 * `problem` and a way to try again), and records the answers it hands over in a session of its own,
 * with the server's session id ({@link SessionRun.catSessionState}): the copy of it that `finish`
 * returns, signed, replaces this unsigned one in the save (merge, R-8.1, A16). The timed tasks
 * (blocks) stay on the device, are scored here as before, and make the session `sessionState()`.
 *
 * ## Served text parts (M3.11 phase 1)
 *
 * With `RunConfig.textAxes` (and a server) the plan also holds the text parts of `engine/plan-table.ts`
 * (Logical Reasoning, Vocabulary and the three knowledge skills), each with a share of its own on top of
 * the six parts' time. Whether the server has questions for one is only known by asking, so a text part
 * is asked for **before** its "Up next" screen: the run waits in `loading` (`RunView.probing`, the clock
 * held as between any two parts) for the part's first question.
 * - The server has none (any `done` answer): the part is dropped without a word. It leaves the checklist,
 *   the session's target shrinks by its share, no notice is raised and no flag is written; the skill shows
 *   as not measured. With no text part left the session is the M1 session, to the second.
 * - A question comes: it is kept (it stays the server's pending item), the "Up next" screen is shown, and
 *   Start shows that question. Skip on that screen lets it go (`release: 'skipped'`).
 * A text part goes on past its share until `min_items` questions are answered (five: the server publishes
 * a skill from five answers of one session), showing at most `MIN_ITEMS_SLACK` more to get there. The time
 * spent in text parts is kept out of the six parts' budgets, which are those of a session without them.
 * The Quantitative part has the same rule in both versions (`plan-table.ts` A15_MINIMUMS; owner decision
 * 2026-10-12): six answered questions, at most `MIN_ITEMS_SLACK` more shown, its planned time its share
 * plus the rule's `extra_s`, which the session's target grows by. Not in a focus session.
 * A served text item names no family, so a part cannot tell a stray one by looking: when a part is skipped
 * while its question is on the way, the answer to that request is waited for and the item let go before the
 * next part asks.
 *
 * ## Served passages (M3.11 phase 2)
 *
 * A passage question (`render/text/passage.ts`) comes with its passage, and the server serves the questions of
 * one passage together and says of each where it stands in its set (`ServedItem.set`). The passage stays on
 * screen while its questions are answered (owner decision 2026-10-12): {@link RunView.passage} is the same
 * passage from its first question to its last, the short wait for the next question included, so the screen
 * keeps it in place, scrolled where the person left it. Nothing about it is timed afresh between two of its
 * questions: each question has the time limit the server states for it (the first one's covers the reading; the
 * bank sets it), and its response time starts at its own first frame, as for any question.
 * - **A passage is finished once started.** While the server says more questions of the passage are to come,
 *   the next one is asked for whatever the part's time says. Only the hard stop, a skip and "finish early" end a
 *   passage early.
 * - **A part of passages is counted in passages** (`plan-table.ts` `sets`: Reading Comprehension, two). Between
 *   two passages the part ends when it has read that many and has its minimum of answers, or when its time is
 *   used up and it has its minimum; short of the minimum it reads one more (the rule above, `MIN_ITEMS_SLACK`).
 *
 * ## Skipping and finishing
 *
 * Any axis can be skipped at any time (§13 "skip any axis"): w_k = 0, the rest of its segment goes,
 * and its later segments are passed over; what was already answered stays in the save, and the
 * profile shows the axis as not measured (`flags.skipped_<axis>`). "Finish early" ends the session
 * with what there is (§7.4).
 *
 * ## Picking up an interrupted session (UX-064)
 *
 * The flags record how far the session got: `done_<part>` for each part that ended normally here and
 * `completed` for a session that reached its end (`finished_early` and `hard_stop` are the other ends),
 * so an autosave with none of the three is an interrupted session (`resume.ts`). A continuation
 * (`RunConfig.continues`; provisional default, UX-REVIEW D6 option B) is a new session of the same
 * sitting: the parts the interrupted session finished are shown as done and not run, the part it was in
 * starts from its beginning, and `flags.continuation` is set.
 *
 * ## What is recorded
 *
 * §8 response tuples (`[item_id, 0, response, correct, rt_ms, confidence_pct, extra?]`) that
 * `save/rescore.ts` re-scores to the same observations, the session's calibration one included
 * (a block's tuple holds the family's block response, RT's `extra` the scorer's record of the block
 * with the device and input type it was given, A18); the session's integrity logs (`visibilitychange`,
 * paste; M1.19) become `flags` when the state is read. Everything the UI is given about an item is
 * a {@link PublicItem}: its spec and ids, never the key, the parameters or the difficulty.
 */

import { BackendError, problemOf, type LoadProblem } from '../backend/errors'
import type { ServedItem } from '../backend/items'
import type { CatAnswer, CatNext, CatSource, Release } from '../backend/session'
import { AXIS_CODES, isAxisCode, type AxisCode, type Cluster } from '../engine/axes'
import {
  HIDDEN_MAX_S,
  hiddenIntervals,
  integrityReport,
  type IntegrityReport,
  type IntegrityResponse,
  type PasteEvent,
  type VisibilityEvent,
  type VisibilityState,
} from '../engine/integrity'
import { scoreAll, type ScoreResult } from '../engine/scorer'
import {
  A15_TARGET_S,
  COVERAGE_FLOOR,
  STOP_SD,
  planSession,
  selectNext,
  selectionRng,
  sessionPosterior,
  type AdministeredItem,
  type AnyItem,
  type AxisWeights,
  type NoItemReason,
  type PlannedStep,
  type SegmentId,
} from '../engine/selector'
import { isJsonValue, type JsonValue, type Observation, type ResponseTuple } from '../engine/types'
import { TEXT_PASSAGE_RENDERER, isPassageSpec, passageTextOf, type PassageText } from '../render/text/passage'
import type { RtInputMode, RtInputType } from '../render/rt/keys'
import type { SessionState } from '../save/create'
import { CONTINUATION_FLAG, TIMED_TASKS_ONLY_FLAG, type DeviceInfo, type SessionFlags } from '../save/types'
import { MalformedResponseError, type AnyFamily } from '../tasks/family'
import { getFamily } from '../tasks/registry'
import { rtBlockObservation, type RtItem, type RtResponse } from '../tasks/rt'
import { calibrationObservation, calibrationSummary, type CalibrationSummary, type RatedAnswer } from '../tasks/calibration'
import { confidenceFloorPct, confidenceStartPct, isConfidencePct } from './calibration'
import { A15_TYPICAL_OVER_S, MIN_ITEMS_SLACK, textPartById } from '../engine/plan-table'
import { DEFAULT_ITEM_LIMIT_S, HARD_STOP_S } from './constants'
import { COMPLETED_FLAG, doneFlag, FOCUS_SESSION_FLAG, isProgressFlag } from './resume'
import { SEGMENT_INFO } from './segments'
import { SessionClock, type NowMs } from './clock'

// ------------------------------------------------------------------------------- types

export type RunPhase =
  /** "Up next: …" for the current segment. */
  | 'interstitial'
  /** A fixed block is running in its renderer. */
  | 'block'
  /** The server is picking the next item (M2.7); the clock is paused. */
  | 'loading'
  /** A CAT item is on screen, waiting for an answer. */
  | 'item'
  /** The item was answered; the confidence slider is showing. */
  | 'confidence'
  /** The break is suggested, between two parts (the clock is held). */
  | 'break_offer'
  /** On a break: the clock is paused. */
  | 'on_break'
  | 'finished'

export type EndReason = 'complete' | 'finish_early' | 'hard_stop'

export type SegmentStatus = 'upcoming' | 'current' | 'done' | 'skipped' | 'not_reached'

export type { LoadProblem }

export type NoticeKind = 'timeout' | 'skipped' | 'unavailable' | 'unsupported' | 'malformed'

/** A short message about what just happened; `seq` changes with every notice so a screen reader announces it again. */
export interface Notice {
  readonly kind: NoticeKind
  readonly seq: number
  readonly axis?: AxisCode
  /** A `timeout` of a question the server holds: there it is left out of the scores, not counted as wrong. */
  readonly served?: boolean
}

/** Why the run changed, for the persistence layer (autosave after `response`, `skip`, `break`, `finish`). */
export type ChangeKind = 'phase' | 'response' | 'skip' | 'break' | 'finish'

export interface SegmentView {
  readonly id: SegmentId
  readonly title: string
  readonly cluster: Cluster
  readonly axes: readonly AxisCode[]
  readonly kind: 'block' | 'cat'
  /** Whole minutes for "About N min". */
  readonly minutes: number
  readonly status: SegmentStatus
}

/** An item as the UI may see it: the render payload and ids, never the key, params or difficulty. */
export interface PublicItem {
  readonly item_id: string
  readonly family: string
  readonly axis: AxisCode
  readonly item_type: string
  readonly spec: object
  /** Options of a multiple-choice item; absent for typed entry. */
  readonly options_count?: number
  readonly time_limit_s: number
}

/** A fixed block as the UI may see it. */
export interface PublicBlock {
  readonly item_id: string
  readonly family: string
  readonly axis: AxisCode
  readonly item_type: string
  readonly spec: object
}

/** The passage the question on screen is about (M3.11 phase 2), as the screen keeps it across its questions. */
export interface PassageView extends PassageText {
  /** The place of the question on screen among the passage's questions, when the server said it; null while the next one is fetched. */
  readonly position: { readonly index: number; readonly of: number } | null
}

export interface RunView {
  readonly phase: RunPhase
  readonly ended: EndReason | null
  readonly segments: readonly SegmentView[]
  readonly segmentIndex: number
  readonly segment: SegmentView | null
  readonly item: PublicItem | null
  readonly block: PublicBlock | null
  /** The slider of the answered item; null outside the `confidence` phase. */
  readonly confidence: { readonly floorPct: number; readonly startPct: number; readonly optionsCount: number | null } | null
  /** The renderer could not draw the current item (e.g. no WebGL): offer the skip (§13). */
  readonly unavailable: boolean
  readonly notice: Notice | null
  readonly elapsedS: number
  readonly targetS: number
  /** The planned session second the break is placed nearest to (half the target unless configured). */
  readonly breakAtS: number
  /** The part before whose "Up next" screen the break is offered; null when the plan has no boundary for it. */
  readonly breakBefore: SegmentId | null
  /** The clock is held (an "Up next" screen, the break offer, a break, the wait for a served item). */
  readonly clockHeld: boolean
  readonly hardStopS: number
  readonly counts: { readonly items: number; readonly blocks: number }
  readonly skipped: readonly AxisCode[]
  /** The axis "Skip this skill" would skip now (the current unit's), or null. */
  readonly skippable: AxisCode | null
  readonly rtInput: RtInputMode
  readonly device: DeviceInfo
  /** A focus session (`RunConfig.focus`): only the chosen parts run. */
  readonly focus: boolean
  /** The CAT parts are served by the server (`RunConfig.cat`). */
  readonly served: boolean
  /** In the `loading` phase: why it is stuck, or null while the request is under way. */
  readonly problem: LoadProblem | null
  /** The id of the served item on screen (the one a problem report names), or null. */
  readonly reportable: string | null
  /** In the `loading` phase: the wait is for the first question of a text part that may not exist (M3.11), before its "Up next" screen. */
  readonly probing: boolean
  /**
   * The passage of the question on screen, and of the wait for the next question of the same passage (module
   * comment, "Served passages"); null on every other screen.
   */
  readonly passage: PassageView | null
}

export interface RunConfig {
  readonly sessionId: string
  /** Wall-clock epoch ms at the start (save metadata only, `save/clock.ts`). */
  readonly startedMs: number
  /** The session timeline in ms: `performance.now()` (times the fast-flag factor). */
  readonly now: NowMs
  readonly device: DeviceInfo
  /** The RT input mode chosen in the device check. */
  readonly rtInput: RtInputMode
  /** Seed of the plan and the selection; default the session id. */
  readonly seed?: string
  /**
   * CAT items per axis earlier sessions already hold (`coverage.ts` `priorItemCounts`; default
   * none). The ≥ 3-item coverage floor is per axis: an axis with 3 or more is free of it, so a
   * session that was abandoned early does not lift the floor of an axis it never reached.
   */
  readonly priorItemCounts?: Readonly<Partial<Record<AxisCode, number>>>
  /** family_ids seen in earlier sessions (§7.7), excluded from this one. */
  readonly seenFamilies?: readonly string[]
  /** Axes skipped from the start. */
  readonly skipped?: readonly AxisCode[]
  /**
   * A focus session (DESIGN §10 "focus sessions of 20 minutes that target chosen axes"; ROADMAP
   * M1.R): only the parts that hold these skills are planned. The other skills get w_k = 0 but are
   * NOT marked skipped: the person did not decline them, they are just not in this session, so
   * neither the save's flags nor the profile treat them as skipped.
   */
  readonly focus?: readonly AxisCode[]
  /**
   * A continuation (UX-064; provisional default, UX-REVIEW D6 option B; `resume.ts`): this new session picks up an
   * interrupted one of the same sitting. The parts it finished (`done`) stay in the plan, shown as done, and are not
   * run again; the skills it skipped stay skipped (shown as skipped); the first part left starts from its beginning.
   * The session is flagged {@link CONTINUATION_FLAG}, so the retest model does not practice-adjust the two against
   * each other (§7.8). Its target is the planned time of the parts left, and no break is offered before its first part.
   */
  readonly continues?: { readonly done: readonly SegmentId[]; readonly skipped: readonly AxisCode[] }
  /** Session target seconds (default {@link A15_TARGET_S}; a continuation's is the planned time of the parts it runs). */
  readonly targetS?: number
  /**
   * The planned session second the break is offered nearest to: the boundary between two parts whose
   * planned cumulative time is closest to it (default half the target, UX-066).
   */
  readonly breakAtS?: number
  readonly hardStopS?: number
  /** Per-axis stop SD (default 0.3, §7.4 L588). */
  readonly stopSd?: number
  /** Called after every change with its kind. */
  readonly onChange?: (kind: ChangeKind) => void
  /**
   * M2.7: the server serves and scores the CAT parts (module comment, "Served parts"). Absent in the
   * static version, whose behaviour is then exactly that of M1.
   */
  readonly cat?: CatSource
  /**
   * M3.11 phase 1: the axes whose served text parts this session asks the server for (module comment,
   * "Served text parts"). Only with `cat`, and not in a focus session or a continuation. Absent or
   * empty: the M1 plan exactly.
   */
  readonly textAxes?: readonly AxisCode[]
}

/** One fixed block's outcome, for tests and the results screen. */
export interface BlockRecord {
  readonly item_id: string
  readonly family: string
  readonly axis: AxisCode
  readonly observed: boolean
  readonly flags: readonly string[]
  readonly reasons: readonly string[]
}

export interface RunResult {
  readonly reason: EndReason | null
  readonly durationS: number
  /** Item and block observations, plus the session's calibration observation when it has one. */
  readonly observations: readonly Observation[]
  /** The correlated MAP and per-axis EAP of `observations`, or null with none. */
  readonly score: ScoreResult | null
  readonly skipped: readonly AxisCode[]
  readonly calibration: CalibrationSummary | null
  readonly integrity: IntegrityReport
  /** CAT items answered or timed out, by axis. */
  readonly itemsByAxis: Readonly<Partial<Record<AxisCode, number>>>
  readonly blocks: readonly BlockRecord[]
  /** How each CAT segment ended: the selector's reason, or 'skipped'. */
  readonly segmentEnds: readonly { readonly segment: SegmentId; readonly reason: NoItemReason | 'skipped' }[]
  /** Each CAT segment that started: its planned share and the budget it started with (never more, UX-066). */
  readonly budgets: readonly { readonly segment: SegmentId; readonly plannedS: number; readonly budgetS: number }[]
}

// ---------------------------------------------------------------------------- internals

interface Segment {
  readonly id: SegmentId
  readonly kind: 'block' | 'cat'
  readonly axes: readonly AxisCode[]
  readonly steps: readonly PlannedStep[]
  /** `absent`: a text part the server had no question for; it is in no view (M3.11). */
  status: SegmentStatus | 'absent'
  /** A served text part (M3.11): its minimum of answered questions, and for a part of passages how many it reads. Undefined on the A15 parts. */
  readonly optional?: { readonly min_items: number; readonly sets?: number }
  /** Passages this part has shown a question of (their keys), in order. */
  readonly setsShown: string[]
  /** An A15 part with a minimum of answered questions (Quant), and the planned seconds it adds to the part's share. */
  readonly minimum?: { readonly min_items: number; readonly extra_s: number }
  /** A text part whose first question has been asked for (it is held, or the part is absent). */
  probed: boolean
  /** Start was pressed and the part has not ended yet. */
  running: boolean
  /** Planned seconds: the blocks' E[T], or the plan's `budget_s` of a CAT segment (its planned share). */
  readonly plannedS: number
  /** CAT: seconds this segment may use (set when it starts). */
  budgetS: number
  startedAtS: number
}

interface CurrentItem {
  /** The generated item (key and parameters) of the static version; null for an item the server served. */
  readonly item: AnyItem | null
  /** The server's item (M2.7); null in the static version. */
  readonly served: ServedItem | null
  readonly startedMs: number
  onsetMs: number | null
  unavailable: boolean
  /** `correct` is null for a served item: the server holds the key (R-11.1). */
  pending: { response: JsonValue; correct: 0 | 1 | null; endMs: number; rtMs: number } | null
}

/** What the screens may know of the item on screen, whoever made it. */
interface ItemFacts {
  readonly item_id: string
  readonly family: string
  readonly axis: AxisCode
  readonly item_type: string
  readonly spec: object
  readonly options_count: number | undefined
  readonly time_limit_s: number | null | undefined
}

/** The answers of one served part that are on their way to the server. */
interface Loading {
  readonly segment: Segment
  readonly axes: readonly AxisCode[]
  /** The request is the first of a text part, made before its "Up next" screen (M3.11). */
  readonly probe: boolean
}

interface CurrentBlock {
  readonly step: Extract<PlannedStep, { kind: 'block' }>
  readonly startedMs: number
  inputType: RtInputType | null
  /** Where the RT block's response timestamps came from (§11.6); null = not reported. */
  timestampSource: 'event' | 'handler' | 'mixed' | null
  timestampReason: string | null
}

const round1 = (x: number): number => Math.max(0, Math.round(x * 10) / 10)

/** The scorer observation of a keyed item answer, or null for a model that is not dichotomous. */
function itemObservation(item: AnyItem, y: 0 | 1): Observation | null {
  const p = item.params
  switch (p.model) {
    case '2pl':
    case '2pl_testlet': // scored as a 2PL observation (the testlet effect is M3.9's)
      return { kind: '2pl', axis: item.axis, a: p.a, b: p.b, y }
    case '3pl':
      return { kind: '3pl', axis: item.axis, a: p.a, b: p.b, c: p.c, y }
    default:
      return null
  }
}

function familyOf(name: string): AnyFamily {
  const f = getFamily(name)
  if (f === undefined) throw new Error(`session: family ${name} is not registered`)
  return f
}

/**
 * Whether `response` is an answer the renderer of a served item could have given: an option position
 * for a multiple-choice item, text for a typed one (the checks `mcResponseIndex` and `entryResponse` make
 * for a generated item, without the key). Anything else is not sent.
 */
export function servedResponseFits(item: ServedItem, response: unknown): boolean {
  if (item.options_count !== undefined) return typeof response === 'number' && Number.isInteger(response) && response >= 0 && response < item.options_count
  return typeof response === 'string' && response.length <= 256
}

/** Whole minutes for "About N min" (at least 1). */
function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/** A minimum on the interstitial's estimate of a first-session CAT segment: the 3-item floor takes about this long. */
const FLOOR_SEGMENT_MIN_S = 120

/** How many times a served part lets go of an item left pending by another part before it gives up (M2.7). */
const MAX_FOREIGN_RELEASES = 3

// -------------------------------------------------------------------------------- run

export class SessionRun {
  readonly sessionId: string
  readonly #cfg: RunConfig
  readonly #seed: string
  readonly #clock: SessionClock
  /** The target without the text parts and without what a part's minimum adds: the A15 target, a focus session's, or a continuation's. */
  readonly #baseTargetS: number
  /** Planned seconds the minimums of the parts still to run add to the target (Quant's six questions). */
  readonly #minimumExtraS: number
  /** `RunConfig.breakAtS`, or half the plan's target without the text parts. */
  readonly #baseBreakAtS: number
  /** Without text parts: the index of the segment before whose interstitial the break is offered, or -1 (see the module comment). */
  readonly #fixedBreakIdx: number
  /** The plan holds text parts (M3.11): the target and the break follow the ones still there. */
  readonly #hasOptional: boolean
  /** Active seconds spent in text parts so far: kept out of the A15 parts' budgets. */
  #optionalSpentS = 0
  /** The first question of the text part about to be announced, kept from the request made before its "Up next" screen. */
  #held: { segment: Segment; item: ServedItem } | null = null
  /** A request abandoned by a skip whose answer is still to come: the next request waits for it (module comment). */
  #stray: Promise<void> | null = null
  /** The passage under way (M3.11 phase 2): its text, the part it belongs to, and whether the server has more questions of it. */
  #passage: { readonly text: PassageText; readonly segment: Segment; readonly position: { readonly index: number; readonly of: number } | null; readonly more: boolean } | null = null
  /** The session is the standard one (no focus, no continuation, no target of its own): its typical length is known (`plan-table.ts`). */
  readonly #standard: boolean
  readonly #hardStopS: number
  readonly #stopSd: number
  readonly #priorCounts: Readonly<Partial<Record<AxisCode, number>>>
  readonly #seenBase: readonly string[]
  readonly #segments: Segment[]
  readonly #weights: Partial<Record<AxisCode, number>> = {}
  readonly #skipped = new Set<AxisCode>()
  readonly #listeners = new Set<(kind: ChangeKind) => void>()

  #device: DeviceInfo
  #rtInput: RtInputMode
  #phase: RunPhase = 'interstitial'
  #segIdx = -1
  #blockIdx = 0
  #current: CurrentItem | null = null
  #currentBlock: CurrentBlock | null = null
  #endReason: EndReason | null = null
  #breakOffered = false
  #breaks = 0
  /** Confidence ratings confirmed without the slider being moved (UX-063): recorded as not rated. */
  #untouched = 0
  /** Parts that ended normally in this session (`done_<part>` flags, read by `resume.ts`). */
  readonly #doneHere = new Set<SegmentId>()
  #afterBreak: (() => void) | null = null
  #noticeSeq = 0
  #notice: Notice | null = null
  /** New screens since the notice was raised (see {@link SessionRun.#raise}). */
  #noticeScreens = 0

  readonly #obs: Observation[] = []
  readonly #responses: ResponseTuple[] = []
  readonly #administered: AdministeredItem[] = []
  readonly #integrity: IntegrityResponse[] = []
  readonly #rated: RatedAnswer[] = []
  readonly #seenItems: string[] = []
  readonly #seenFamilies: string[] = []
  readonly #blockRecords: BlockRecord[] = []
  readonly #segmentEnds: { segment: SegmentId; reason: NoItemReason | 'skipped' }[] = []
  readonly #budgets: { segment: SegmentId; plannedS: number; budgetS: number }[] = []
  readonly #visibility: VisibilityEvent[] = []
  readonly #paste: PasteEvent[] = []
  // Served parts (M2.7): see the module comment. All empty and unused without `cfg.cat`.
  readonly #cat: CatSource | undefined
  readonly #catResponses: ResponseTuple[] = []
  readonly #catSeen: string[] = []
  readonly #catAxes: AxisCode[] = []
  /** The axes of this session's questions, served or made here, that got an answer (not a time-out): a part's minimum counts these. */
  readonly #answeredAxes: AxisCode[] = []
  readonly #outbox: CatAnswer[] = []
  #loading: Loading | null = null
  #problem: LoadProblem | null = null
  #fetchSeq = 0
  /** The `next` call that is under way, so a skip can let go of the item it may still bring. */
  #inFlight: { seq: number; asked: Promise<CatNext> } | null = null
  #flushing: Promise<void> | null = null
  /** The windows of the served answers (onset, end) on the session timeline, for the integrity flags. */
  readonly #catWindows: { onset: number; end: number }[] = []
  #report: { key: string; value: IntegrityReport } | null = null
  /** True while the constructor runs: no change event fires before the caller holds the run. */
  #booting = true

  /** Starts the session: the plan is drawn, the clock starts and the first interstitial is up. */
  constructor(cfg: RunConfig) {
    this.#cfg = cfg
    this.sessionId = cfg.sessionId
    this.#seed = cfg.seed ?? cfg.sessionId
    const planTargetS = cfg.targetS ?? A15_TARGET_S
    this.#baseBreakAtS = cfg.breakAtS ?? planTargetS / 2
    this.#hardStopS = cfg.hardStopS ?? HARD_STOP_S
    this.#stopSd = cfg.stopSd ?? STOP_SD
    this.#priorCounts = cfg.priorItemCounts ?? {}
    this.#seenBase = cfg.seenFamilies ?? []
    this.#device = cfg.device
    this.#rtInput = cfg.rtInput
    this.#cat = cfg.cat
    this.#standard = cfg.targetS === undefined && cfg.focus === undefined && cfg.continues === undefined
    for (const k of cfg.skipped ?? []) this.#markSkipped(k)
    if (cfg.focus !== undefined) for (const k of AXIS_CODES) if (!cfg.focus.includes(k) && !this.#skipped.has(k)) this.#weights[k] = 0
    // Text parts only where the server serves (M3.11): never in the static version, a focus session or a continuation.
    const textAxes = cfg.cat !== undefined && cfg.focus === undefined && cfg.continues === undefined ? (cfg.textAxes ?? []) : []
    const plan = planSession({ sessionSeed: this.#seed, weights: this.#weights as AxisWeights, targetS: planTargetS, seenFamilies: this.#seenBase, textAxes, minimums: cfg.focus === undefined })
    this.#segments = SessionRun.#group(plan)
    this.#hasOptional = this.#segments.some((s) => s.optional !== undefined)
    const cont = cfg.continues
    if (cont !== undefined) {
      // Marked after the plan is drawn, so the parts stay on the checklist: done, or skipped, not "not in this version".
      for (const k of cont.skipped) if (!this.#skipped.has(k)) this.#markSkipped(k)
      for (const s of this.#segments) {
        if (cont.done.includes(s.id)) s.status = 'done'
        else if (s.axes.every((k) => this.#skipped.has(k))) s.status = 'skipped'
      }
    }
    const left = this.#segments.filter((s) => s.status === 'upcoming')
    this.#minimumExtraS = (cont === undefined ? this.#segments : left).reduce((t, s) => t + (s.minimum?.extra_s ?? 0), 0)
    this.#baseTargetS = cont === undefined ? planTargetS : Math.max(60, left.reduce((t, s) => t + s.plannedS, 0) - this.#minimumExtraS)
    const halfWay = SessionRun.#halfWay(this.#segments, this.#baseBreakAtS)
    // A continuation offers the break only between two of its own parts, never before the first one.
    this.#fixedBreakIdx = cont !== undefined && halfWay <= this.#nextLive(-1) ? -1 : halfWay
    this.#clock = new SessionClock(cfg.now)
    this.#clock.start()
    this.#enterNextSegment()
    this.#booting = false
  }

  /** The plan's steps grouped into segments, in order (consecutive steps share a segment id). */
  static #group(plan: readonly PlannedStep[]): Segment[] {
    const out: Segment[] = []
    for (const step of plan) {
      const last = out[out.length - 1]
      if (last !== undefined && last.id === step.segment) {
        ;(last.steps as PlannedStep[]).push(step)
        continue
      }
      const axes = step.kind === 'block' ? [step.axis] : [...step.axes]
      const optional = step.kind === 'cat' && step.optional !== undefined ? { optional: step.optional } : {}
      const minimum = step.kind === 'cat' && step.minimum !== undefined ? { minimum: step.minimum } : {}
      out.push({ id: step.segment, kind: step.kind, axes, steps: [step], status: 'upcoming', ...optional, ...minimum, setsShown: [], probed: false, running: false, plannedS: 0, budgetS: 0, startedAtS: 0 })
    }
    return out.map((s) => ({ ...s, plannedS: s.steps.reduce((t, st) => t + (st.kind === 'block' ? st.item.expected_time_s : st.budget_s), 0) }))
  }

  /**
   * The segment before whose interstitial the break goes: of the boundaries between two segments, the
   * one whose planned cumulative time is nearest `atS` (the earlier one on a tie); -1 with one segment.
   */
  static #halfWay(segments: readonly Segment[], atS: number): number {
    let best = -1
    let bestGap = Infinity
    let cum = 0
    let prev: Segment | null = null
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!
      if (s.status === 'absent') continue // a text part the server did not have (M3.11): no boundary of its own
      if (prev !== null) {
        cum += prev.plannedS
        const gap = Math.abs(cum - atS)
        if (gap < bestGap) {
          best = i
          bestGap = gap
        }
      }
      prev = s
    }
    return best
  }

  /** Planned seconds of the text parts that are still in the session (M3.11): what they add to the plan. */
  #optionalPlannedS(): number {
    let t = 0
    for (const s of this.#segments) if (s.optional !== undefined && s.status !== 'absent') t += s.plannedS
    return t
  }

  /** Typical seconds of the text parts that are still in the session: what they add to the target the ring shows. */
  #optionalTypicalS(): number {
    let t = 0
    for (const s of this.#segments) if (s.optional !== undefined && s.status !== 'absent') t += textPartById(s.id)?.typical_s ?? s.plannedS
    return t
  }

  /**
   * The session's target now, which is what the progress ring fills toward and says ("of about 45 min"): the
   * A15 target and what the minimums add, plus, for the standard session, what it typically runs over its
   * plan, and the typical time of the text parts still there (`plan-table.ts`, "How long a session is said to
   * be"). So the ring says the figure the welcome screen said. A focus session, a continuation and a session
   * given a target of its own keep that target. The budgets and the break are worked out from the plan, not
   * from this.
   */
  #targetS(): number {
    const base = this.#baseTargetS + this.#minimumExtraS + (this.#standard ? A15_TYPICAL_OVER_S : 0)
    return this.#hasOptional ? base + this.#optionalTypicalS() : base
  }

  /** The planned second the break is placed nearest to (half the target unless configured). */
  #breakAtS(): number {
    return this.#hasOptional && this.#cfg.breakAtS === undefined ? this.#baseBreakAtS + this.#optionalPlannedS() / 2 : this.#baseBreakAtS
  }

  /** Index of the segment before whose interstitial the break is offered, or -1 (see the module comment). */
  #breakIdx(): number {
    return this.#hasOptional ? SessionRun.#halfWay(this.#segments, this.#breakAtS()) : this.#fixedBreakIdx
  }

  // ------------------------------------------------------------------------------- views

  subscribe(fn: (kind: ChangeKind) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #emit(kind: ChangeKind): void {
    if (this.#booting) return
    for (const fn of [...this.#listeners]) fn(kind)
    this.#cfg.onChange?.(kind)
  }

  /**
   * Show a notice. It lives for the screen it was raised on and the next one (a skip is told on the
   * interstitial that follows, a time-out on the next question), and is gone after that: "Reaction Time
   * skipped" does not stay on screen half an hour later (UX-003).
   */
  #raise(notice: Omit<Notice, 'seq'>): void {
    this.#notice = { ...notice, seq: ++this.#noticeSeq }
    this.#noticeScreens = 0
  }

  /** A new screen is up (an interstitial, a block, a question, the break offer or the break): ages the notice. */
  #newScreen(): void {
    if (this.#notice !== null && ++this.#noticeScreens > 1) this.#notice = null
  }

  #segmentView(s: Segment): SegmentView {
    const info = SEGMENT_INFO[s.id]
    const idx = this.#segments.indexOf(s)
    let seconds: number
    if (s.kind === 'block') seconds = s.steps.reduce((t, st) => t + (st.kind === 'block' ? st.item.expected_time_s : 0), 0)
    else seconds = s.status === 'current' && s.budgetS > 0 ? s.budgetS : this.#budgetFor(idx)
    // A part that runs to a number of answers takes its planned time however little of the shared time is left.
    if (s.minimum !== undefined && s.axes.some((k) => !this.#skipped.has(k))) seconds = Math.max(seconds, s.plannedS)
    if (s.kind === 'cat' && s.axes.some((k) => !this.#skipped.has(k) && this.#itemsOn(k) < COVERAGE_FLOOR)) seconds = Math.max(seconds, FLOOR_SEGMENT_MIN_S)
    // An absent part is in no view (`view()` leaves it out); the cast is for the type only.
    return { id: s.id, title: info.title, cluster: info.cluster, axes: s.axes, kind: s.kind, minutes: minutesOf(seconds), status: s.status as SegmentStatus }
  }

  /** What the screens may know of the item on screen, whoever made it. */
  #facts(cur: CurrentItem): ItemFacts {
    const i = cur.item
    if (i !== null) {
      return { item_id: i.item_id, family: i.family, axis: i.axis, item_type: i.item_type, spec: i.spec, options_count: i.options_count, time_limit_s: i.time_limit_s }
    }
    const sv = cur.served!
    return { item_id: sv.item_id, family: sv.family, axis: this.#servedAxis(sv), item_type: sv.item_type, spec: sv.spec, options_count: sv.options_count, time_limit_s: sv.time_limit_s }
  }

  /**
   * The axis a served item is on. The server does not say (it hands over only what a client may
   * see): the family it names is a registered one for every item of the M1 pool, else it is the
   * part's own axis (the three served parts have one each).
   */
  #servedAxis(sv: ServedItem): AxisCode {
    const known = getFamily(sv.family)?.axis
    if (known !== undefined) return known
    const seg = this.#segments[this.#segIdx]
    return seg?.axes.find((k) => !this.#skipped.has(k)) ?? seg?.axes[0] ?? 'MAT'
  }

  view(): RunView {
    const seg = this.#segments[this.#segIdx]
    const cur = this.#current
    const facts = cur === null ? null : this.#facts(cur)
    let confidence: RunView['confidence'] = null
    if (this.#phase === 'confidence' && facts !== null) {
      const k = facts.options_count
      const floorPct = confidenceFloorPct(k)
      confidence = { floorPct, startPct: confidenceStartPct(floorPct), optionsCount: k ?? null }
    }
    const probing = this.#phase === 'loading' && this.#loading?.probe === true
    const held = this.#passage
    let passage: PassageView | null = null
    if (held !== null) {
      // (also in the instant between an answer being recorded and the next request: the passage is not taken away and put back)
      const onQuestion = this.#phase === 'item' || this.#phase === 'confidence'
      // The wait for the next question of the passage is still the passage's screen; the place is the next question's to say.
      const between = this.#phase === 'loading' && !probing && held.more && this.#loading?.segment === held.segment
      if (onQuestion) passage = { ...held.text, position: held.position }
      else if (between) passage = { ...held.text, position: null }
    }
    let skippable: AxisCode | null = null
    if (this.#phase === 'item' || this.#phase === 'confidence') skippable = facts?.axis ?? null
    else if (this.#phase === 'block') skippable = this.#currentBlock?.step.axis ?? null
    // A part being asked for is not named while the wait goes well; when it fails, skipping it is a way on.
    else if (probing) skippable = this.#problem === null ? null : (this.#loading!.axes[0] ?? null)
    else if ((this.#phase === 'interstitial' || this.#phase === 'loading') && seg !== undefined) skippable = seg.axes.find((k) => !this.#skipped.has(k)) ?? null
    // A text part the server did not have is in no view (M3.11): the lists and the index are those of the parts that exist.
    const shown = this.#segments.filter((s) => s.status !== 'absent')
    return {
      phase: this.#phase,
      ended: this.#endReason,
      segments: shown.map((s) => this.#segmentView(s)),
      segmentIndex: seg === undefined ? this.#segIdx : shown.indexOf(seg),
      segment: seg === undefined || seg.status === 'absent' ? null : this.#segmentView(seg),
      item:
        facts === null
          ? null
          : {
              item_id: facts.item_id,
              family: facts.family,
              axis: facts.axis,
              item_type: facts.item_type,
              spec: facts.spec,
              ...(facts.options_count === undefined ? {} : { options_count: facts.options_count }),
              time_limit_s: facts.time_limit_s ?? DEFAULT_ITEM_LIMIT_S,
            },
      block:
        this.#currentBlock === null
          ? null
          : {
              item_id: this.#currentBlock.step.item.item_id,
              family: this.#currentBlock.step.family,
              axis: this.#currentBlock.step.axis,
              item_type: this.#currentBlock.step.item.item_type,
              spec: this.#currentBlock.step.item.spec,
            },
      confidence,
      unavailable: cur?.unavailable ?? false,
      notice: this.#notice,
      elapsedS: this.elapsedS(),
      targetS: this.#targetS(),
      breakAtS: this.#breakAtS(),
      breakBefore: this.#segments[this.#breakIdx()]?.id ?? null,
      clockHeld: this.#clock.paused,
      hardStopS: this.#hardStopS,
      counts: { items: this.#administered.length + this.#catAnswered(), blocks: this.#blockRecords.length },
      skipped: [...this.#skipped],
      skippable,
      rtInput: this.#rtInput,
      device: this.#device,
      focus: this.#cfg.focus !== undefined,
      served: this.#cat !== undefined,
      problem: this.#phase === 'loading' ? this.#problem : null,
      reportable: cur?.served != null && (this.#phase === 'item' || this.#phase === 'confidence') ? cur.served.item_id : null,
      probing,
      passage,
    }
  }

  get phase(): RunPhase {
    return this.#phase
  }

  /**
   * Active seconds so far (cheap; the ring reads it every tick). Never more than the hard stop: a
   * stop noticed late (a block on screen, a throttled timer) ends the session at the limit
   * (`#finish`), so a reading above it would go backwards when the session ends.
   */
  elapsedS(): number {
    return Math.min(this.#clock.elapsedS(), this.#hardStopS)
  }

  // ---------------------------------------------------------------------------- limits

  /** Ends the session at the hard stop; true when it has ended (now or before). */
  #limitsHit(): boolean {
    if (this.#phase === 'finished') return true
    if (this.#clock.elapsedS() >= this.#hardStopS) {
      this.#finish('hard_stop')
      return true
    }
    return false
  }

  /** A boundary between units: `next` runs unless the hard stop has come (the break is offered between parts, {@link #enterNextSegment}). */
  #boundary(next: () => void): void {
    if (this.#limitsHit()) return
    next()
  }

  // ------------------------------------------------------------------------- segments

  /** CAT items on `axis` so far: earlier sessions' and this one's (the coverage floor counts both). */
  #itemsOn(axis: AxisCode): number {
    let n = this.#priorCounts[axis] ?? 0
    for (const a of this.#administered) if (a.axis === axis) n++
    for (const a of this.#catAxes) if (a === axis) n++
    return n
  }

  /** Served items answered so far (M2.7). */
  #catAnswered(): number {
    return this.#catAxes.length
  }

  /** Budget in seconds for the CAT segment at `idx` if it started now: at most its planned share (see the module comment). */
  #budgetFor(idx: number): number {
    // A text part has its own share (M3.11). The A15 parts share the A15 target as if no text part existed:
    // the time spent in text parts is not on their clock, and text parts are not counted among them.
    const own = this.#segments[idx]
    if (own?.optional !== undefined) return own.plannedS
    const elapsed = this.#clock.elapsedS() - this.#optionalSpentS
    let blocksAfter = 0
    let catLeft = 0
    for (let i = idx; i < this.#segments.length; i++) {
      const s = this.#segments[i]!
      if (s.optional !== undefined) continue
      if (s.status === 'done' || s.status === 'skipped' || s.axes.every((k) => this.#skipped.has(k))) continue
      if (s.kind === 'cat') catLeft++
      else if (i > idx) blocksAfter += s.steps.reduce((t, st) => t + (st.kind === 'block' ? st.item.expected_time_s : 0), 0)
    }
    if (catLeft === 0) return 0
    // What a minimum adds (Quant) is the part's own, on top of its share of the target.
    const extra = own?.minimum?.extra_s ?? 0
    const planned = (own?.plannedS ?? 0) - extra
    return Math.min(planned, Math.max(0, (this.#baseTargetS - elapsed - blocksAfter) / catLeft)) + extra
  }

  /** Index of the first segment after `from` that still has an axis to measure (and was not done earlier in the sitting), or -1. */
  #nextLive(from: number): number {
    for (let i = from + 1; i < this.#segments.length; i++) {
      const s = this.#segments[i]!
      if (s.status !== 'done' && s.status !== 'absent' && !s.axes.every((k) => this.#skipped.has(k))) return i
    }
    return -1
  }

  /** The active time of a text part that is ending goes on the text parts' own account (see {@link #budgetFor}). */
  #leave(s: Segment): void {
    if (!s.running) return
    s.running = false
    if (s.optional !== undefined) this.#optionalSpentS += Math.max(0, this.#clock.elapsedS() - s.startedAtS)
  }

  /**
   * Moves to the next segment that still has an axis to measure and shows its interstitial; finishes
   * after the last. The clock is held from here until Start. The break is offered first, once, when
   * that segment is the half-way one or comes after it (a skipped half-way part moves the offer on).
   */
  #enterNextSegment(): void {
    const next = this.#nextLive(this.#segIdx)
    if (next >= 0) this.#clock.hold('between_parts')
    // A text part is asked for before anything is said about it (M3.11): the answer comes back here.
    const ahead = next >= 0 ? this.#segments[next]! : undefined
    if (ahead?.optional !== undefined && !ahead.probed) {
      this.#loading = { segment: ahead, axes: ahead.axes.filter((k) => !this.#skipped.has(k)), probe: true }
      this.#request()
      return
    }
    const breakIdx = this.#breakIdx()
    if (next >= 0 && !this.#breakOffered && breakIdx >= 0 && next >= breakIdx) {
      this.#breakOffered = true
      this.#afterBreak = () => this.#enterNextSegment()
      this.#phase = 'break_offer'
      this.#newScreen()
      this.#emit('phase')
      return
    }
    for (;;) {
      this.#segIdx++
      const s = this.#segments[this.#segIdx]
      if (s === undefined) {
        this.#segIdx = this.#segments.length - 1
        this.#finish('complete')
        return
      }
      // A part a continuation's sitting finished earlier stays done (RunConfig.continues); an absent text part is passed over.
      if (s.status === 'done' || s.status === 'absent') continue
      if (s.axes.every((k) => this.#skipped.has(k))) {
        s.status = 'skipped'
        continue
      }
      s.status = 'current'
      this.#blockIdx = 0
      this.#phase = 'interstitial'
      this.#newScreen()
      this.#emit('phase')
      return
    }
  }

  #endSegment(reason: NoItemReason | 'skipped' | 'complete'): void {
    const s = this.#segments[this.#segIdx]
    if (s === undefined) return
    if (s.kind === 'cat') this.#segmentEnds.push({ segment: s.id, reason: reason === 'complete' ? 'axes_done' : reason })
    s.status = s.axes.every((k) => this.#skipped.has(k)) ? 'skipped' : 'done'
    if (s.status === 'done') this.#doneHere.add(s.id)
    this.#leave(s)
    this.#current = null
    this.#currentBlock = null
    this.#passage = null
    this.#boundary(() => this.#enterNextSegment())
  }

  /** The person starts the segment shown on the interstitial. */
  startSegment(): void {
    if (this.#limitsHit() || this.#phase !== 'interstitial') return
    const s = this.#segments[this.#segIdx]
    if (s === undefined) return
    this.#clock.release('between_parts')
    s.startedAtS = this.#clock.elapsedS()
    s.running = true
    if (s.kind === 'cat') {
      s.budgetS = this.#budgetFor(this.#segIdx)
      this.#budgets.push({ segment: s.id, plannedS: s.plannedS, budgetS: s.budgetS })
    }
    this.#blockIdx = 0
    this.#present()
  }

  /** Shows the next unit of the current segment, or ends the segment. */
  #present(): void {
    const s = this.#segments[this.#segIdx]
    if (s === undefined) return
    if (s.kind === 'cat') {
      this.#presentItem(s)
      return
    }
    const blocks = s.steps.filter((st): st is Extract<PlannedStep, { kind: 'block' }> => st.kind === 'block')
    const step = blocks[this.#blockIdx]
    if (step === undefined || this.#skipped.has(step.axis)) {
      this.#endSegment('complete')
      return
    }
    this.#currentBlock = { step, startedMs: this.#cfg.now(), inputType: null, timestampSource: null, timestampReason: null }
    this.#phase = 'block'
    this.#newScreen()
    this.#emit('phase')
  }

  #presentItem(s: Segment): void {
    if (this.#cat !== undefined) {
      this.#presentServed(s)
      return
    }
    const axes = s.axes.filter((k) => !this.#skipped.has(k))
    if (axes.length === 0) {
      this.#endSegment('skipped')
      return
    }
    const elapsed = this.#clock.elapsedS()
    // Short of its minimum of answers (Quant), the part may go on past its time, as far as the hard stop.
    const toHardStop = Math.max(0, this.#hardStopS - elapsed)
    const left = s.budgetS - (elapsed - s.startedAtS)
    const sel = selectNext(
      {
        sessionSeed: this.#seed,
        posterior: sessionPosterior(this.#obs),
        administered: this.#administered,
        seenFamilies: this.#seenBase,
        remainingS: this.#belowMinimum(s, axes) ? Math.max(left, toHardStop) : left,
        floorRemainingS: toHardStop,
        priorCounts: this.#priorCounts,
      },
      selectionRng(this.#seed, this.#administered.length),
      { axes, weights: this.#weights as AxisWeights, stopSd: this.#stopSd },
    )
    if (sel.kind === 'none') {
      this.#endSegment(sel.reason)
      return
    }
    this.#current = { item: sel.item, served: null, startedMs: this.#cfg.now(), onsetMs: null, unavailable: false, pending: null }
    this.#phase = 'item'
    this.#newScreen()
    this.#emit('phase')
  }

  // ----------------------------------------------------------------- served parts (M2.7)

  #presentServed(s: Segment): void {
    const axes = s.axes.filter((k) => !this.#skipped.has(k))
    if (axes.length === 0) {
      this.#endSegment('skipped')
      return
    }
    // A passage that has been started is finished (M3.11 phase 2): while the server has more questions of it,
    // neither the part's time nor its count of passages ends the part.
    const midPassage = this.#passage !== null && this.#passage.segment === s && this.#passage.more
    // The part's time is a soft stop once the coverage floor is met (§7.4): the server holds the
    // precision rule and the floor of its own, this is only the clock. The hard stop is the clock's.
    // A part of passages also ends when it has read its number of them (`plan-table.ts` `sets`).
    const timeUp = this.#clock.elapsedS() - s.startedAtS >= s.budgetS
    const setsRead = s.optional?.sets !== undefined && s.setsShown.length >= s.optional.sets
    if (!midPassage && (timeUp || setsRead) && axes.every((k) => this.#itemsOn(k) >= COVERAGE_FLOOR) && !this.#belowMinimum(s, axes)) {
      this.#endSegment('time')
      return
    }
    // The first question of a text part was fetched before its "Up next" screen (M3.11): it is the one to show.
    const held = this.#held
    if (held !== null && held.segment === s) {
      this.#held = null
      this.#showServed(held.item)
      return
    }
    this.#loading = { segment: s, axes, probe: false }
    this.#request()
  }

  /**
   * A part with a minimum (a text part, M3.11; Quant, A15_MINIMUMS) is still short of its answers, and may
   * show more to get there: fewer than `min_items` answered in this session, and fewer than
   * `min_items + MIN_ITEMS_SLACK` shown. The same in both versions.
   */
  #belowMinimum(s: Segment, axes: readonly AxisCode[]): boolean {
    const min = s.optional?.min_items ?? s.minimum?.min_items
    if (min === undefined) return false
    const count = (list: readonly AxisCode[], k: AxisCode): number => list.reduce((n, a) => n + (a === k ? 1 : 0), 0)
    const shown = (k: AxisCode): number => count(this.#catAxes, k) + this.#administered.reduce((n, a) => n + (a.axis === k ? 1 : 0), 0)
    return axes.some((k) => count(this.#answeredAxes, k) < min && shown(k) < min + MIN_ITEMS_SLACK)
  }

  /** (Re)starts the wait for the next served item of the part that is loading. */
  #request(): void {
    const l = this.#loading
    if (l === null) return
    this.#problem = null
    this.#current = null
    // Waiting for the network is not working: the session clock stands still until the item is up.
    this.#clock.hold('loading')
    this.#phase = 'loading'
    this.#emit('phase')
    void this.#load(l, ++this.#fetchSeq)
  }

  async #load(l: Loading, seq: number): Promise<void> {
    const live = (): boolean => seq === this.#fetchSeq && this.#phase === 'loading'
    try {
      // A request a skip abandoned may still bring an item: it is let go before this part asks (module comment).
      if (this.#stray !== null) await this.#stray
      await this.#flushOutbox()
      for (let attempt = 0; attempt < MAX_FOREIGN_RELEASES; attempt++) {
        if (!live()) return
        const asked = this.#cat!.next(l.axes)
        this.#inFlight = { seq, asked }
        const r = await asked
        if (this.#inFlight?.seq === seq) this.#inFlight = null
        if (!live()) return
        if (l.probe) {
          this.#settle()
          l.segment.probed = true
          // No question for the part: it is dropped without a word, and the session is the one without it.
          if (r.kind === 'done') l.segment.status = 'absent'
          else this.#held = { segment: l.segment, item: r.item }
          this.#enterNextSegment()
          return
        }
        if (r.kind === 'done') {
          this.#settle()
          this.#endSegment(r.reason === 'axes_done' ? 'axes_done' : 'exhausted')
          return
        }
        // An item left pending by a part that was skipped while it was on its way: let it go, ask again.
        const axis = getFamily(r.item.family)?.axis
        if (axis !== undefined && !l.axes.includes(axis)) {
          this.#outbox.push({ item: r.item, response: null, rtMs: 0, confidence: null, flags: {}, release: 'skipped' })
          await this.#flushOutbox()
          continue
        }
        this.#settle()
        this.#showServed(r.item)
        return
      }
      throw new BackendError('rejected', 'pending_item_of_another_part')
    } catch (e) {
      if (!live()) return
      this.#problem = problemOf(e)
      this.#emit('phase')
    }
  }

  /** The wait is over (or abandoned): the wait's hold on the clock goes and no request is current. */
  #settle(): void {
    this.#loading = null
    this.#fetchSeq++
    this.#clock.release('loading')
  }

  #showServed(item: ServedItem): void {
    const cur: CurrentItem = { item: null, served: item, startedMs: this.#cfg.now(), onsetMs: null, unavailable: false, pending: null }
    this.#current = cur
    this.#notePassage(item)
    if (!item.supported) {
      // A renderer this build does not have: the item cannot be shown, so the skip of §13 is offered.
      cur.unavailable = true
      this.#raise({ kind: 'unsupported', axis: this.#servedAxis(item) })
    }
    this.#phase = 'item'
    this.#newScreen()
    this.#emit('phase')
  }

  /**
   * Keeps track of the passage a served question belongs to (module comment, "Served passages"): the same
   * passage as the last question's stays, a new one replaces it and is counted for its part, and a question
   * without a passage ends it.
   */
  #notePassage(item: ServedItem): void {
    const seg = this.#segments[this.#segIdx]
    if (seg === undefined || !item.supported || item.family !== TEXT_PASSAGE_RENDERER || !isPassageSpec(item.spec)) {
      this.#passage = null
      return
    }
    const text = passageTextOf(item.spec)
    const same = this.#passage !== null && this.#passage.segment === seg && this.#passage.text.passageKey === text.passageKey
    if (!seg.setsShown.includes(text.passageKey)) seg.setsShown.push(text.passageKey)
    const set = item.set
    // The object the screen was given for this passage is kept, so nothing about the passage changes between its questions.
    this.#passage = { text: same ? this.#passage!.text : text, segment: seg, position: set === undefined ? null : { index: set.index, of: set.of }, more: set !== undefined && set.index < set.of }
  }

  /** Sends the answers the server has not acknowledged yet, one at a time and in order (single flight). */
  #flushOutbox(): Promise<void> {
    this.#flushing ??= this.#drain().finally(() => {
      this.#flushing = null
    })
    return this.#flushing
  }

  async #drain(): Promise<void> {
    for (;;) {
      const next = this.#outbox[0]
      if (next === undefined) return
      await this.#cat!.answer(next)
      if (this.#outbox[0] === next) this.#outbox.shift()
    }
  }

  /**
   * Hands every answer that is still on its way to the server over, and resolves when it has them all
   * (the flow waits for it before closing the server session). Rejects with the server error.
   */
  flushAnswers(): Promise<void> {
    return this.#cat === undefined ? Promise.resolve() : this.#flushOutbox()
  }

  /** Answers waiting to be sent. */
  get unsentAnswers(): number {
    return this.#outbox.length
  }

  /** After a failed call (the phase is `loading` and `view().problem` says why): ask the server again. */
  retryLoad(): void {
    if (this.#phase !== 'loading' || this.#problem === null || this.#problem === 'ended' || this.#loading === null) return
    this.#request()
  }

  /** A served item that is on screen unanswered is let go when its part is skipped. */
  #releaseCurrent(): void {
    const cur = this.#current
    if (cur?.served == null || cur.pending !== null || this.#phase === 'confidence') return
    this.#outbox.push({ item: cur.served, response: null, rtMs: 0, confidence: null, flags: {}, release: cur.unavailable ? 'unavailable' : 'skipped' })
    void this.#flushOutbox().catch(() => undefined) // the next request sends it again, and says why if it cannot
  }

  /** Drops a request in flight (its answer, if it comes, is ignored). */
  #abandonLoading(): void {
    if (this.#loading !== null) this.#settle()
  }

  /**
   * A skip abandons the request of a text part (M3.11): if an item still comes back from it, it is let go, and the
   * next request waits for that. A served text item names no family, so the part that asks next could not tell it
   * from one of its own (the families of the M1 pool are told apart in {@link #load}).
   */
  #releaseInFlight(): void {
    const f = this.#inFlight
    if (f === null) return
    this.#inFlight = null
    const stray = f.asked
      .then((r) => {
        if (r.kind === 'item') this.#outbox.push({ item: r.item, response: null, rtMs: 0, confidence: null, flags: {}, release: 'skipped' })
      })
      .catch(() => undefined) // the request failed: nothing was served, or the next request meets the pending item itself
      .finally(() => {
        if (this.#stray === stray) this.#stray = null
      })
    this.#stray = stray
  }

  /** The question a text part was holding for its "Up next" screen is let go (the part was skipped there). */
  #releaseHeld(s: Segment): void {
    const held = this.#held
    if (held === null || held.segment !== s) return
    this.#held = null
    this.#outbox.push({ item: held.item, response: null, rtMs: 0, confidence: null, flags: {}, release: 'skipped' })
    void this.#flushOutbox().catch(() => undefined) // the next request sends it again, and says why if it cannot
  }

  // ------------------------------------------------------------------------------ items

  /** The renderer drew the item: `onsetMs` is the timestamp of the first frame showing it (§11.6). */
  itemShown(onsetMs: number): void {
    const cur = this.#current
    if (this.#limitsHit() || this.#phase !== 'item' || cur === null || cur.onsetMs !== null) return
    if (Number.isFinite(onsetMs)) cur.onsetMs = onsetMs
  }

  /** The renderer cannot draw the item (§13): the item is not counted, and the skip is offered. */
  itemUnavailable(): void {
    const cur = this.#current
    if (this.#limitsHit() || this.#phase !== 'item' || cur === null || cur.unavailable) return
    cur.unavailable = true
    this.#raise({ kind: 'unavailable', axis: this.#facts(cur).axis })
    this.#emit('phase')
  }

  /**
   * The person answered the item: it is scored, and the confidence slider comes next. Ignored when
   * no item is waiting for an answer, or when the response is not one the family accepts (the
   * renderers only send valid ones; a notice says so).
   */
  itemResponded(response: unknown): void {
    const cur = this.#current
    if (this.#limitsHit() || this.#phase !== 'item' || cur === null || cur.unavailable) return
    const endMs = this.#cfg.now()
    if (cur.served !== null) {
      // The server holds the key: nothing here can say whether the answer was right (R-11.1).
      if (!servedResponseFits(cur.served, response)) {
        this.#raise({ kind: 'malformed' })
        this.#emit('phase')
        return
      }
      cur.pending = { response: response as JsonValue, correct: null, endMs, rtMs: endMs - (cur.onsetMs ?? cur.startedMs) }
      this.#notice = null
      this.#phase = 'confidence'
      this.#emit('phase')
      return
    }
    let correct: 0 | 1 | null
    try {
      correct = (familyOf(cur.item!.family).score(cur.item as never, response as never) as { correct: 0 | 1 | null }).correct
    } catch (e) {
      if (!(e instanceof MalformedResponseError)) throw e
      this.#raise({ kind: 'malformed' })
      this.#emit('phase')
      return
    }
    if (correct === null) return
    cur.pending = { response: response as JsonValue, correct, endMs, rtMs: endMs - (cur.onsetMs ?? cur.startedMs) }
    this.#notice = null
    this.#phase = 'confidence'
    this.#emit('phase')
  }

  /**
   * The person confirmed how sure they are (percent, an integer from the slider's floor to 100).
   * `touched` false: the slider was confirmed where it started, never moved (Continue, Enter or a
   * double click straight away). Such an answer is recorded as not rated (`confidence_pct` null, as
   * after a skip or the hard stop), so it stays out of the calibration, and the session counts it in
   * the flag `confidence_untouched_n` (UX-063).
   */
  confirmConfidence(pct: number, touched = true): void {
    const cur = this.#current
    if (this.#limitsHit() || this.#phase !== 'confidence' || cur === null || cur.pending === null) return
    if (!isConfidencePct(pct, confidenceFloorPct(this.#facts(cur).options_count))) return
    const rated = touched ? pct : null
    if (!touched) this.#untouched++
    if (cur.served !== null) this.#recordServed(cur, cur.pending.response, cur.pending.rtMs, rated, cur.pending.endMs)
    else this.#recordItem(cur, cur.pending.response, cur.pending.correct as 0 | 1, cur.pending.rtMs, rated, cur.pending.endMs)
    this.#current = null
    this.#emit('response')
    this.#boundary(() => this.#present())
  }

  #timeoutItem(cur: CurrentItem): void {
    const limitMs = (this.#facts(cur).time_limit_s ?? DEFAULT_ITEM_LIMIT_S) * 1000
    const start = cur.onsetMs ?? cur.startedMs
    if (cur.served !== null) this.#recordServed(cur, null, limitMs, null, start + limitMs)
    else this.#recordItem(cur, null, 0, limitMs, null, start + limitMs)
    this.#current = null
    this.#raise({ kind: 'timeout', ...(cur.served === null ? {} : { served: true }) })
    this.#emit('response')
    this.#boundary(() => this.#present())
  }

  /** Puts one counted CAT answer (or time-out) into the logs. */
  #recordItem(cur: CurrentItem, response: JsonValue, correct: 0 | 1, rtMs: number, confidencePct: number | null, endMs: number): void {
    const item = cur.item!
    this.#responses.push([item.item_id, 0, response, correct, round1(rtMs), confidencePct])
    const o = itemObservation(item, correct)
    if (o !== null) this.#obs.push(o)
    this.#administered.push(item)
    if (response !== null) this.#answeredAxes.push(item.axis)
    this.#seenItems.push(item.item_id)
    this.#seenFamilies.push(item.family_id)
    if (confidencePct !== null) this.#rated.push({ pct: confidencePct, correct })
    const onset = cur.onsetMs ?? cur.startedMs
    this.#integrity.push({
      item_id: item.item_id,
      axis: item.axis,
      params: item.params,
      expected_time_s: item.expected_time_s,
      correct,
      rt_ms: Math.max(0, rtMs),
      onset_ms: onset,
      end_ms: Math.max(onset, endMs),
    })
  }

  /**
   * Puts one served answer (or time-out) into the log of the server's session and the outbox. The
   * tuple's `correct` is null: the verdict is the server's and never comes back (R-11.1); the signed
   * session that `finish` returns replaces this copy.
   */
  #recordServed(cur: CurrentItem, response: JsonValue | null, rtMs: number, confidencePct: number | null, endMs: number, release?: Release): void {
    const s = cur.served!
    const onset = cur.onsetMs ?? cur.startedMs
    const end = Math.max(onset, endMs)
    this.#catResponses.push([s.item_id, 0, response, null, round1(rtMs), confidencePct])
    this.#catSeen.push(s.item_id)
    this.#catAxes.push(this.#servedAxis(s))
    if (response !== null) this.#answeredAxes.push(this.#servedAxis(s))
    this.#catWindows.push({ onset, end })
    this.#outbox.push({ item: s, response, rtMs: Math.max(0, rtMs), confidence: confidencePct, flags: this.#servedFlags(s.item_id, onset, end), release })
    void this.#flushOutbox().catch(() => undefined) // the next request sends it again, and says why if it cannot
  }

  /** `paste` and `visibility_hidden` of one served answer (§13), the way `engine/integrity.ts` reads them. */
  #servedFlags(itemId: string, onset: number, end: number): Record<string, number | boolean | null> {
    const flags: Record<string, number | boolean | null> = {}
    if (this.#hiddenMs(onset, end) / 1000 > HIDDEN_MAX_S) flags.visibility_hidden = true
    if (this.#paste.some((e) => (e.item_id !== undefined ? e.item_id === itemId : e.t_ms >= onset && e.t_ms <= end))) flags.paste = true
    return flags
  }

  /** Milliseconds the page was hidden inside [onset, end]. */
  #hiddenMs(onset: number, end: number): number {
    let hidden = 0
    for (const [a, b] of hiddenIntervals(this.#visibility)) hidden += Math.max(0, Math.min(b, end) - Math.max(a, onset))
    return hidden
  }

  // ------------------------------------------------------------------------------ blocks

  /** The RT renderer reported where its response timestamps came from (§11.6: event timestamp or handler clock). */
  blockTimestampSource(source: 'event' | 'handler' | 'mixed', reason?: string): void {
    const blk = this.#currentBlock
    if (this.#limitsHit() || this.#phase !== 'block' || blk === null) return
    blk.timestampSource = source
    blk.timestampReason = reason ?? null
  }

  /** The RT renderer reported the input type its responses came from (§11.6, §13: normed separately). */
  blockInputType(type: RtInputType): void {
    const blk = this.#currentBlock
    if (this.#limitsHit() || this.#phase !== 'block' || blk === null) return
    blk.inputType = type
  }

  /** The block ended with its whole response (the family's `score()` input). */
  blockResponded(response: unknown): void {
    const blk = this.#currentBlock
    if (this.#limitsHit() || this.#phase !== 'block' || blk === null) return
    const { step } = blk
    const item = step.item
    const durationMs = this.#cfg.now() - blk.startedMs
    let observation: Observation | undefined
    let flags: readonly string[] = []
    let reasons: readonly string[] = []
    const extra: Record<string, JsonValue> = {}
    try {
      if (step.family === 'rt_simple' || step.family === 'rt_choice4') {
        const inputType = blk.inputType ?? undefined
        const device = {
          device_class: this.#device.class,
          ...(inputType === undefined ? {} : { input_type: inputType }),
          ...(blk.timestampSource === null ? {} : { rt_timestamp_source: blk.timestampSource }),
          ...(blk.timestampReason === null ? {} : { rt_timestamp_reason: blk.timestampReason }),
          ...(this.#device.refresh_hz_est === null ? {} : { refresh_hz_est: this.#device.refresh_hz_est }),
        }
        const r = rtBlockObservation(item as RtItem, response as RtResponse, device)
        if (r.status === 'ok') observation = r.observation
        else reasons = [r.reason]
        // What the save keeps is the scorer's own record of the block: the device class, the input
        // type and the refresh rate it was given (A18, §13: normed separately), the norms version
        // and the trial counts. So the RtDevice passed above is what is stored.
        for (const [k, v] of Object.entries(r.meta)) if (v !== undefined) extra[k] = v as JsonValue
        if (inputType !== undefined) this.#device = { ...this.#device, input: inputType }
      } else {
        const s = (familyOf(step.family).score(item as never, response as never) as { observation?: Observation; flags: readonly string[]; reasons: readonly string[] })
        observation = s.observation
        flags = s.flags
        reasons = s.reasons
      }
    } catch (e) {
      if (!(e instanceof MalformedResponseError)) throw e
      reasons = ['malformed_response']
    }
    if (flags.length > 0) extra.flags = [...flags]
    // A response that is not plain JSON cannot be saved; the block is recorded without it (the renderers send valid ones).
    if (!isJsonValue(response)) reasons = reasons.includes('malformed_response') ? reasons : [...reasons, 'malformed_response']
    if (reasons.length > 0) extra.reasons = [...reasons]
    const tuple: ResponseTuple = [item.item_id, 0, isJsonValue(response) ? response : null, null, round1(durationMs), null]
    if (Object.keys(extra).length > 0) tuple.push(extra)
    this.#responses.push(tuple)
    if (observation !== undefined) this.#obs.push(observation)
    this.#seenItems.push(item.item_id)
    this.#seenFamilies.push(item.family_id)
    this.#blockRecords.push({ item_id: item.item_id, family: step.family, axis: step.axis, observed: observation !== undefined, flags, reasons })
    this.#currentBlock = null
    this.#blockIdx++
    this.#emit('response')
    this.#boundary(() => this.#present())
  }

  // ------------------------------------------------------------------------- skip / finish

  #markSkipped(axis: AxisCode): void {
    this.#skipped.add(axis)
    this.#weights[axis] = 0
  }

  /**
   * Skip an axis (§13 "skip any axis"): w_k = 0, what is on screen for it goes, and its later
   * segments are passed over. What was already answered stays in the save. `axis` defaults to the
   * current unit's ({@link RunView.skippable}).
   */
  skipAxis(axis?: AxisCode): void {
    if (this.#limitsHit() || this.#phase === 'on_break') return
    const target = axis ?? this.view().skippable
    if (target === null || !isAxisCode(target) || this.#skipped.has(target)) return
    this.#markSkipped(target)
    this.#raise({ kind: 'skipped', axis: target })
    // A text part skipped while its first question was being asked for (the wait had failed): on to the next part.
    const probe = this.#phase === 'loading' && this.#loading?.probe === true ? this.#loading : null
    if (probe !== null) {
      if (!probe.axes.includes(target)) {
        this.#emit('skip')
        return
      }
      this.#releaseInFlight()
      this.#abandonLoading()
      probe.segment.probed = true
      probe.segment.status = 'skipped'
      this.#segmentEnds.push({ segment: probe.segment.id, reason: 'skipped' })
      this.#emit('skip')
      this.#boundary(() => this.#enterNextSegment())
      return
    }
    const seg = this.#segments[this.#segIdx]
    const onScreen = this.#phase === 'interstitial' || this.#phase === 'block' || this.#phase === 'item' || this.#phase === 'confidence' || this.#phase === 'loading'
    const inSegment = seg !== undefined && onScreen && seg.axes.includes(target)
    if (inSegment) {
      // Whatever was on screen for the axis is dropped; an answer waiting for its confidence is kept.
      this.#flushPending()
      this.#releaseCurrent()
      this.#releaseHeld(seg)
      if (seg.optional !== undefined) this.#releaseInFlight()
      this.#abandonLoading()
      this.#current = null
      this.#currentBlock = null
      this.#passage = null
    }
    this.#emit('skip')
    if (!inSegment) return
    if (seg.axes.every((k) => this.#skipped.has(k))) {
      seg.status = 'skipped'
      this.#leave(seg)
      if (seg.kind === 'cat') this.#segmentEnds.push({ segment: seg.id, reason: 'skipped' })
      this.#boundary(() => this.#enterNextSegment())
    } else {
      this.#boundary(() => this.#present())
    }
  }

  /** The person ends the session now ("finish early", §7.4): the results are what there is. */
  finishEarly(): void {
    if (this.#phase === 'finished') return
    this.#finish('finish_early')
  }

  /** The answered item waiting for its confidence is kept, unrated; anything else in progress is dropped. */
  #flushPending(): void {
    const cur = this.#current
    if (this.#phase !== 'confidence' || !cur?.pending) return
    if (cur.served !== null) this.#recordServed(cur, cur.pending.response, cur.pending.rtMs, null, cur.pending.endMs)
    else this.#recordItem(cur, cur.pending.response, cur.pending.correct as 0 | 1, cur.pending.rtMs, null, cur.pending.endMs)
  }

  #finish(reason: EndReason): void {
    if (this.#phase === 'finished') return
    this.#abandonLoading()
    this.#flushPending()
    this.#current = null
    this.#currentBlock = null
    this.#passage = null
    this.#afterBreak = null
    // At the hard stop the recorded time is the limit itself: a tab that was suspended past it (or a
    // timer that fired late) does not put minutes on the clock that nobody worked.
    this.#clock.stop(reason === 'hard_stop' ? this.#hardStopS : undefined)
    this.#endReason = reason
    this.#phase = 'finished'
    for (const s of this.#segments) if (s.status === 'upcoming' || s.status === 'current') s.status = 'not_reached'
    this.#emit('finish')
  }

  // ---------------------------------------------------------------------------- breaks

  /** Take the suggested break: the clock is held until {@link resume} (and, after it, until Start on the next part). */
  takeBreak(): void {
    if (this.#limitsHit() || this.#phase !== 'break_offer') return
    this.#clock.hold('break')
    this.#breaks++
    this.#phase = 'on_break'
    this.#newScreen()
    this.#emit('break')
  }

  /** End the break; the session goes on where it was. */
  resume(): void {
    if (this.#phase !== 'on_break') return
    this.#clock.release('break')
    const next = this.#afterBreak
    this.#afterBreak = null
    this.#emit('break')
    if (next !== null) this.#boundary(next)
  }

  /** Decline the suggested break. */
  declineBreak(): void {
    if (this.#limitsHit() || this.#phase !== 'break_offer') return
    const next = this.#afterBreak
    this.#afterBreak = null
    if (next !== null) this.#boundary(next)
  }

  // ------------------------------------------------------------------------------ clock

  /** Call a few times a second: hard stop and the item cap follow the clock, not the calls. */
  tick(): void {
    if (this.#limitsHit()) return
    const cur = this.#current
    if (this.#phase === 'item' && cur !== null && !cur.unavailable) {
      const limitMs = (this.#facts(cur).time_limit_s ?? DEFAULT_ITEM_LIMIT_S) * 1000
      if (this.#cfg.now() - (cur.onsetMs ?? cur.startedMs) >= limitMs) this.#timeoutItem(cur)
    }
  }

  // --------------------------------------------------------------------- integrity logs

  /** A `visibilitychange` (§13 tab switching): `state` is `document.visibilityState` after it. */
  noteVisibility(state: VisibilityState): void {
    if (this.#phase === 'finished') return
    this.#visibility.push({ t_ms: this.#cfg.now(), state })
  }

  /** A paste into an entry field (§13). */
  notePaste(itemId?: string): void {
    if (this.#phase === 'finished') return
    this.#paste.push(itemId === undefined ? { t_ms: this.#cfg.now() } : { t_ms: this.#cfg.now(), item_id: itemId })
  }

  // ---------------------------------------------------------------------------- outputs

  #integrityReport(): IntegrityReport {
    const key = `${this.#integrity.length}/${this.#visibility.length}/${this.#paste.length}`
    if (this.#report?.key === key) return this.#report.value
    const value = integrityReport({ responses: this.#integrity, visibility: this.#visibility, paste: this.#paste })
    this.#report = { key, value }
    return value
  }

  #flags(): SessionFlags {
    // A served session has no item parameters here to run the six checks with (the server runs them
    // on its own rows): the two it cannot see for itself are reported as counters, as §8 lists them.
    const flags: SessionFlags = this.#cat === undefined ? { ...this.#integrityReport().save_flags } : this.#servedIntegrityFlags()
    for (const k of this.#skipped) flags[`skipped_${k.toLowerCase()}`] = true
    if (this.#breaks > 0) flags.breaks = this.#breaks
    if (this.#untouched > 0) flags.confidence_untouched_n = this.#untouched
    if (this.#endReason === 'finish_early') flags.finished_early = true
    if (this.#endReason === 'hard_stop') flags.hard_stop = true
    // How far the session got, for picking up an interrupted one (`resume.ts`): the parts that ended normally, and
    // `completed` for the third way to end. A session with none of the three ends was interrupted.
    for (const s of this.#segments) if (this.#doneHere.has(s.id)) flags[doneFlag(s.id)] = true
    if (this.#endReason === 'complete') flags[COMPLETED_FLAG] = true
    if (this.#cfg.focus !== undefined) flags[FOCUS_SESSION_FLAG] = true
    if (this.#cfg.continues !== undefined) flags[CONTINUATION_FLAG] = true
    return flags
  }

  #servedIntegrityFlags(): SessionFlags {
    let hidden = 0
    for (const w of this.#catWindows) hidden += this.#hiddenMs(w.onset, w.end)
    return { visibility_hidden_s: Math.round(hidden / 100) / 10, paste_events: this.#paste.length }
  }

  /**
   * The flags the server takes at `finish` (names and values as `hb.valid_flags` allows): the integrity
   * counters and what the person chose (skipped parts, breaks, how it ended). The flags of how far the session
   * got (`done_<part>`, `completed`, `focus_session`, `continuation`) are for this browser's crash recovery
   * (`resume.ts`) and stay in the save: the server keeps its own rows of what it served.
   */
  serverFlags(): SessionFlags {
    const out: SessionFlags = {}
    for (const [k, v] of Object.entries(this.#flags())) if (!isProgressFlag(k)) out[k] = v
    return out
  }

  /**
   * The served part of the session (M2.7) as an unsigned session with the server's id: what the person
   * answered, as far as it has been, for the autosave and for a save made when the server cannot be
   * reached. It holds no verdicts (`correct` is null). Null in the static version and before the first
   * served answer. The signed copy `finish` returns replaces it in the save.
   */
  catSessionState(): SessionState | null {
    if (this.#cat === undefined || this.#catResponses.length === 0) return null
    return {
      sessionId: this.#cat.sessionId,
      startedMs: this.#cfg.startedMs,
      durationS: this.#clock.elapsedS(),
      device: this.#device,
      flags: this.#flags(),
      responses: [...this.#catResponses],
      seenItems: [...this.#catSeen],
      seenFamilies: [],
    }
  }

  /** The session as the save library takes it (`saveWithSession`, autosave after each change). */
  sessionState(): SessionState {
    return {
      sessionId: this.sessionId,
      startedMs: this.#cfg.startedMs,
      durationS: this.#clock.elapsedS(),
      device: this.#device,
      // With a server this session is the half of the sitting that stays on the device (see `catSessionState`).
      flags: this.#cat === undefined ? this.#flags() : { ...this.#flags(), [TIMED_TASKS_ONLY_FLAG]: true },
      responses: [...this.#responses],
      seenItems: [...this.#seenItems],
      seenFamilies: [...this.#seenFamilies],
    }
  }

  /** The scored session so far (final once finished). */
  result(): RunResult {
    const cal = calibrationObservation(this.#rated)
    const observations = cal === null ? [...this.#obs] : [...this.#obs, cal]
    const itemsByAxis: Partial<Record<AxisCode, number>> = {}
    for (const a of this.#administered) itemsByAxis[a.axis] = (itemsByAxis[a.axis] ?? 0) + 1
    for (const a of this.#catAxes) itemsByAxis[a] = (itemsByAxis[a] ?? 0) + 1
    return {
      reason: this.#endReason,
      durationS: this.#clock.elapsedS(),
      observations,
      score: observations.length === 0 ? null : scoreAll(observations),
      skipped: [...this.#skipped],
      calibration: calibrationSummary(this.#rated),
      integrity: this.#integrityReport(),
      itemsByAxis,
      blocks: [...this.#blockRecords],
      segmentEnds: [...this.#segmentEnds],
      budgets: [...this.#budgets],
    }
  }
}
