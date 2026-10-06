<!--
  Practice mode (ROADMAP M1.15; DESIGN §10): a few easy questions with the confidence slider and then
  feedback on the answer. Nothing is counted or stored (`practice.ts`). The feedback (right or not,
  and the answer) appears only after the answer, in this panel and never inside a question.
  Focus follows the practice (UX-004, WCAG 2.4.3, 4.1.3): every question is a new screen (the heading takes
  focus), the feedback takes focus when it appears and is also told to screen readers through a status line
  that has been on the page since the question appeared, and "Stop practice" leaves at once.
-->
<script lang="ts">
  import Confidence from './Confidence.svelte'
  import Screen from './Screen.svelte'
  import Stage from './Stage.svelte'
  import type { SessionEnv } from './env'
  import type { PracticeRun, PracticeView } from './practice'
  import {
    PRACTICE_ANSWER,
    PRACTICE_CORRECT,
    PRACTICE_DONE,
    PRACTICE_DONE_CONTINUE,
    PRACTICE_DONE_HEADING,
    PRACTICE_DONE_TEXT,
    PRACTICE_HEADING,
    PRACTICE_INCORRECT,
    PRACTICE_INTRO,
    PRACTICE_NEXT,
    PRACTICE_SKIP_ONE,
    PRACTICE_STOP,
    PRACTICE_UNAVAILABLE,
    practiceVerdict,
  } from './copy'

  interface Props {
    readonly env: SessionEnv
    readonly practice: PracticeRun
    /** Practice ended (finished, or stopped). */
    readonly ondone: () => void
  }

  let { env, practice, ondone }: Props = $props()

  // The run is fixed for the life of this screen; its changes arrive through subscribe().
  // svelte-ignore state_referenced_locally
  let view: PracticeView = $state.raw(practice.view())
  $effect(() => practice.subscribe(() => (view = practice.view())))

  /** Takes focus when it appears (an action runs once the element is in the page). */
  function focusMe(node: HTMLElement): void {
    node.focus()
  }
</script>

{#if view.phase === 'done'}
  <Screen title={PRACTICE_DONE_HEADING}>
    <p>{PRACTICE_DONE_TEXT}</p>
    <div class="hb-actions">
      <button type="button" class="hb-btn hb-primary" onclick={ondone}>{PRACTICE_DONE_CONTINUE}</button>
    </div>
  </Screen>
{:else}
  <!-- A new key per question: the screen is made again, so its heading takes focus and the page is at the top. -->
  {#key view.number}
    <Screen title={PRACTICE_HEADING}>
      <p>{PRACTICE_INTRO}</p>
      <p class="muted">Practice question <span translate="no">{view.number}</span> of <span translate="no">{view.total}</span></p>
      <p class="hb-sr-only" role="status">{view.phase === 'feedback' && view.feedback !== null ? practiceVerdict(view.feedback.correct, view.feedback.answer) : ''}</p>
      {#if view.item !== null}
        <Stage
          family={view.item.family}
          itemId={view.item.item_id}
          spec={view.item.spec}
          scale={env.scale}
          timing={env.timing}
          disabled={view.phase !== 'item'}
          onrespond={(r) => practice.itemResponded(r)}
          onunavailable={() => practice.itemUnavailable()}
        />
      {/if}
      {#if view.unavailable}
        <p class="error" role="alert">{PRACTICE_UNAVAILABLE}</p>
        <div class="hb-actions">
          <button type="button" class="hb-btn hb-primary" onclick={() => practice.next()}>{PRACTICE_SKIP_ONE}</button>
        </div>
      {/if}
      {#if view.phase === 'confidence' && view.confidence !== null}
        {#key view.item?.item_id}
          <Confidence floorPct={view.confidence.floorPct} startPct={view.confidence.startPct} optionsCount={view.confidence.optionsCount} onconfirm={(pct) => practice.confirmConfidence(pct)} />
        {/key}
      {/if}
      {#if view.phase === 'feedback' && view.feedback !== null}
        <section class="feedback" tabindex="-1" use:focusMe>
          <p><strong>{view.feedback.correct ? PRACTICE_CORRECT : PRACTICE_INCORRECT}</strong> {PRACTICE_ANSWER} {view.feedback.answer}.</p>
          <div class="hb-actions">
            <button type="button" class="hb-btn hb-primary" onclick={() => practice.next()}>{view.number < view.total ? PRACTICE_NEXT : PRACTICE_DONE}</button>
          </div>
        </section>
      {/if}
      <div class="hb-actions">
        <button type="button" class="hb-btn" onclick={ondone}>{PRACTICE_STOP}</button>
      </div>
    </Screen>
  {/key}
{/if}

<style>
  .feedback:focus {
    outline: none;
  }
</style>
