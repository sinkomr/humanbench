<script lang="ts">
  /**
   * RT timing self-test page (ROADMAP M1.23; DESIGN §11.6). Served at `<base>rt-selftest.html` and
   * linked from nowhere prominent. The measurement logic lives in `measure.ts` (unit-tested); this
   * component only runs it against the real rAF, performance.now() and input events, and shows
   * p50 / p95 / max per metric with the < 5 ms verdict and a copyable JSON report. Nothing is saved
   * or sent.
   *
   * Start stays in the Tab order while a run is going (`aria-disabled`, not `disabled`), so pressing
   * it never drops focus to the body (WCAG 2.4.3); the page has a link back to the app.
   */
  import { onMount, tick } from 'svelte'
  import { DISCLAIMER } from '../copy'
  import { browserFrameSource, MAX_EVENT_LAG_MS, performanceClock } from '../tasks/rt/timing'
  import {
    DEFAULT_PLAN,
    GATE_QUANTILE,
    QUICK_PLAN,
    EVENT_OFFSET_NOTE,
    SELFTEST_THRESHOLD_MS,
    buildReport,
    collectFrames,
    onsetDelays,
    reportJson,
    runOnsetTrials,
    sampleEvent,
    sampleTimer,
    type GatedMetric,
    type InfoMetric,
    type InputSample,
    type MetricReport,
    type OnsetTrial,
    type SelfTestReport,
  } from './measure'

  interface Props {
    /** Smaller samples (`?quick=1`, the e2e smoke test); marked in the report. */
    quick?: boolean
  }

  let { quick = false }: Props = $props()
  const plan = $derived(quick ? QUICK_PLAN : DEFAULT_PLAN)

  /** The app's start page, under the base path (this page is `<base>rt-selftest.html`). */
  const HOME_HREF: string = import.meta.env.BASE_URL

  type Phase = 'intro' | 'frames' | 'timer' | 'onsets' | 'keys' | 'pointer' | 'done' | 'error'

  const METRIC_ROWS: readonly { key: GatedMetric | InfoMetric; label: string }[] = [
    { key: 'raf_interval_ms', label: 'Frame interval' },
    { key: 'raf_jitter_ms', label: 'Frame interval jitter' },
    { key: 'timer_resolution_ms', label: 'Timer resolution' },
    { key: 'onset_error_ms', label: 'Stimulus onset error' },
    { key: 'onset_lag_ms', label: 'Wait from onset target to next frame' },
    { key: 'key_latency_ms', label: 'Key press handling delay (checked only if press time stamps are offset)' },
    { key: 'pointer_latency_ms', label: 'Pointer press handling delay (checked only if press time stamps are offset)' },
  ]

  let phase = $state<Phase>('intro')
  let trial = $state(0)
  let keyCount = $state(0)
  let pointerCount = $state(0)
  let report = $state<SelfTestReport | null>(null)
  let json = $state('')
  let copyStatus = $state('')
  let errorText = $state('')
  let hiddenDuringRun = $state(false)

  let dot: HTMLDivElement | undefined = $state()
  let keyZone: HTMLElement | undefined = $state()
  let pointerHeading: HTMLElement | undefined = $state()
  let resultsHeading: HTMLElement | undefined = $state()
  let startButton: HTMLButtonElement | undefined = $state()
  let jsonBox: HTMLTextAreaElement | undefined = $state()

  let frameTimestamps: number[] = []
  let increments: number[] = []
  let onsets: OnsetTrial[] = []
  let keys: InputSample[] | null = []
  let pointers: InputSample[] | null = []

  const running = $derived(phase === 'frames' || phase === 'timer' || phase === 'onsets' || phase === 'keys' || phase === 'pointer')

  const statusText = $derived.by(() => {
    switch (phase) {
      case 'frames':
        return `Measuring the display refresh (${plan.frames} frames)…`
      case 'timer':
        return 'Measuring the timer resolution…'
      case 'onsets':
        return `Timing stimulus onsets: ${trial} of ${plan.onsets}`
      case 'keys':
        return `Key presses: ${keyCount} of ${plan.presses}`
      case 'pointer':
        return `Pointer presses: ${pointerCount} of ${plan.presses}`
      case 'done':
        return report?.pass ? 'Done: every timing check is within 5 ms.' : 'Done: at least one timing check is over 5 ms.'
      case 'error':
        return `The self-test stopped: ${errorText}`
      default:
        return ''
    }
  })

  const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  function showDot(on: boolean): void {
    // Set in the rAF callback itself, so the stimulus is drawn in the onset frame (§11.6 item 1).
    if (dot) dot.style.visibility = on && !reducedMotion() ? 'visible' : 'hidden'
  }

  async function start(): Promise<void> {
    if (running) return // Start stays focusable while a run is going (aria-disabled), so a press can arrive
    frameTimestamps = []
    increments = []
    onsets = []
    keys = []
    pointers = []
    keyCount = 0
    pointerCount = 0
    report = null
    json = ''
    copyStatus = ''
    errorText = ''
    hiddenDuringRun = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    const frames = browserFrameSource()
    try {
      phase = 'frames'
      frameTimestamps = await collectFrames(frames, plan.frames)
      phase = 'timer'
      await new Promise<void>((r) => frames.request(() => r())) // let the status paint before the busy loop
      increments = sampleTimer(performanceClock, plan.timerIncrements)
      phase = 'onsets'
      trial = 0
      onsets = await runOnsetTrials(frames, onsetDelays(plan.onsets), {
        onTrialStart: () => showDot(false),
        onOnset: (i) => {
          showDot(true)
          trial = i + 1
        },
      })
      showDot(false)
      phase = 'keys'
      await tick()
      keyZone?.focus() // the key phase takes over from the Start button, which has had focus during the run
    } catch (e) {
      fail(e)
    }
  }

  /**
   * After a phase change, move focus to the new section (the element that had it, e.g. the key
   * zone or a Skip button, is removed with the old one and focus would fall to the body).
   */
  async function focusAfterRender(target: () => HTMLElement | undefined): Promise<void> {
    await tick()
    target()?.focus()
  }

  function toPointerPhase(): void {
    phase = 'pointer'
    void focusAfterRender(() => pointerHeading)
  }

  function fail(e: unknown): void {
    showDot(false)
    errorText = e instanceof Error ? e.message : String(e)
    phase = 'error'
    void focusAfterRender(() => startButton)
  }

  /** Keys aimed at a control (Enter or Space on "Skip: no keyboard") operate it; they are not samples. */
  const onControl = (e: Event): boolean => e.target instanceof Element && e.target.closest('button, a, input, textarea, select') !== null

  function onKeyDown(e: KeyboardEvent): void {
    if (phase !== 'keys') return
    const sample = sampleEvent(e, performanceClock) // read the clock first thing in the handler
    if (e.repeat || e.key === 'Tab' || e.key === 'Shift' || onControl(e)) return
    if (e.key === ' ' || e.key === 'Enter') e.preventDefault()
    keys?.push(sample)
    keyCount += 1
    if (keyCount >= plan.presses) toPointerPhase()
  }

  function onPointerDown(e: PointerEvent): void {
    if (phase !== 'pointer') return
    const sample = sampleEvent(e, performanceClock)
    // No compatibility mousedown: its default action would move focus off the Results heading
    // once the last press ends the phase (the press still counts; click is unaffected).
    e.preventDefault()
    pointers?.push(sample)
    pointerCount += 1
    if (pointerCount >= plan.presses) finish()
  }

  function skipKeys(): void {
    keys = null
    toPointerPhase()
  }

  function skipPointer(): void {
    pointers = null
    finish()
  }

  function finish(): void {
    try {
      report = buildReport({
        quick,
        frameTimestamps,
        timerIncrements: increments,
        onsets,
        keys,
        pointers,
        context: {
          cross_origin_isolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
          hidden_during_run: hiddenDuringRun,
          device_pixel_ratio: typeof devicePixelRatio === 'number' ? devicePixelRatio : null,
        },
      })
      json = reportJson(report)
      phase = 'done'
      void focusAfterRender(() => resultsHeading)
    } catch (e) {
      fail(e)
    }
  }

  async function copyJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(json)
      copyStatus = COPIED
    } catch {
      jsonBox?.select()
      copyStatus = COPY_BLOCKED
    }
  }

  const COPIED = 'Report copied.'
  const COPY_BLOCKED = 'Copying was blocked. The report is selected: copy it yourself.'

  const fmt = (v: number): string => (v < 10 ? v.toFixed(2) : v.toFixed(1))

  /** The short verdict of a press delay whose time stamps are offset (the full reason, EVENT_OFFSET_NOTE, is shown above the table). */
  const OFFSET_VERDICT = 'Fail: offset time stamps'

  /** True when a press delay was checked because its time stamps are offset (then it fails, and the page says why). */
  const offsetShown = $derived(report !== null && (report.metrics.key_latency_ms.note === EVENT_OFFSET_NOTE || report.metrics.pointer_latency_ms.note === EVENT_OFFSET_NOTE))

  function verdictOf(m: MetricReport): string {
    if (m.summary === null) return m.note === 'skipped' ? 'Skipped' : 'Not measured'
    if (m.pass === null) return 'For information'
    return m.pass ? 'Pass' : m.note === EVENT_OFFSET_NOTE ? OFFSET_VERDICT : `Over ${SELFTEST_THRESHOLD_MS} ms`
  }

  onMount(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden' && running) hiddenDuringRun = true
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  })
</script>

<svelte:window onkeydown={onKeyDown} />

<header>
  <a class="home" href={HOME_HREF} translate="no">HumanBench</a>
</header>

<main>
  <h1>RT timing self-test</h1>
  <p>This page checks how precisely this browser, display and input devices can time reaction-time trials. Nothing is saved or sent.</p>
  <p>It measures:</p>
  <ul>
    <li>the refresh rate, and how regular the animation frames are;</li>
    <li>the timer resolution;</li>
    <li>how closely stimuli appear in the frame they were scheduled for;</li>
    <li>the delay before key presses and pointer presses are handled.</li>
  </ul>
  <p>Each check reports the median (p50), the 95th percentile (p95) and the maximum. A timing check passes when its p95 is below {SELFTEST_THRESHOLD_MS} ms.</p>
  <p>
    The delays before presses are handled are usually for information only. Reaction times use the time stamp of the press itself, so those delays
    are not part of them. Some browsers' press time stamps are offset from their timer. If the offset is over {MAX_EVENT_LAG_MS} ms, reaction times
    are timed when the page handles the press. Then the delay is checked like the other timing checks.
  </p>
  <p class="hint">
    Keep this tab in front and the window on the display you want to test, and close other busy tabs. The automatic part takes about
    {quick ? 'two' : 'fifteen'} seconds{quick ? ' (quick mode: small samples)' : ''}.
  </p>

  <div class="controls">
    <button
      type="button"
      bind:this={startButton}
      onclick={start}
      aria-disabled={running ? 'true' : undefined}
      aria-describedby="selftest-status">{phase === 'done' || phase === 'error' ? 'Run again' : 'Start'}</button
    >
  </div>

  <p class="status" id="selftest-status" role="status" aria-live="polite">{statusText}</p>

  <div class="stage" aria-hidden="true">
    <div class="dot" bind:this={dot}></div>
  </div>

  {#if phase === 'keys'}
    <section class="task" aria-labelledby="keys-heading">
      <h2 id="keys-heading">Key presses</h2>
      <p bind:this={keyZone} tabindex="-1" class="zone">
        Press the <kbd translate="no">Space bar</kbd> {plan.presses} times, at your own pace ({keyCount} of {plan.presses}).
      </p>
      <button type="button" class="secondary" onclick={skipKeys}>Skip: no keyboard</button>
    </section>
  {:else if phase === 'pointer'}
    <section class="task" aria-labelledby="pointer-heading">
      <h2 id="pointer-heading" bind:this={pointerHeading} tabindex="-1">Pointer presses</h2>
      <p>Click or tap the button below {plan.presses} times ({pointerCount} of {plan.presses}).</p>
      <button type="button" class="target" onpointerdown={onPointerDown}>Tap target</button>
      <button type="button" class="secondary" onclick={skipPointer}>Skip: no mouse or touch</button>
    </section>
  {/if}

  {#if report !== null}
    <section aria-labelledby="results-heading">
      <h2 id="results-heading" bind:this={resultsHeading} tabindex="-1">Results</h2>
      <p class="overall">
        Overall: <strong>{report.pass ? 'Pass' : 'Fail'}</strong>
        (p{Math.round(GATE_QUANTILE * 100)} below {report.threshold_ms} ms on every timing check). Refresh rate: {report.refresh.hz} Hz (measured
        {report.refresh.raw_hz.toFixed(1)} Hz).
      </p>
      {#if report.context.hidden_during_run}
        <p class="warn">The tab was hidden during the run, so frame timings are not representative. Run again with the tab in front.</p>
      {/if}
      {#if offsetShown}
        <p class="warn">{EVENT_OFFSET_NOTE}</p>
      {/if}
      <table>
        <caption>Timing checks in milliseconds (n is the number of samples)</caption>
        <thead>
          <tr>
            <th scope="col" class="name">Check</th>
            <th scope="col" class="num">p50</th>
            <th scope="col" class="num">p95</th>
            <th scope="col" class="num">Max</th>
            <th scope="col" class="num n">n</th>
            <th scope="col" class="result">Result</th>
          </tr>
        </thead>
        <tbody>
          {#each METRIC_ROWS as row (row.key)}
            {@const m = report.metrics[row.key]}
            <tr>
              <th scope="row" class="name"
                >{row.label}<span class="verdict" class:pass={m.pass === true} class:over={m.pass === false}>{verdictOf(m)}</span></th
              >
              {#if m.summary}
                <td class="num">{fmt(m.summary.p50)}</td>
                <td class="num">{fmt(m.summary.p95)}</td>
                <td class="num">{fmt(m.summary.max)}</td>
                <td class="num n">{m.summary.n}</td>
              {:else}
                <td class="num">–</td>
                <td class="num">–</td>
                <td class="num">–</td>
                <td class="num n">0</td>
              {/if}
              <td class="result" class:pass={m.pass === true} class:over={m.pass === false}>{verdictOf(m)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <label for="report-json">JSON report</label>
      <textarea id="report-json" bind:this={jsonBox} readonly rows="12" value={json}></textarea>
      <div class="controls">
        <button type="button" onclick={copyJson}>Copy JSON</button>
        <span role="status" aria-live="polite">{copyStatus}</span>
      </div>
    </section>
  {/if}
</main>

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
</footer>

<style>
  header {
    box-sizing: border-box;
    width: 100%;
    max-width: 48rem;
    margin: 0 auto;
    padding: 0.5rem 1rem 0;
  }

  .home {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    font-weight: 600;
    color: var(--text-strong);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .home:focus-visible {
    outline: 3px solid var(--text-strong);
    outline-offset: 2px;
  }

  main {
    flex: 1;
    width: 100%;
    max-width: 48rem;
    margin: 0 auto;
    padding: 1rem 1rem 3rem;
    box-sizing: border-box;
  }

  h1 {
    margin: 0 0 1rem;
    font-size: clamp(1.75rem, 6vw, 2.5rem);
    font-weight: 600;
    color: var(--text-strong);
  }

  h2 {
    margin: 1.5rem 0 0.5rem;
    font-size: 1.25rem;
    color: var(--text-strong);
  }

  .hint {
    font-size: 0.9375rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
  }

  button {
    min-height: 2.75rem;
    padding: 0.5rem 1.25rem;
    font: inherit;
    font-weight: 600;
    color: var(--bg);
    background: var(--text-strong);
    border: 2px solid var(--text-strong);
    border-radius: 0.5rem;
    cursor: pointer;
  }

  /* Not `disabled`: a disabled button drops focus to the body; this one stays in the Tab order and ignores presses. */
  button[aria-disabled='true'] {
    cursor: default;
    opacity: 0.6;
  }

  button:focus-visible,
  .zone:focus-visible,
  h2:focus-visible,
  textarea:focus-visible {
    outline: 3px solid var(--text-strong);
    outline-offset: 2px;
  }

  button.secondary {
    color: var(--text-strong);
    background: transparent;
  }

  button.target {
    display: block;
    width: min(100%, 16rem);
    min-height: 8rem;
    margin: 0 0 1rem;
    touch-action: manipulation;
  }

  .status {
    min-height: 1.5em;
    font-weight: 600;
    color: var(--text-strong);
  }

  .stage {
    height: 2rem;
  }

  .dot {
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--text-strong);
    visibility: hidden;
  }

  .zone {
    padding: 1rem;
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
  }

  kbd {
    padding: 0.0625rem 0.375rem;
    font: inherit;
    font-weight: 600;
    color: var(--text-strong);
    border: 1px solid var(--text-strong);
    border-radius: 0.25rem;
    white-space: nowrap;
  }

  .overall strong {
    color: var(--text-strong);
  }

  .warn {
    font-weight: 600;
    color: var(--text-strong);
  }

  /* No scrolling wrapper (axe scrollable-region-focusable): the table fits a phone. Only the check name may break
     inside a word; a number never wraps, so "17.0" is never stacked one character per line (320 px and up). */
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  caption {
    text-align: left;
    padding-bottom: 0.5rem;
  }

  th,
  td {
    padding: 0.375rem 0.5rem;
    border-bottom: 1px solid var(--border);
    text-align: right;
  }

  .num {
    white-space: nowrap;
    overflow-wrap: normal;
  }

  th.name,
  th.result,
  td.result {
    text-align: left;
  }

  th.name {
    overflow-wrap: anywhere;
  }

  td.result {
    overflow-wrap: normal;
  }

  /* The result also sits under the check name for phones (below); beside the numbers it is a column. */
  .verdict {
    display: none;
  }

  /*
   * Phones: the sample count (n, also in the JSON report) and the Result column leave the table, and the result goes under the
   * check name instead (display: none takes the column's cells out of the accessibility tree, so each result is read once).
   * That leaves the three numbers and the name, which fits 320 px and, with the name breaking where it must, 200% text.
   */
  @media (max-width: 30rem) {
    table {
      font-size: 0.875rem;
    }

    th,
    td {
      padding: 0.25rem 0.25rem;
    }

    .n,
    .result {
      display: none;
    }

    .verdict {
      display: block;
      font-weight: 400;
    }
  }

  .pass,
  .over {
    font-weight: 600;
    color: var(--text-strong);
  }

  .over {
    text-decoration: underline;
  }

  label {
    display: block;
    margin-top: 1rem;
    font-weight: 600;
    color: var(--text-strong);
  }

  textarea {
    box-sizing: border-box;
    width: 100%;
    margin-top: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }

  footer {
    border-top: 1px solid var(--border);
    padding: 1rem;
    text-align: center;
  }

  .disclaimer {
    margin: 0 auto;
    max-width: 40rem;
    font-size: 0.875rem;
  }
</style>
