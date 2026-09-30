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
 * - **Segment budgets.** A CAT segment starts with `(target − elapsed − time of the blocks still
 *   to run) / CAT segments left`, so slow or fast blocks and unused time move to the segments
 *   after them (never below 0).
 * - **Coverage floor** (§7.4 L584, the M1.15 fix). The ≥ 3-item floor of session 1 is a
 *   requirement, not part of a segment's budget: the selector is given the time to the hard stop
 *   as `floorRemainingS`, so a segment whose budget ran out (long span blocks, slow items before
 *   it) still gets its 3 items, and no more than that once the budget is gone. Before this, QR
 *   fell below 3 items in about 5% of simulated sessions.
 * - **Break** (§10): once the session has run 30 active minutes a break is offered at the next
 *   boundary (never mid-item); taking it pauses the clock. Offered once.
 * - **Hard stop** (§7.4): at 57 active minutes the session ends where it is; an item in progress is
 *   dropped, an answered item still waiting for its confidence is kept without one.
 * - **Item cap** (§13): a power item that gets no answer within `time_limit_s` is recorded as not
 *   correct (a time-out).
 *
 * ## Skipping and finishing
 *
 * Any axis can be skipped at any time (§13 "skip any axis"): w_k = 0, the rest of its segment goes,
 * and its later segments are passed over; what was already answered stays in the save, and the
 * profile shows the axis as not measured (`flags.skipped_<axis>`). "Finish early" ends the session
 * with what there is (§7.4).
 *
 * ## What is recorded
 *
 * §8 response tuples (`[item_id, 0, response, correct, rt_ms, confidence_pct, extra?]`) that
 * `save/rescore.ts` re-scores to the same observations (a block's tuple holds the family's block
 * response, RT's `extra` the input type, A18); the session's integrity logs (`visibilitychange`,
 * paste; M1.19) become `flags` when the state is read. Everything the UI is given about an item is
 * a {@link PublicItem}: its spec and ids, never the key, the parameters or the difficulty.
 */

import { isAxisCode, type AxisCode, type Cluster } from '../engine/axes'
import {
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
import type { RtInputMode, RtInputType } from '../render/rt/keys'
import type { SessionState } from '../save/create'
import type { DeviceInfo, SessionFlags } from '../save/types'
import { MalformedResponseError, type AnyFamily } from '../tasks/family'
import { getFamily } from '../tasks/registry'
import { rtBlockObservation, type RtItem, type RtResponse } from '../tasks/rt'
import {
  calibrationObservation,
  calibrationSummary,
  confidenceFloorPct,
  confidenceStartPct,
  isConfidencePct,
  type CalibrationSummary,
  type RatedAnswer,
} from './calibration'
import { BREAK_AT_S, DEFAULT_ITEM_LIMIT_S, HARD_STOP_S } from './constants'
import { SEGMENT_INFO } from './segments'
import { SessionClock, type NowMs } from './clock'

// ------------------------------------------------------------------------------- types

export type RunPhase =
  /** "Up next: …" for the current segment. */
  | 'interstitial'
  /** A fixed block is running in its renderer. */
  | 'block'
  /** A CAT item is on screen, waiting for an answer. */
  | 'item'
  /** The item was answered; the confidence slider is showing. */
  | 'confidence'
  /** The 30-minute break is suggested. */
  | 'break_offer'
  /** On a break: the clock is paused. */
  | 'on_break'
  | 'finished'

export type EndReason = 'complete' | 'finish_early' | 'hard_stop'

export type SegmentStatus = 'upcoming' | 'current' | 'done' | 'skipped' | 'not_reached'

export type NoticeKind = 'timeout' | 'skipped' | 'unavailable' | 'malformed'

/** A short message about what just happened; `seq` changes with every notice so a screen reader announces it again. */
export interface Notice {
  readonly kind: NoticeKind
  readonly seq: number
  readonly axis?: AxisCode
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
  readonly breakAtS: number
  readonly hardStopS: number
  readonly counts: { readonly items: number; readonly blocks: number }
  readonly skipped: readonly AxisCode[]
  /** The axis "Skip this skill" would skip now (the current unit's), or null. */
  readonly skippable: AxisCode | null
  readonly rtInput: RtInputMode
  readonly device: DeviceInfo
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
  /** The person's session number (coverage floor in session 1 only; default 1). */
  readonly sessionNumber?: number
  /** family_ids seen in earlier sessions (§7.7), excluded from this one. */
  readonly seenFamilies?: readonly string[]
  /** Axes skipped from the start. */
  readonly skipped?: readonly AxisCode[]
  /** Session target seconds (default {@link A15_TARGET_S}). */
  readonly targetS?: number
  readonly breakAtS?: number
  readonly hardStopS?: number
  /** Per-axis stop SD (default 0.3, §7.4 L588). */
  readonly stopSd?: number
  /** Called after every change with its kind. */
  readonly onChange?: (kind: ChangeKind) => void
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
}

// ---------------------------------------------------------------------------- internals

interface Segment {
  readonly id: SegmentId
  readonly kind: 'block' | 'cat'
  readonly axes: readonly AxisCode[]
  readonly steps: readonly PlannedStep[]
  status: SegmentStatus
  /** CAT: seconds this segment may use (set when it starts). */
  budgetS: number
  startedAtS: number
}

interface CurrentItem {
  readonly item: AnyItem
  readonly startedMs: number
  onsetMs: number | null
  unavailable: boolean
  pending: { response: JsonValue; correct: 0 | 1; endMs: number; rtMs: number } | null
}

interface CurrentBlock {
  readonly step: Extract<PlannedStep, { kind: 'block' }>
  readonly startedMs: number
  inputType: RtInputType | null
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

/** Whole minutes for "About N min" (at least 1). */
function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/** A minimum on the interstitial's estimate of a first-session CAT segment: the 3-item floor takes about this long. */
const FLOOR_SEGMENT_MIN_S = 120

// -------------------------------------------------------------------------------- run

export class SessionRun {
  readonly sessionId: string
  readonly #cfg: RunConfig
  readonly #seed: string
  readonly #clock: SessionClock
  readonly #targetS: number
  readonly #breakAtS: number
  readonly #hardStopS: number
  readonly #stopSd: number
  readonly #sessionNumber: number
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
  #afterBreak: (() => void) | null = null
  #noticeSeq = 0
  #notice: Notice | null = null

  readonly #obs: Observation[] = []
  readonly #responses: ResponseTuple[] = []
  readonly #administered: AdministeredItem[] = []
  readonly #integrity: IntegrityResponse[] = []
  readonly #rated: RatedAnswer[] = []
  readonly #seenItems: string[] = []
  readonly #seenFamilies: string[] = []
  readonly #blockRecords: BlockRecord[] = []
  readonly #segmentEnds: { segment: SegmentId; reason: NoItemReason | 'skipped' }[] = []
  readonly #visibility: VisibilityEvent[] = []
  readonly #paste: PasteEvent[] = []
  #report: { key: string; value: IntegrityReport } | null = null
  /** True while the constructor runs: no change event fires before the caller holds the run. */
  #booting = true

  /** Starts the session: the plan is drawn, the clock starts and the first interstitial is up. */
  constructor(cfg: RunConfig) {
    this.#cfg = cfg
    this.sessionId = cfg.sessionId
    this.#seed = cfg.seed ?? cfg.sessionId
    this.#targetS = cfg.targetS ?? A15_TARGET_S
    this.#breakAtS = cfg.breakAtS ?? BREAK_AT_S
    this.#hardStopS = cfg.hardStopS ?? HARD_STOP_S
    this.#stopSd = cfg.stopSd ?? STOP_SD
    this.#sessionNumber = cfg.sessionNumber ?? 1
    this.#seenBase = cfg.seenFamilies ?? []
    this.#device = cfg.device
    this.#rtInput = cfg.rtInput
    for (const k of cfg.skipped ?? []) this.#markSkipped(k)
    const plan = planSession({ sessionSeed: this.#seed, weights: this.#weights as AxisWeights, targetS: this.#targetS, seenFamilies: this.#seenBase })
    this.#segments = SessionRun.#group(plan)
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
      out.push({ id: step.segment, kind: step.kind, axes, steps: [step], status: 'upcoming', budgetS: 0, startedAtS: 0 })
    }
    return out
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

  #segmentView(s: Segment): SegmentView {
    const info = SEGMENT_INFO[s.id]
    const idx = this.#segments.indexOf(s)
    let seconds: number
    if (s.kind === 'block') seconds = s.steps.reduce((t, st) => t + (st.kind === 'block' ? st.item.expected_time_s : 0), 0)
    else seconds = s.status === 'current' && s.budgetS > 0 ? s.budgetS : this.#budgetFor(idx)
    if (s.kind === 'cat' && this.#sessionNumber === 1) seconds = Math.max(seconds, FLOOR_SEGMENT_MIN_S)
    return { id: s.id, title: info.title, cluster: info.cluster, axes: s.axes, kind: s.kind, minutes: minutesOf(seconds), status: s.status }
  }

  view(): RunView {
    const seg = this.#segments[this.#segIdx]
    const cur = this.#current
    let confidence: RunView['confidence'] = null
    if (this.#phase === 'confidence' && cur !== null) {
      const k = cur.item.options_count
      const floorPct = confidenceFloorPct(k)
      confidence = { floorPct, startPct: confidenceStartPct(floorPct), optionsCount: k ?? null }
    }
    let skippable: AxisCode | null = null
    if (this.#phase === 'item' || this.#phase === 'confidence') skippable = cur?.item.axis ?? null
    else if (this.#phase === 'block') skippable = this.#currentBlock?.step.axis ?? null
    else if (this.#phase === 'interstitial' && seg !== undefined) skippable = seg.axes.find((k) => !this.#skipped.has(k)) ?? null
    return {
      phase: this.#phase,
      ended: this.#endReason,
      segments: this.#segments.map((s) => this.#segmentView(s)),
      segmentIndex: this.#segIdx,
      segment: seg === undefined ? null : this.#segmentView(seg),
      item:
        cur === null
          ? null
          : {
              item_id: cur.item.item_id,
              family: cur.item.family,
              axis: cur.item.axis,
              item_type: cur.item.item_type,
              spec: cur.item.spec,
              ...(cur.item.options_count === undefined ? {} : { options_count: cur.item.options_count }),
              time_limit_s: cur.item.time_limit_s ?? DEFAULT_ITEM_LIMIT_S,
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
      elapsedS: this.#clock.elapsedS(),
      targetS: this.#targetS,
      breakAtS: this.#breakAtS,
      hardStopS: this.#hardStopS,
      counts: { items: this.#administered.length, blocks: this.#blockRecords.length },
      skipped: [...this.#skipped],
      skippable,
      rtInput: this.#rtInput,
      device: this.#device,
    }
  }

  get phase(): RunPhase {
    return this.#phase
  }

  /** Active seconds so far (cheap; the ring reads it every tick). */
  elapsedS(): number {
    return this.#clock.elapsedS()
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

  /**
   * A boundary between units: a break is offered here once the session has run `breakAtS`
   * (§10), else `next` runs.
   */
  #boundary(next: () => void): void {
    if (this.#limitsHit()) return
    if (!this.#breakOffered && this.#clock.elapsedS() >= this.#breakAtS) {
      this.#breakOffered = true
      this.#afterBreak = next
      this.#phase = 'break_offer'
      this.#emit('phase')
      return
    }
    next()
  }

  // ------------------------------------------------------------------------- segments

  /** Budget in seconds for the CAT segment at `idx` if it started now (see the module comment). */
  #budgetFor(idx: number): number {
    const elapsed = this.#clock.elapsedS()
    let blocksAfter = 0
    let catLeft = 0
    for (let i = idx; i < this.#segments.length; i++) {
      const s = this.#segments[i]!
      if (s.status === 'done' || s.status === 'skipped' || s.axes.every((k) => this.#skipped.has(k))) continue
      if (s.kind === 'cat') catLeft++
      else if (i > idx) blocksAfter += s.steps.reduce((t, st) => t + (st.kind === 'block' ? st.item.expected_time_s : 0), 0)
    }
    return catLeft === 0 ? 0 : Math.max(0, (this.#targetS - elapsed - blocksAfter) / catLeft)
  }

  /** Moves to the next segment that still has an axis to measure and shows its interstitial; finishes after the last. */
  #enterNextSegment(): void {
    for (;;) {
      this.#segIdx++
      const s = this.#segments[this.#segIdx]
      if (s === undefined) {
        this.#segIdx = this.#segments.length - 1
        this.#finish('complete')
        return
      }
      if (s.axes.every((k) => this.#skipped.has(k))) {
        s.status = 'skipped'
        continue
      }
      s.status = 'current'
      this.#blockIdx = 0
      this.#phase = 'interstitial'
      this.#emit('phase')
      return
    }
  }

  #endSegment(reason: NoItemReason | 'skipped' | 'complete'): void {
    const s = this.#segments[this.#segIdx]
    if (s === undefined) return
    if (s.kind === 'cat') this.#segmentEnds.push({ segment: s.id, reason: reason === 'complete' ? 'axes_done' : reason })
    s.status = s.axes.every((k) => this.#skipped.has(k)) ? 'skipped' : 'done'
    this.#current = null
    this.#currentBlock = null
    this.#boundary(() => this.#enterNextSegment())
  }

  /** The person starts the segment shown on the interstitial. */
  startSegment(): void {
    if (this.#limitsHit() || this.#phase !== 'interstitial') return
    const s = this.#segments[this.#segIdx]
    if (s === undefined) return
    s.startedAtS = this.#clock.elapsedS()
    if (s.kind === 'cat') s.budgetS = this.#budgetFor(this.#segIdx)
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
    this.#currentBlock = { step, startedMs: this.#cfg.now(), inputType: null }
    this.#phase = 'block'
    this.#emit('phase')
  }

  #presentItem(s: Segment): void {
    const axes = s.axes.filter((k) => !this.#skipped.has(k))
    if (axes.length === 0) {
      this.#endSegment('skipped')
      return
    }
    const elapsed = this.#clock.elapsedS()
    const sel = selectNext(
      {
        sessionSeed: this.#seed,
        posterior: sessionPosterior(this.#obs),
        administered: this.#administered,
        seenFamilies: this.#seenBase,
        remainingS: s.budgetS - (elapsed - s.startedAtS),
        floorRemainingS: Math.max(0, this.#hardStopS - elapsed),
        sessionNumber: this.#sessionNumber,
      },
      selectionRng(this.#seed, this.#administered.length),
      { axes, weights: this.#weights as AxisWeights, stopSd: this.#stopSd },
    )
    if (sel.kind === 'none') {
      this.#endSegment(sel.reason)
      return
    }
    this.#current = { item: sel.item, startedMs: this.#cfg.now(), onsetMs: null, unavailable: false, pending: null }
    this.#phase = 'item'
    this.#emit('phase')
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
    this.#notice = { kind: 'unavailable', seq: ++this.#noticeSeq, axis: cur.item.axis }
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
    let correct: 0 | 1 | null
    try {
      correct = (familyOf(cur.item.family).score(cur.item as never, response as never) as { correct: 0 | 1 | null }).correct
    } catch (e) {
      if (!(e instanceof MalformedResponseError)) throw e
      this.#notice = { kind: 'malformed', seq: ++this.#noticeSeq }
      this.#emit('phase')
      return
    }
    if (correct === null) return
    cur.pending = { response: response as JsonValue, correct, endMs, rtMs: endMs - (cur.onsetMs ?? cur.startedMs) }
    this.#notice = null
    this.#phase = 'confidence'
    this.#emit('phase')
  }

  /** The person confirmed how sure they are (percent, an integer from the slider's floor to 100). */
  confirmConfidence(pct: number): void {
    const cur = this.#current
    if (this.#limitsHit() || this.#phase !== 'confidence' || cur === null || cur.pending === null) return
    if (!isConfidencePct(pct, confidenceFloorPct(cur.item.options_count))) return
    this.#recordItem(cur, cur.pending.response, cur.pending.correct, cur.pending.rtMs, pct, cur.pending.endMs)
    this.#current = null
    this.#emit('response')
    this.#boundary(() => this.#present())
  }

  #timeoutItem(cur: CurrentItem): void {
    const limitMs = (cur.item.time_limit_s ?? DEFAULT_ITEM_LIMIT_S) * 1000
    const start = cur.onsetMs ?? cur.startedMs
    this.#recordItem(cur, null, 0, limitMs, null, start + limitMs)
    this.#current = null
    this.#notice = { kind: 'timeout', seq: ++this.#noticeSeq }
    this.#emit('response')
    this.#boundary(() => this.#present())
  }

  /** Puts one counted CAT answer (or time-out) into the logs. */
  #recordItem(cur: CurrentItem, response: JsonValue, correct: 0 | 1, rtMs: number, confidencePct: number | null, endMs: number): void {
    const { item } = cur
    this.#responses.push([item.item_id, 0, response, correct, round1(rtMs), confidencePct])
    const o = itemObservation(item, correct)
    if (o !== null) this.#obs.push(o)
    this.#administered.push(item)
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

  // ------------------------------------------------------------------------------ blocks

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
          ...(this.#device.refresh_hz_est === null ? {} : { refresh_hz_est: this.#device.refresh_hz_est }),
        }
        const r = rtBlockObservation(item as RtItem, response as RtResponse, device)
        if (r.status === 'ok') observation = r.observation
        else reasons = [r.reason]
        extra.device_class = this.#device.class
        if (inputType !== undefined) {
          extra.input_type = inputType
          this.#device = { ...this.#device, input: inputType }
        }
        if (this.#device.refresh_hz_est !== null) extra.refresh_hz_est = this.#device.refresh_hz_est
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
    this.#notice = { kind: 'skipped', seq: ++this.#noticeSeq, axis: target }
    const seg = this.#segments[this.#segIdx]
    const onScreen = this.#phase === 'interstitial' || this.#phase === 'block' || this.#phase === 'item' || this.#phase === 'confidence'
    const inSegment = seg !== undefined && onScreen && seg.axes.includes(target)
    if (inSegment) {
      // Whatever was on screen for the axis is dropped; an answer waiting for its confidence is kept.
      this.#flushPending()
      this.#current = null
      this.#currentBlock = null
    }
    this.#emit('skip')
    if (!inSegment) return
    if (seg.axes.every((k) => this.#skipped.has(k))) {
      seg.status = 'skipped'
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
    if (this.#phase === 'confidence' && cur?.pending) this.#recordItem(cur, cur.pending.response, cur.pending.correct, cur.pending.rtMs, null, cur.pending.endMs)
  }

  #finish(reason: EndReason): void {
    if (this.#phase === 'finished') return
    this.#flushPending()
    this.#current = null
    this.#currentBlock = null
    this.#afterBreak = null
    this.#clock.stop()
    this.#endReason = reason
    this.#phase = 'finished'
    for (const s of this.#segments) if (s.status === 'upcoming' || s.status === 'current') s.status = 'not_reached'
    this.#emit('finish')
  }

  // ---------------------------------------------------------------------------- breaks

  /** Take the suggested break: the clock pauses until {@link resume}. */
  takeBreak(): void {
    if (this.#limitsHit() || this.#phase !== 'break_offer') return
    this.#clock.pause()
    this.#breaks++
    this.#phase = 'on_break'
    this.#emit('break')
  }

  /** End the break; the session goes on where it was. */
  resume(): void {
    if (this.#phase !== 'on_break') return
    this.#clock.resume()
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
      const limitMs = (cur.item.time_limit_s ?? DEFAULT_ITEM_LIMIT_S) * 1000
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
    const flags: SessionFlags = { ...this.#integrityReport().save_flags }
    for (const k of this.#skipped) flags[`skipped_${k.toLowerCase()}`] = true
    if (this.#breaks > 0) flags.breaks = this.#breaks
    if (this.#endReason === 'finish_early') flags.finished_early = true
    if (this.#endReason === 'hard_stop') flags.hard_stop = true
    return flags
  }

  /** The session as the save library takes it (`saveWithSession`, autosave after each change). */
  sessionState(): SessionState {
    return {
      sessionId: this.sessionId,
      startedMs: this.#cfg.startedMs,
      durationS: this.#clock.elapsedS(),
      device: this.#device,
      flags: this.#flags(),
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
    }
  }
}
