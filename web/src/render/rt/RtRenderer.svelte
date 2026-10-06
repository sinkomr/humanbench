<!--
  Reaction-time stimuli, simple and 4-choice (ROADMAP M1.10, M1.13, A10; DESIGN §3 row 9, §7.1,
  §11.6, §13, §14.6 ex. 12). 3 practice trials with feedback, then the scored trials. Each trial
  shows a fixation cross, then the target after the spec's foreperiod, drawn in the first animation
  frame at or after the onset time (the rAF onset scheduler of `tasks/rt/timing.ts`); the cross is
  drawn in the middle of the pad (of the row of pads, with four positions) and is gone in the frame
  that draws the target, so the gaze does not have to drop to it (UX-084; markup and style only, the
  trial state machine and its timing are unchanged); RT is the
  input event's own timestamp (`event.timeStamp`, else `performance.now()` in the handler) minus that frame's timestamp (`responseRtMs`, §11.6), so a press
  before the target is drawn is an anticipation. Keyboard mode: Space (simple) or D F J K / 1–4
  (choice); touch mode: tap or click the position. The response is the family's `RtResponse`
  (scored and practice trials as parallel arrays), sent once at the end of the block, just after
  `oninputtype` reports the input type the responses came from (keyboard, mouse or touch, from
  each tap's `pointerType`; §11.6 items 2 and 5 norm them separately). One polite status line
  stays mounted in every phase; at the end of the block it says so and takes focus, so keyboard
  and screen-reader users keep their place (WCAG 2.4.3, 4.1.3; as the span renderers).
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import { focusStage, isOwnKey } from '../common/focus'
  import { browserTiming, type RendererProps } from '../common/props'
  import { afterFrames } from '../common/sequence'
  import { BlockTimestampPolicy, createOnsetScheduler, combineTimestampSources, responseRtMs, type ScheduledOnset, type TimestampReason, type TimestampSource } from '../../tasks/rt/timing'
  import { RT_PRACTICE_TRIALS, type RtResponse, type RtSpec } from '../../tasks/rt/types'
  import { CHOICE_KEY_LABELS, RT_EARLY_ITI_MS, RT_ITI_MS, pointerInputType, positionOfKey, responseWindowMs, type RtInputMode, type RtInputType } from './keys'

  interface Props extends RendererProps<RtSpec, RtResponse> {
    /** Fixed input mode (the session's device check); omitted = the taker chooses on the intro. */
    readonly inputMode?: RtInputMode
    /** Called with the control scheme (keys, or tap or click) when the block starts. */
    readonly oninputmode?: (mode: RtInputMode) => void
    /**
     * Called once at the end of the block, just before `onrespond`, with the input type the
     * responses came from: store it as the observation's `RtDevice.input_type` (§11.6: keyboard,
     * mouse and touch are normed separately; a mouse click in tap-or-click mode is 'mouse').
     */
    readonly oninputtype?: (type: RtInputType) => void
    /**
     * Called once at the end of the block, just before `onrespond`, with where the response
     * timestamps came from: 'event' (the input events' own timestamps), 'handler' (clock read in
     * the handler, the fallback) or 'mixed', and the reason when the block switched to the handler
     * clock (the event clock is offset from performance.now(), e.g. Safari). Stored as the observation's `rt_timestamp_source`.
     */
    readonly ontimestampsource?: (source: TimestampSource | 'mixed', reason?: TimestampReason) => void
  }

  let { spec, onrespond, timing, inputMode, oninputmode, oninputtype, ontimestampsource }: Props = $props()

  type Phase = 'intro' | 'running' | 'ready' | 'done'
  type Stage = 'practice' | 'main'
  type TrialState = 'blank' | 'fixation' | 'stimulus'

  const uid = $props.id()
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  // The initial mode only; a later inputMode change does not switch a running block.
  // svelte-ignore state_referenced_locally
  let mode: RtInputMode = $state(inputMode ?? (coarse ? 'touch' : 'keyboard'))
  let phase: Phase = $state('intro')
  let stage: Stage = $state('practice')
  let trialIdx = $state(0)
  let trialState: TrialState = $state('blank')
  let target: number | null = $state(null)
  let note = $state('')
  let root: HTMLElement | undefined = $state()
  let stageEl: HTMLElement | undefined = $state()
  let statusEl: HTMLElement | undefined = $state()

  const rts: (number | null)[] = []
  const choices: (number | null)[] = []
  const practiceRts: (number | null)[] = []
  const practiceChoices: (number | null)[] = []
  // PointerEvent.pointerType of each tap-or-click response, practice and scored apart.
  const practicePointers: string[] = []
  const scoredPointers: string[] = []
  const stampSources: TimestampSource[] = []
  // Decided after the practice trials; one source for the whole block (§11.6).
  const clockPolicy = new BlockTimestampPolicy()

  let onset: ScheduledOnset | null = null
  let deadline: ScheduledOnset | null = null
  let startHandle: number | null = null
  let cancelPause: (() => void) | null = null

  const t = $derived(timing ?? browserTiming())
  const scheduler = $derived(createOnsetScheduler(t.frames))
  const choice4 = $derived(spec.mode === 'choice4')
  const positions = $derived(Array.from({ length: spec.n_positions }, (_, i) => i))
  const nTrials = $derived(stage === 'practice' ? spec.practice_positions.length : spec.positions.length)
  // The name of the element that holds focus while the block runs (a nameless target is silent in a screen reader).
  const stageLabel = $derived(
    mode === 'touch'
      ? choice4
        ? 'Reaction stage: tap the position where the target appears'
        : 'Reaction stage: tap the target when it appears'
      : choice4
        ? 'Reaction stage: press D, F, J or K to match the position of the target'
        : 'Reaction stage: press Space when the target appears',
  )

  function stopTimers(): void {
    onset?.cancel()
    deadline?.cancel()
    cancelPause?.()
    if (startHandle !== null) t.frames.cancel(startHandle)
    onset = deadline = null
    cancelPause = null
    startHandle = null
  }

  function runTrial(): void {
    const fps = stage === 'practice' ? spec.practice_foreperiods_ms : spec.foreperiods_ms
    const pos = stage === 'practice' ? spec.practice_positions : spec.positions
    const i = trialIdx
    const fp = fps[i]
    const p = pos[i]
    if (fp === undefined || p === undefined) return
    target = null
    trialState = 'fixation'
    flushSync()
    // The trial starts in the frame that draws the fixation cross; the foreperiod runs from there.
    startHandle = t.frames.request((ts0) => {
      startHandle = null
      onset = scheduler.schedule(fp, ts0, (onTs) => {
        target = p
        trialState = 'stimulus'
        flushSync()
        deadline = scheduler.schedule(responseWindowMs(spec.mode), onTs, () => record(null, null))
      })
    })
  }

  /** Record a response to the running trial; false when no trial is waiting for one. */
  function respond(position: number, event: { readonly timeStamp: number }): boolean {
    if (phase !== 'running' || trialState === 'blank' || onset === null) return false
    if (stage === 'practice') clockPolicy.observe(event, t.clock)
    const stamp = clockPolicy.stamp(event, t.clock, onset.onsetFrameTs ?? onset.target)
    if (stage === 'main') stampSources.push(stamp.source)
    const rt = responseRtMs(onset, stamp.ts)
    record(rt, spec.mode === 'simple' ? 0 : position)
    return true
  }

  /** The input type of this block's responses (§11.6); scored taps decide, else the practice ones. */
  function inputType(): RtInputType {
    if (mode === 'keyboard') return 'keyboard'
    return pointerInputType(scoredPointers.length > 0 ? scoredPointers : practicePointers, coarse ? 'touch' : 'mouse')
  }

  function record(rt: number | null, choice: number | null): void {
    const pos = (stage === 'practice' ? spec.practice_positions : spec.positions)[trialIdx]
    stopTimers()
    if (stage === 'practice') {
      practiceRts.push(rt)
      practiceChoices.push(choice)
    } else {
      rts.push(rt)
      choices.push(choice)
    }
    const early = rt !== null && rt < 0
    if (early) note = 'Too early. Wait for the target.'
    else if (stage === 'practice') {
      if (rt === null) note = 'No response that time.'
      else if (choice4 && choice !== pos) note = 'That was a different position.'
      else note = `${Math.round(rt)} ms`
    } else note = ''
    target = null
    trialState = 'blank'
    flushSync()
    cancelPause = afterFrames(t.frames, early ? RT_EARLY_ITI_MS : RT_ITI_MS, () => next())
  }

  function next(): void {
    cancelPause = null
    note = ''
    if (trialIdx + 1 < nTrials) {
      trialIdx += 1
      runTrial()
      return
    }
    if (stage === 'practice') {
      clockPolicy.decide()
      phase = 'ready'
      trialState = 'blank'
      flushSync()
      root?.querySelector<HTMLButtonElement>('button.hb-primary')?.focus()
      return
    }
    phase = 'done'
    flushSync()
    // The stage that held focus is gone: move focus to the status line, which now says so.
    statusEl?.focus()
    oninputtype?.(inputType())
    const source = combineTimestampSources(stampSources)
    const decision = clockPolicy.decision
    if (source !== undefined) {
      if (decision?.reason !== undefined && source === 'handler') ontimestampsource?.(source, decision.reason)
      else ontimestampsource?.(source)
    }
    onrespond({
      rt_ms: [...rts],
      choice: [...choices],
      practice_rt_ms: [...practiceRts],
      practice_choice: [...practiceChoices],
    })
  }

  function begin(which: Stage): void {
    if (which === 'practice') oninputmode?.(mode)
    stage = which
    trialIdx = 0
    phase = 'running'
    note = ''
    flushSync()
    focusStage(stageEl)
    runTrial()
  }

  function onkey(event: KeyboardEvent): void {
    if (phase !== 'running' || mode !== 'keyboard' || event.repeat || !isOwnKey(root, event)) return
    const p = positionOfKey(spec.mode, event.key)
    if (p === null) return
    event.preventDefault()
    respond(p, event)
  }

  function ontap(event: PointerEvent, position: number): void {
    event.preventDefault()
    if (mode !== 'touch') return
    const stageNow = stage
    const pointerType = typeof event.pointerType === 'string' ? event.pointerType : ''
    if (respond(position, event)) (stageNow === 'practice' ? practicePointers : scoredPointers).push(pointerType)
  }

  onDestroy(stopTimers)
</script>

<svelte:window onkeydown={onkey} />

<section class="hb-render rt" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">{choice4 ? 'Four positions' : 'One position'}</p>
  {#if phase === 'intro'}
    <p class="hb-instructions">
      {#if choice4}
        A target will appear in one of four positions. Respond to its position as fast as you can:
        {#if mode === 'keyboard'}press <kbd translate="no">D</kbd>, <kbd translate="no">F</kbd>, <kbd translate="no">J</kbd> or <kbd translate="no">K</kbd> (or <kbd translate="no">1</kbd> to <kbd translate="no">4</kbd>) for the positions from left to right{:else}tap or click that position{/if}.
      {:else}
        A target will appear in the box. As soon as you see it,
        {#if mode === 'keyboard'}press the <kbd translate="no">Space</kbd> bar{:else}tap or click the box{/if}.
      {/if}
      Wait for the target: pressing early does not count. First come {RT_PRACTICE_TRIALS} practice trials, then {spec.positions.length} counted trials.
    </p>
    {#if inputMode === undefined}
      <fieldset class="modes">
        <legend>Respond with</legend>
        <label><input type="radio" name="{uid}-mode" value="keyboard" bind:group={mode} /> Keyboard</label>
        <label><input type="radio" name="{uid}-mode" value="touch" bind:group={mode} /> Tap or click</label>
      </fieldset>
    {/if}
    <button type="button" class="hb-btn hb-primary" onclick={() => begin('practice')}>Start practice</button>
  {:else if phase === 'ready'}
    <p class="hb-instructions">Practice done. The counted trials start now.</p>
    <button type="button" class="hb-btn hb-primary" onclick={() => begin('main')}>Start</button>
  {:else if phase === 'running'}
    <p class="progress">{stage === 'practice' ? 'Practice' : 'Trial'} <span translate="no">{trialIdx + 1}</span> of <span translate="no">{nTrials}</span></p>
    <div class="stage" class:choice4 role="group" aria-label={stageLabel} bind:this={stageEl} tabindex="-1">
      <div class="pads">
        <!-- Drawn over the middle of the pads (the one pad, or between the middle two of four), never in a row of its own. -->
        <p class="fixation" aria-hidden="true">{trialState === 'fixation' ? '+' : ''}</p>
        {#each positions as i (i)}
          {#if mode === 'touch'}
            <button
              type="button"
              class="pad"
              class:on={trialState === 'stimulus' && target === i}
              aria-label={choice4 ? `Position ${i + 1}` : 'Target box'}
              onpointerdown={(e) => ontap(e, i)}
            ></button>
          {:else}
            <div class="pad" class:on={trialState === 'stimulus' && target === i}></div>
          {/if}
        {/each}
      </div>
      {#if choice4 && mode === 'keyboard'}
        <div class="keys" aria-hidden="true">
          {#each CHOICE_KEY_LABELS as k (k)}<span>{k}</span>{/each}
        </div>
      {/if}
    </div>
    <p class="hb-sr-only" aria-live="assertive" aria-atomic="true">
      {trialState === 'stimulus' && target !== null ? (choice4 ? `Target, position ${target + 1}` : 'Target') : ''}
    </p>
  {/if}
  <p class="hb-status" aria-live="polite" tabindex="-1" bind:this={statusEl}>{phase === 'done' ? 'Block complete. Thank you.' : note}</p>
</section>

<style>
  .rt {
    padding: 0.5rem 0;
  }

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin: 0 0 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
  }

  .modes label {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.75rem;
  }

  .progress {
    margin: 0 0 0.5rem;
    color: var(--r-muted);
  }

  kbd {
    padding: 0 0.25rem;
    border: 1px solid var(--r-border);
    border-radius: 0.25rem;
    background: var(--r-surface);
    font: inherit;
    font-weight: 600;
  }

  .stage {
    display: grid;
    gap: 0.75rem;
    justify-items: center;
    max-width: 32rem;
    padding: 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.75rem;
    background: var(--r-surface);
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  /* The fixation cross: in the middle of the pads, where the target will be (UX-084), above them in the stack, and no target for a tap. */
  .fixation {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    place-items: center;
    margin: 0;
    font-size: 2.5rem;
    line-height: 1;
    font-weight: 700;
    pointer-events: none;
    /*
      With four positions the middle of the row is the gap between the middle two pads: a halo of the stage's own colour
      keeps the cross clear of their borders. Written out (no colour token of its own, so scripts/contrast.test.ts has
      no new token to pair): the page colour here, the surface colour of the four-position stage below.
    */
    text-shadow:
      -2px 0 var(--r-bg),
      2px 0 var(--r-bg),
      0 -2px var(--r-bg),
      0 2px var(--r-bg),
      -2px -2px var(--r-bg),
      2px -2px var(--r-bg),
      -2px 2px var(--r-bg),
      2px 2px var(--r-bg);
  }

  .choice4 .fixation {
    text-shadow:
      -2px 0 var(--r-surface),
      2px 0 var(--r-surface),
      0 -2px var(--r-surface),
      0 2px var(--r-surface),
      -2px -2px var(--r-surface),
      2px -2px var(--r-surface),
      -2px 2px var(--r-surface),
      2px 2px var(--r-surface);
  }

  .pads {
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(3rem, 1fr));
    gap: 0.5rem;
    width: 100%;
  }

  .stage:not(.choice4) .pads {
    max-width: 12rem;
  }

  .pad {
    aspect-ratio: 1;
    min-height: 3rem;
    padding: 0;
    border: 3px solid var(--r-border);
    border-radius: 0.75rem;
    background: var(--r-bg);
    touch-action: manipulation;
  }

  .pad.on {
    background: radial-gradient(circle, var(--r-fg) 0 42%, var(--r-bg) 43%);
    border-color: var(--r-fg);
  }

  .keys {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    width: 100%;
    text-align: center;
    font-weight: 600;
  }
</style>
