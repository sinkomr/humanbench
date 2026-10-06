<!--
  The running session (ROADMAP M1.15; DESIGN §7.4, §10, §13; A15): the time-based progress ring and
  the per-cluster checklist around whatever the run is showing: an interstitial ("Up next: Spatial.
  About 6 min."), a fixed block, a power item with its confidence slider, the break suggestion, or the
  break itself. "Skip <axis>" and "Finish early" are always at hand. This component only shows
  `SessionRun.view()` and forwards the renderers' events; the rules live in `run.ts`.
  The header is small on a phone (UX-003); "Keep going" in a confirmation hands focus back to the running
  block's own input surface, so the next response key counts (UX-005a); the browser's Back button opens
  "Finish now?" through `finishRequest` (UX-011); a question the browser cannot draw shows its message
  and its Skip button first, and says it once: the renderer that reported the condition stays mounted but
  parked in a `hidden` wrapper, out of sight and out of the accessibility tree, so its own note and its
  empty frames are neither drawn nor read, and the panel's role=status line is the one announcement (UX-017a).
-->
<script lang="ts">
  import { onMount, tick as svelteTick } from 'svelte'
  import type { ProblemReport } from '../backend/api'
  import { LOADING_PROBLEM, LOADING_RETRY, LOADING_TEXT } from '../backend/copy'
  import ReportProblem from '../backend/ReportProblem.svelte'
  import Checklist from './Checklist.svelte'
  import Confidence from './Confidence.svelte'
  import ConfirmPanel from './ConfirmPanel.svelte'
  import ProgressRing from './ProgressRing.svelte'
  import Screen from './Screen.svelte'
  import Stage from './Stage.svelte'
  import {
    BREAK_DECLINE,
    BREAK_HEADING,
    BREAK_OFFER_HEADING,
    BREAK_OFFER_TEXT,
    BREAK_RESUME,
    BREAK_TAKE,
    BREAK_TEXT,
    FINISHED_AUTOSAVE_UNAVAILABLE,
    FINISH_CONFIRM_HEADING,
    FINISH_CONFIRM_NO,
    FINISH_CONFIRM_TEXT,
    FINISH_CONFIRM_YES,
    FINISH_EARLY,
    FINISH_EARLY_HEAD,
    FINISH_EARLY_TAIL,
    INTERSTITIAL_SKIP,
    INTERSTITIAL_START,
    NOTICE_MALFORMED,
    NOTICE_TIMEOUT,
    NOTICE_TIMEOUT_SERVED,
    SKIP_CONFIRM_HEADING,
    SKIP_CONFIRM_NO,
    SKIP_CONFIRM_TEXT,
    SKIP_CONFIRM_YES,
    SKIP_HEAD,
    aboutMinutes,
    noticeSkipped,
    noticeUnavailable,
    noticeUnsupported,
    skipButton,
    upNext,
  } from './copy'
  import type { SessionEnv } from './env'
  import type { AutosaveStatus } from './persist'
  import type { RunView, SessionRun } from './run'
  import { SEGMENT_INFO, skipTargetName } from './segments'

  interface Props {
    readonly env: SessionEnv
    readonly run: SessionRun
    readonly autosave: AutosaveStatus
    /** The dev banner (`?fast=1`), or ''. */
    readonly banner?: string
    /** With a server (ROADMAP M2.7): sends a report about the question on screen. Absent in the static fallback. */
    readonly report?: (r: ProblemReport) => Promise<void>
    /** Every increase asks "Finish now?" (the browser's Back button during the run, UX-011). */
    readonly finishRequest?: number
  }

  let { env, run, autosave, banner = '', report, finishRequest = 0 }: Props = $props()

  // The run is fixed for the life of this screen; its changes arrive through subscribe().
  // svelte-ignore state_referenced_locally
  let view: RunView = $state.raw(run.view())
  // svelte-ignore state_referenced_locally
  let elapsedS = $state(run.elapsedS())
  let confirm: 'skip' | 'finish' | null = $state(null)
  let opener: HTMLElement | null = null
  let finishButton: HTMLButtonElement | undefined = $state()
  // svelte-ignore state_referenced_locally
  let seenFinishRequest = finishRequest

  $effect(() => run.subscribe(() => (view = run.view())))

  onMount(() => {
    const timer = setInterval(() => {
      run.tick()
      elapsedS = run.elapsedS()
    }, 250)
    const onVisibility = (): void => run.noteVisibility(document.visibilityState === 'hidden' ? 'hidden' : 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })

  const segment = $derived(view.segment)
  /** The part on screen, or the one a break leads to, is the last one still to come (the ring says "Almost there" only then). */
  const lastPart = $derived.by(() => {
    const here = view.segments[view.segmentIndex]
    const onBreak = view.phase === 'break_offer' || view.phase === 'on_break'
    const next = view.segmentIndex + (onBreak && here !== undefined && here.status !== 'current' ? 2 : 1)
    return view.segments.slice(next).every((s) => s.status === 'skipped')
  })
  const skipName = $derived(view.skippable === null ? '' : skipTargetName(view.skippable))
  const title = $derived.by(() => {
    switch (view.phase) {
      case 'interstitial':
        return upNext(segment?.title ?? '')
      case 'break_offer':
        return BREAK_OFFER_HEADING
      case 'on_break':
        return BREAK_HEADING
      default:
        return segment?.title ?? ''
    }
  })
  /** A new key remounts the page: focus moves to its heading (WCAG 2.4.3). */
  const screenKey = $derived.by(() => {
    switch (view.phase) {
      case 'interstitial':
        return `i:${view.segmentIndex}`
      case 'block':
        return `b:${view.block?.item_id ?? ''}`
      case 'item':
      case 'confidence':
        return `q:${view.item?.item_id ?? ''}`
      default:
        return view.phase
    }
  })
  const notice = $derived.by(() => {
    const n = view.notice
    if (n === null) return ''
    // The panel under the heading says it; the header does not say it a second time.
    if (view.unavailable && (n.kind === 'unavailable' || n.kind === 'unsupported')) return ''
    switch (n.kind) {
      case 'timeout':
        return n.served === true ? NOTICE_TIMEOUT_SERVED : NOTICE_TIMEOUT
      case 'malformed':
        return NOTICE_MALFORMED
      case 'skipped':
        return noticeSkipped(n.axis === undefined ? '' : skipTargetName(n.axis))
      case 'unavailable':
        return noticeUnavailable(n.axis === undefined ? '' : skipTargetName(n.axis))
      case 'unsupported':
        return noticeUnsupported(n.axis === undefined ? '' : skipTargetName(n.axis))
    }
  })

  function ask(which: 'skip' | 'finish', event: Event): void {
    opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    confirm = which
  }

  /** Where focus goes back to after "Keep going": a running block's input surface, else what opened the panel. */
  async function cancel(): Promise<void> {
    confirm = null
    await svelteTick()
    const surface = view.phase === 'block' ? document.querySelector<HTMLElement>('.session .body .stage[tabindex="-1"], .session .body .board[tabindex="-1"]') : null
    if (surface !== null) surface.focus()
    else opener?.focus()
  }

  function confirmSkip(): void {
    confirm = null
    run.skipAxis()
  }

  function confirmFinish(): void {
    confirm = null
    run.finishEarly()
  }

  // A confirmation belongs to the screen it was asked on.
  $effect(() => {
    void screenKey
    confirm = null
  })

  // The browser's Back button: ask whether to finish.
  $effect(() => {
    const n = finishRequest
    if (n === seenFinishRequest) return
    seenFinishRequest = n
    opener = finishButton ?? null
    confirm = 'finish'
  })
</script>

<div class="hb-render session" data-phase={view.phase}>
  <header class="top">
    {#if banner !== ''}
      <p class="banner" role="note">{banner}</p>
    {/if}
    <div class="bar">
      <ProgressRing {elapsedS} targetS={view.targetS} {lastPart} />
      {#if view.phase !== 'on_break'}
        <div class="actions">
          {#if view.skippable !== null && view.phase !== 'interstitial'}
            <button type="button" class="hb-btn" onclick={(e) => ask('skip', e)}>{SKIP_HEAD}<span class="narrow-hide">{` ${skipName}`}</span></button>
          {/if}
          <button type="button" class="hb-btn" bind:this={finishButton} onclick={(e) => ask('finish', e)}>{FINISH_EARLY_HEAD}<span class="narrow-hide">{FINISH_EARLY_TAIL}</span></button>
        </div>
      {/if}
    </div>
    <p class="status" class:calm={view.notice?.kind === 'skipped' || view.notice?.kind === 'timeout'} role="status" aria-live="polite">{notice}</p>
    {#if autosave !== 'ok'}
      <p class="status muted" role="status">{FINISHED_AUTOSAVE_UNAVAILABLE}</p>
    {/if}
  </header>

  <div class="body">
    {#key screenKey}
      <Screen {title} wide>
        {#if view.phase === 'interstitial' && segment !== null}
          <p class="lead">{aboutMinutes(segment.minutes)}</p>
          <p>{SEGMENT_INFO[segment.id].blurb}</p>
          <div class="hb-actions">
            <button type="button" class="hb-btn hb-primary" onclick={() => run.startSegment()}>{INTERSTITIAL_START}</button>
            <button type="button" class="hb-btn" onclick={(e) => ask('skip', e)}>{INTERSTITIAL_SKIP}</button>
          </div>
        {:else if view.phase === 'block' && view.block !== null}
          <Stage
            block
            family={view.block.family}
            itemId={view.block.item_id}
            spec={view.block.spec}
            scale={env.scale}
            timing={env.timing}
            inputMode={view.rtInput}
            onrespond={(r) => run.blockResponded(r)}
            oninputtype={(t) => run.blockInputType(t)}
            ontimestampsource={(s, reason) => run.blockTimestampSource(s, reason)}
          />
        {:else if (view.phase === 'item' || view.phase === 'confidence') && view.item !== null}
          {#if view.unavailable}
            <div class="unavailable" role="group" aria-label="This question cannot be shown">
              <p role="status">{view.notice?.kind === 'unsupported' ? noticeUnsupported(skipName) : noticeUnavailable(skipName)}</p>
              <div class="hb-actions">
                <button type="button" class="hb-btn hb-primary" onclick={() => run.skipAxis()}>{skipButton(skipName)}</button>
                <button type="button" class="hb-btn" onclick={(e) => ask('finish', e)}>{FINISH_EARLY}</button>
              </div>
            </div>
          {/if}
          <!-- Always this one wrapper, so the renderer is never remounted when the question turns out to be unavailable. -->
          <div class="stage-host" hidden={view.unavailable}>
            <Stage
              family={view.item.family}
              itemId={view.item.item_id}
              spec={view.item.spec}
              scale={env.scale}
              timing={env.timing}
              disabled={view.phase === 'confidence' || view.unavailable}
              onrespond={(r) => run.itemResponded(r)}
              onshown={(ms) => run.itemShown(ms)}
              onunavailable={() => run.itemUnavailable()}
              onpaste={(id) => run.notePaste(id)}
            />
          </div>
          {#if view.phase === 'confidence' && view.confidence !== null}
            <Confidence floorPct={view.confidence.floorPct} startPct={view.confidence.startPct} optionsCount={view.confidence.optionsCount} onconfirm={(pct) => run.confirmConfidence(pct)} />
          {/if}
          {#if view.reportable !== null && report !== undefined}
            <ReportProblem itemId={view.reportable} {report} />
          {/if}
        {:else if view.phase === 'loading'}
          {#if view.problem === null}
            <p role="status" data-loading>{LOADING_TEXT}</p>
          {:else}
            <p role="alert" data-loading-problem={view.problem}>{LOADING_PROBLEM[view.problem]}</p>
            {#if view.problem !== 'ended'}
              <div class="hb-actions">
                <button type="button" class="hb-btn hb-primary" onclick={() => run.retryLoad()}>{LOADING_RETRY}</button>
              </div>
            {/if}
          {/if}
        {:else if view.phase === 'break_offer'}
          <p>{BREAK_OFFER_TEXT}</p>
          <div class="hb-actions">
            <button type="button" class="hb-btn hb-primary" onclick={() => run.takeBreak()}>{BREAK_TAKE}</button>
            <button type="button" class="hb-btn" onclick={() => run.declineBreak()}>{BREAK_DECLINE}</button>
          </div>
        {:else if view.phase === 'on_break'}
          <p>{BREAK_TEXT}</p>
          <div class="hb-actions">
            <button type="button" class="hb-btn hb-primary" onclick={() => run.resume()}>{BREAK_RESUME}</button>
          </div>
        {/if}

        {#if confirm === 'skip'}
          <ConfirmPanel heading={SKIP_CONFIRM_HEADING(skipName)} text={SKIP_CONFIRM_TEXT} yes={SKIP_CONFIRM_YES(skipName)} no={SKIP_CONFIRM_NO} onyes={confirmSkip} onno={cancel} />
        {:else if confirm === 'finish'}
          <ConfirmPanel heading={FINISH_CONFIRM_HEADING} text={FINISH_CONFIRM_TEXT} yes={FINISH_CONFIRM_YES} no={FINISH_CONFIRM_NO} onyes={confirmFinish} onno={cancel} />
        {/if}
      </Screen>
    {/key}
    <aside class="side">
      <Checklist segments={view.segments} focus={view.focus} />
    </aside>
  </div>
</div>

<style>
  .session {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .banner {
    margin: 0;
    padding: 0.5rem 1rem;
    background: var(--r-surface);
    border-bottom: 2px solid var(--r-border);
    font-size: 0.875rem;
  }

  .top {
    border-bottom: 1px solid var(--r-border);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1rem;
    padding: 0.75rem 1rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .status {
    margin: 0;
    padding: 0 1rem;
    min-height: 1.5rem;
    overflow-wrap: anywhere;
    color: var(--r-note);
  }

  /* Nothing to say: the line stays in the page (it is a live region) but takes no room. */
  .status:empty {
    min-height: 0;
  }

  /* What the person did or what the clock did (a skip, a time-out) is news, not a warning. */
  .status.muted,
  .status.calm {
    color: var(--r-muted);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    flex: 1;
    min-width: 0;
  }

  .body :global(.hb-screen) {
    max-width: none;
  }

  .side {
    padding: 0 1rem 1.5rem;
    min-width: 0;
  }

  /* The wrapper is not a box of its own, so the renderer lays out as if it were a direct child; parked (hidden), it is display: none. */
  .stage-host:not([hidden]) {
    display: contents;
  }

  .unavailable {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  /* A phone: the header is one row and small, and its buttons show their first word; the rest stays in the name (WCAG 2.5.3). */
  @media (max-width: 30rem) {
    .bar {
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
    }

    .actions {
      flex-wrap: nowrap;
      gap: 0.375rem;
      margin-left: auto;
    }

    .narrow-hide {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  }

  @media (min-width: 52rem) {
    .body {
      grid-template-columns: minmax(0, 1fr) 16rem;
      align-items: start;
    }

    .side {
      padding: 2rem 1rem 1.5rem 0;
    }
  }
</style>
