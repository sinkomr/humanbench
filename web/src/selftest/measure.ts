/**
 * RT timing self-test: the measurement logic behind `rt-selftest.html` (ROADMAP M1.23; DESIGN
 * §11.6, §7.1 RT model, §3 row 9). Pure over an injectable {@link Clock} and {@link FrameSource}
 * (`tasks/rt/timing.ts`), so every number here is unit-tested with fake frames and a fake clock.
 * The page (`RtSelfTest.svelte`) only wires the browser in.
 *
 * What it measures, each reported as p50 / p95 / max in ms:
 * - **refresh rate** (§11.6 item 2): `estimateRefreshRate` over the captured rAF deltas;
 * - **rAF interval** (informational) and **rAF jitter** = |Δ_i − median Δ| over consecutive
 *   requestAnimationFrame timestamps;
 * - **timer resolution**: the positive increments between consecutive `performance.now()`
 *   readings in a tight loop (the clock's granularity; browsers coarsen it, e.g. to 1 ms or 0.1 ms);
 * - **onset scheduling error** (§11.6 item 1): each trial schedules a stimulus `delay` ms after a
 *   frame with the production scheduler (`createOnsetScheduler`), and the error is
 *   |actual onset frame − scheduled frame|, where the scheduled frame is the first display
 *   refresh at or after the target ({@link scheduledFrameTs}). A dropped frame shows up as about
 *   one frame period; the sub-frame wait from the target to the next refresh is frame
 *   quantisation, not error, and is reported separately as **onset lag** (informational);
 * - **keyboard / pointer event lag**: performance.now() in the handler − event.timeStamp, reported
 *   as p50 / p95 / max. RT responses are stamped with the event's own timestamp when it is on the
 *   performance.now() timeline (`responseTimestampFromEvent`, §11.6), so a small lag is dispatch
 *   delay that is not part of any RT and is informational. When the p50 lag exceeds
 *   {@link MAX_EVENT_LAG_MS} the event clock is offset from performance.now() (Safari measured a
 *   constant ~205 ms), RT falls back to the handler clock, the dispatch delay counts again, and
 *   the metric is gated like the others (p95 < 5 ms), which an offset that large fails.
 *
 * Verdict: a gated metric passes iff its p95 is below {@link SELFTEST_THRESHOLD_MS} (5 ms, the
 * ROADMAP M1.23 bar). p95, not max, because one GC pause or dropped frame in a few hundred samples
 * should not fail a device whose trials are otherwise precise; the max is reported beside it. The
 * run passes iff every gated metric passes; the gated ones (jitter, timer, onset) are the
 * automatic ones and are always measured. §11.6 item 4 already treats RT changes of ≤ 20 ms as noise,
 * so 5 ms is a strict bar for the display pipeline.
 *
 * Wall-clock time is never read (CLAUDE.md timing rule; `scripts/timing-lint.test.ts`).
 */

import {
  createOnsetScheduler,
  estimateRefreshRate,
  MIN_REFRESH_DELTAS,
  type Clock,
  type FrameCallback,
  MAX_EVENT_LAG_MS,
  type FrameSource,
  type RefreshEstimate,
} from '../tasks/rt/timing'

/** The M1.23 bar: a gated metric's p95 must be below this (ms). */
export const SELFTEST_THRESHOLD_MS = 5
/** The quantile the verdict uses (see the module comment). */
export const GATE_QUANTILE = 0.95
/** Version tag of the copyable JSON report. */
export const SELFTEST_REPORT_VERSION = 'rt_selftest_v3'

/** Sample sizes of a run. */
export interface SelfTestPlan {
  /** rAF deltas captured for the refresh rate and jitter (≥ {@link MIN_REFRESH_DELTAS}). */
  readonly frames: number
  /** Positive timer increments collected. */
  readonly timerIncrements: number
  /** Onset trials. */
  readonly onsets: number
  /** Key presses and pointer presses asked for. */
  readonly presses: number
}

/**
 * Default run: 240 frames (2 s at 120 Hz), 200 timer increments, 30 onsets, 12 presses of each
 * kind. The quick plan (`?quick=1`, used by the e2e smoke test) is marked in the report.
 */
export const DEFAULT_PLAN: SelfTestPlan = Object.freeze({ frames: 240, timerIncrements: 200, onsets: 30, presses: 12 })
export const QUICK_PLAN: SelfTestPlan = Object.freeze({ frames: 90, timerIncrements: 50, onsets: 8, presses: 3 })

/**
 * Frames dropped before capturing: after an idle period Chromium can hand the first callbacks a
 * stale timestamp (two frames with the same time), an artefact of waking the frame clock, not of
 * steady-state timing.
 */
export const WARMUP_FRAMES = 3

/** Onset delays start here (ms after the frame the trial starts in). */
export const ONSET_DELAY_MIN_MS = 350
/** …and spread over this span. At most one on/off flash per 350 ms keeps the page under 3 flashes/s (WCAG 2.3.1). */
export const ONSET_DELAY_SPAN_MS = 200

// ------------------------------------------------------------------------------- statistics

/** p50 / p95 / max of a sample (ms). */
export interface Summary {
  readonly n: number
  readonly p50: number
  readonly p95: number
  readonly max: number
}

/**
 * The q-quantile of an ascending, non-empty list: linear interpolation between order statistics
 * at h = (n − 1)·q (Hyndman–Fan type 7, numpy's default).
 */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length
  if (n === 0) throw new RangeError('quantileSorted(): empty list')
  if (!(q >= 0 && q <= 1)) throw new RangeError(`quantileSorted(): q must be in [0, 1], got ${q}`)
  const h = (n - 1) * q
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, n - 1)
  const a = sorted[lo] as number
  return a + (h - lo) * ((sorted[hi] as number) - a)
}

/** {@link Summary} of a non-empty list of finite numbers; throws a RangeError otherwise. */
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) throw new RangeError('summarize(): no samples')
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError(`summarize(): samples must be finite, got ${v}`)
  const s = [...values].sort((a, b) => a - b)
  return { n: s.length, p50: quantileSorted(s, 0.5), p95: quantileSorted(s, GATE_QUANTILE), max: s[s.length - 1] as number }
}

/** The verdict of a gated metric: p95 < threshold. */
export function passes(summary: Summary, thresholdMs: number = SELFTEST_THRESHOLD_MS): boolean {
  return summary.p95 < thresholdMs
}

const median = (xs: readonly number[]): number => quantileSorted([...xs].sort((a, b) => a - b), 0.5)

// ---------------------------------------------------------------------------- pure metrics

/**
 * Refresh rate, rAF intervals and jitter |Δ − median Δ| from consecutive frame timestamps. A
 * repeated timestamp (Δ = 0: two callbacks stamped with one frame time) is counted, kept in the
 * interval and jitter samples (as a full period of jitter), and left out of the refresh estimate,
 * which needs ≥ 60 positive deltas. Throws a RangeError on a timestamp that goes backwards.
 */
export function frameMetrics(timestamps: readonly number[]): { refresh: RefreshEstimate; interval: Summary; jitter: Summary; repeated: number } {
  const deltas: number[] = []
  for (let i = 1; i < timestamps.length; i++) {
    const d = (timestamps[i] as number) - (timestamps[i - 1] as number)
    if (!Number.isFinite(d)) throw new RangeError(`frameMetrics(): timestamp ${i} is not finite`)
    if (d < 0) throw new RangeError(`frameMetrics(): frame timestamps went backwards at index ${i}`)
    deltas.push(d)
  }
  const positive = deltas.filter((d) => d > 0)
  const refresh = estimateRefreshRate(positive)
  const med = median(positive)
  return { refresh, interval: summarize(deltas), jitter: summarize(deltas.map((d) => Math.abs(d - med))), repeated: deltas.length - positive.length }
}


/** The positive increments between consecutive clock readings (repeats are the clock not ticking). */
export function timerIncrements(readings: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1] as number
    const b = readings[i] as number
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new RangeError('timerIncrements(): readings must be finite')
    if (b < a) throw new RangeError(`timerIncrements(): the clock went backwards at reading ${i}`)
    if (b > a) out.push(b - a)
  }
  return out
}

/** One onset trial: the target time, the frame the stimulus appeared in, and the frame before the target. */
export interface OnsetTrial {
  /** rafNow + delay (`onsetTarget`). */
  readonly target: number
  /** Timestamp of the onset frame (the first frame ≥ target). */
  readonly onsetFrameTs: number
  /** Timestamp of the last frame before the target (< target). */
  readonly prevFrameTs: number
}

/**
 * The display refresh the stimulus should have appeared in: on the refresh grid prevFrameTs +
 * j·period, the first slot at or after the target, where j is capped at the number of refresh
 * periods n = max(1, round((onset − prev) / period)) that actually passed before the onset frame.
 * The cap keeps timestamp jitter from being read as a skipped slot: a frame 0.5 ms late whose
 * target fell inside those 0.5 ms is on time (j = 1), not a frame early. With frames dropped
 * after the target, the error is the dropped periods.
 */
export function scheduledFrameTs(trial: OnsetTrial, periodMs: number): number {
  const { target, onsetFrameTs, prevFrameTs } = trial
  if (!(Number.isFinite(periodMs) && periodMs > 0)) throw new RangeError(`scheduledFrameTs(): period must be finite and > 0, got ${periodMs}`)
  if (![target, onsetFrameTs, prevFrameTs].every(Number.isFinite)) throw new RangeError('scheduledFrameTs(): timestamps must be finite')
  if (!(prevFrameTs < target && target <= onsetFrameTs)) {
    throw new RangeError(`scheduledFrameTs(): need prev < target ≤ onset, got ${prevFrameTs}, ${target}, ${onsetFrameTs}`)
  }
  const n = Math.max(1, Math.round((onsetFrameTs - prevFrameTs) / periodMs))
  const j = Math.min(Math.max(1, Math.ceil((target - prevFrameTs) / periodMs)), n)
  return prevFrameTs + j * periodMs
}

/** Onset error |onset − scheduled frame| and lag onset − target (both ms) of each trial. */
export function onsetMetrics(trials: readonly OnsetTrial[], periodMs: number): { error: Summary; lag: Summary } {
  const err = trials.map((t) => Math.abs(t.onsetFrameTs - scheduledFrameTs(t, periodMs)))
  const lag = trials.map((t) => t.onsetFrameTs - t.target)
  return { error: summarize(err), lag: summarize(lag) }
}

/** One input event: its `timeStamp` and the performance.now() reading taken first thing in its handler. */
export interface InputSample {
  readonly eventTs: number
  readonly handlerTs: number
}

/**
 * True iff an event timestamp is on the performance.now() timeline. Very old engines used epoch
 * milliseconds (≈ 1.7e12); those cannot be compared with performance.now() at all.
 */
export function isHighResEventTs(eventTs: number, handlerTs: number): boolean {
  return Number.isFinite(eventTs) && eventTs >= 0 && eventTs <= handlerTs + 1000
}

/** Lag handler − event of each sample (ms, signed); null when any timestamp is not on the performance.now() timeline. */
export function inputLatency(samples: readonly InputSample[]): Summary | null {
  if (samples.length === 0) return null
  if (!samples.every((s) => Number.isFinite(s.handlerTs) && isHighResEventTs(s.eventTs, s.handlerTs))) return null
  return summarize(samples.map((s) => s.handlerTs - s.eventTs))
}

/** Which clock RT would use for these lags: the event's, or the handler's when the median lag exceeds {@link MAX_EVENT_LAG_MS}. */
export function rtSourceForLag(lag: Summary | null): 'event' | 'handler' {
  return lag === null || lag.p50 > MAX_EVENT_LAG_MS ? 'handler' : 'event'
}

/** The {@link InputSample} of an event handled now: read the clock before anything else in the handler. */
export function sampleEvent(event: { readonly timeStamp: number }, clock: Clock): InputSample {
  const handlerTs = clock.now()
  return { eventTs: event.timeStamp, handlerTs }
}

// -------------------------------------------------------------------------- measurement runs

/**
 * Capture `nDeltas + 1` consecutive frame timestamps after `warmup` frames (default
 * {@link WARMUP_FRAMES}); resolves after the last frame.
 */
export function collectFrames(frames: FrameSource, nDeltas: number, warmup: number = WARMUP_FRAMES): Promise<number[]> {
  if (!(Number.isInteger(nDeltas) && nDeltas >= 1)) return Promise.reject(new RangeError(`collectFrames(): nDeltas must be an integer ≥ 1, got ${nDeltas}`))
  if (!(Number.isInteger(warmup) && warmup >= 0)) return Promise.reject(new RangeError(`collectFrames(): warmup must be an integer ≥ 0, got ${warmup}`))
  return new Promise((resolve) => {
    const stamps: number[] = []
    let skip = warmup
    const tick: FrameCallback = (ts) => {
      if (skip > 0) skip--
      else stamps.push(ts)
      if (stamps.length <= nDeltas) frames.request(tick)
      else resolve(stamps)
    }
    frames.request(tick)
  })
}

/**
 * Read the clock in a tight loop until `wanted` positive increments are seen, the clock has
 * advanced `budgetMs`, or `maxReads` readings were taken, and return the increments. A clock that
 * never ticks returns [].
 */
export function sampleTimer(clock: Clock, wanted: number, { budgetMs = 500, maxReads = 5_000_000 }: { budgetMs?: number; maxReads?: number } = {}): number[] {
  if (!(Number.isInteger(wanted) && wanted >= 1)) throw new RangeError(`sampleTimer(): wanted must be an integer ≥ 1, got ${wanted}`)
  const out: number[] = []
  const start = clock.now()
  let prev = start
  for (let i = 0; i < maxReads && out.length < wanted; i++) {
    const t = clock.now()
    if (t < prev) throw new RangeError('sampleTimer(): the clock went backwards')
    if (t > prev) out.push(t - prev)
    prev = t
    if (t - start >= budgetMs) break
  }
  return out
}

/**
 * The onset delays of a run: ONSET_DELAY_MIN_MS + span·frac(i·φ) with φ the golden-ratio
 * conjugate, so targets land at evenly spread phases of the refresh cycle without a random source.
 */
export function onsetDelays(n: number): number[] {
  if (!(Number.isInteger(n) && n >= 1)) throw new RangeError(`onsetDelays(): n must be an integer ≥ 1, got ${n}`)
  const phi = (Math.sqrt(5) - 1) / 2
  return Array.from({ length: n }, (_, i) => ONSET_DELAY_MIN_MS + ONSET_DELAY_SPAN_MS * ((i * phi) % 1))
}

/** Hooks the page uses to draw the stimulus (called inside the onset frame) and report progress. */
export interface OnsetHooks {
  /** Runs synchronously in the onset frame's callback, as a real trial draws its stimulus. */
  onOnset?(trial: number, onsetFrameTs: number): void
  /** Runs in the first frame of each trial (e.g. to clear the previous stimulus). */
  onTrialStart?(trial: number): void
}

/**
 * Run one onset trial per delay, sequentially, through the production rAF-locked scheduler
 * (`createOnsetScheduler`, §11.6 item 1): each trial starts in a frame (rafNow), schedules its
 * stimulus `delay` ms later, and records the onset frame and the last frame before the target.
 */
export async function runOnsetTrials(frames: FrameSource, delays: readonly number[], hooks: OnsetHooks = {}): Promise<OnsetTrial[]> {
  for (const d of delays) if (!(Number.isFinite(d) && d > 0)) throw new RangeError(`runOnsetTrials(): delays must be finite and > 0, got ${d}`)
  let target = Infinity
  let prevFrameTs = -Infinity
  // Every frame the scheduler sees passes through here first, so the last one before the target is known.
  const recording: FrameSource = {
    request: (cb) =>
      frames.request((ts) => {
        if (ts < target) prevFrameTs = ts
        cb(ts)
      }),
    cancel: (h) => frames.cancel(h),
  }
  const scheduler = createOnsetScheduler(recording)
  const out: OnsetTrial[] = []
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i] as number
    out.push(
      await new Promise<OnsetTrial>((resolve) => {
        frames.request((rafNow) => {
          hooks.onTrialStart?.(i)
          prevFrameTs = rafNow
          const onset = scheduler.schedule(delay, rafNow, (ts) => {
            hooks.onOnset?.(i, ts)
            resolve({ target: onset.target, onsetFrameTs: ts, prevFrameTs })
          })
          target = onset.target // set before the scheduler's first frame runs
        })
      }),
    )
  }
  return out
}

// ----------------------------------------------------------------------------------- report

/** One reported metric: its summary, and the verdict (null = informational, not gated). */
export interface MetricReport {
  readonly summary: Summary | null
  readonly pass: boolean | null
  /** Why there is no summary (a skipped or unsupported measurement). */
  readonly note?: string
}

export type GatedMetric = 'raf_jitter_ms' | 'timer_resolution_ms' | 'onset_error_ms'
export type InfoMetric = 'raf_interval_ms' | 'onset_lag_ms' | 'key_latency_ms' | 'pointer_latency_ms'

/** The metrics the verdict must include (the automatic measurements). */
export const REQUIRED_METRICS: readonly GatedMetric[] = Object.freeze(['raf_jitter_ms', 'timer_resolution_ms', 'onset_error_ms'])
export const GATED_METRICS: readonly GatedMetric[] = REQUIRED_METRICS

/** The copyable JSON report (snake_case, like every JSON the app writes). */
export interface SelfTestReport {
  readonly report_version: typeof SELFTEST_REPORT_VERSION
  readonly threshold_ms: number
  readonly gate_quantile: number
  readonly quick: boolean
  readonly refresh: { readonly hz: number; readonly raw_hz: number; readonly snapped: boolean; readonly n_deltas: number; readonly repeated_timestamps: number }
  readonly metrics: Readonly<Record<GatedMetric | InfoMetric, MetricReport>>
  /** The event-lag bound, and the clock RT would use for each input type (null = not measured). */
  readonly event_lag: { readonly max_ms: number; readonly key_rt_source: 'event' | 'handler' | null; readonly pointer_rt_source: 'event' | 'handler' | null }
  /**
   * True iff every gated metric (jitter, timer, onset) passes and no measured input lag FAILs. Input
   * lag is informational while RT uses the event timestamp, and FAIL (p50 lag over the bound, RT on
   * the handler clock, p95 not under the threshold) otherwise.
   */
  readonly pass: boolean
  readonly context: {
    readonly cross_origin_isolated: boolean | null
    readonly hidden_during_run: boolean
    readonly device_pixel_ratio: number | null
  }
}

/** What a run measured, before the verdict. */
export interface SelfTestMeasurements {
  readonly quick: boolean
  readonly frameTimestamps: readonly number[]
  readonly timerIncrements: readonly number[]
  readonly onsets: readonly OnsetTrial[]
  /** null = skipped by the user. */
  readonly keys: readonly InputSample[] | null
  readonly pointers: readonly InputSample[] | null
  readonly context: SelfTestReport['context']
}

function gated(summary: Summary | null, note: string | undefined, thresholdMs: number): MetricReport {
  return summary === null ? { summary: null, pass: null, note: note ?? 'not measured' } : { summary, pass: passes(summary, thresholdMs) }
}

/** The note on the informational input-latency metrics (§11.6: RT uses the event timestamp). */
export const INPUT_LATENCY_NOTE = 'Informational: RT responses use the input event timestamp, so this dispatch delay is excluded from RT.'

/** The note when the event clock is offset from performance.now() and RT uses the handler clock. */
export const EVENT_OFFSET_NOTE = 'event timestamps are offset from performance.now() in this browser; RT falls back to the handler clock'

function inputReport(samples: readonly InputSample[] | null, thresholdMs: number): MetricReport {
  if (samples === null) return { summary: null, pass: null, note: 'skipped' }
  if (samples.length === 0) return { summary: null, pass: null, note: 'no events' }
  const s = inputLatency(samples)
  if (s === null) return { summary: null, pass: null, note: 'event.timeStamp is not on the performance.now() timeline; RT falls back to performance.now() in the handler' }
  // The handler clock is what RT would use: its dispatch delay counts, so gate it like the rest.
  if (rtSourceForLag(s) === 'handler') return { summary: s, pass: passes(s, thresholdMs), note: EVENT_OFFSET_NOTE }
  return { summary: s, pass: null, note: INPUT_LATENCY_NOTE }
}

/** The clock RT would use for a phase's events: null when skipped, empty, or not on the timeline (then the handler clock). */
function phaseSource(samples: readonly InputSample[] | null): 'event' | 'handler' | null {
  if (samples === null || samples.length === 0) return null
  return rtSourceForLag(inputLatency(samples))
}

/** Build the report from a run's measurements (pure). Throws a RangeError on too few frames or no onsets. */
export function buildReport(m: SelfTestMeasurements, thresholdMs: number = SELFTEST_THRESHOLD_MS): SelfTestReport {
  const fm = frameMetrics(m.frameTimestamps)
  const period = fm.refresh.median_delta_ms
  const om = onsetMetrics(m.onsets, period)
  const timer = m.timerIncrements.length > 0 ? summarize(m.timerIncrements) : null
  const metrics: Record<GatedMetric | InfoMetric, MetricReport> = {
    raf_interval_ms: { summary: fm.interval, pass: null },
    raf_jitter_ms: gated(fm.jitter, undefined, thresholdMs),
    timer_resolution_ms: gated(timer, 'the clock did not advance', thresholdMs),
    onset_error_ms: gated(om.error, undefined, thresholdMs),
    onset_lag_ms: { summary: om.lag, pass: null },
    key_latency_ms: inputReport(m.keys, thresholdMs),
    pointer_latency_ms: inputReport(m.pointers, thresholdMs),
  }
  const pass = REQUIRED_METRICS.every((k) => metrics[k].pass === true) && metrics.key_latency_ms.pass !== false && metrics.pointer_latency_ms.pass !== false
  return {
    report_version: SELFTEST_REPORT_VERSION,
    threshold_ms: thresholdMs,
    gate_quantile: GATE_QUANTILE,
    quick: m.quick,
    refresh: { hz: fm.refresh.hz, raw_hz: fm.refresh.raw_hz, snapped: fm.refresh.snapped, n_deltas: fm.refresh.n_deltas, repeated_timestamps: fm.repeated },
    metrics,
    event_lag: { max_ms: MAX_EVENT_LAG_MS, key_rt_source: phaseSource(m.keys), pointer_rt_source: phaseSource(m.pointers) },
    pass,
    context: m.context,
  }
}

/** The report as pretty JSON for the copy box. */
export function reportJson(report: SelfTestReport): string {
  return JSON.stringify(report, null, 2)
}
