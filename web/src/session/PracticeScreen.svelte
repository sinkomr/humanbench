<!--
  Practice mode (ROADMAP M1.15; DESIGN §10): a few easy questions with the confidence slider and then
  feedback on the answer. Nothing is counted or stored (`practice.ts`). The feedback (right or not,
  and the answer) appears only after the answer, in this panel and never inside a question.
-->
<script lang="ts">
  import Confidence from './Confidence.svelte'
  import Screen from './Screen.svelte'
  import Stage from './Stage.svelte'
  import type { SessionEnv } from './env'
  import type { PracticeRun, PracticeView } from './practice'
  import {
    PRACTICE_ANSWER,
    PRACTICE_BACK,
    PRACTICE_CORRECT,
    PRACTICE_DONE,
    PRACTICE_DONE_HEADING,
    PRACTICE_DONE_TEXT,
    PRACTICE_HEADING,
    PRACTICE_INCORRECT,
    PRACTICE_INTRO,
    PRACTICE_NEXT,
    PRACTICE_SKIP_ONE,
    PRACTICE_UNAVAILABLE,
  } from './copy'

  interface Props {
    readonly env: SessionEnv
    readonly practice: PracticeRun
    /** Practice ended (finished, or left with Back). */
    readonly ondone: () => void
  }

  let { env, practice, ondone }: Props = $props()

  // The run is fixed for the life of this screen; its changes arrive through subscribe().
  // svelte-ignore state_referenced_locally
  let view: PracticeView = $state.raw(practice.view())
  $effect(() => practice.subscribe(() => (view = practice.view())))
</script>

{#if view.phase === 'done'}
  <Screen title={PRACTICE_DONE_HEADING}>
    <p>{PRACTICE_DONE_TEXT}</p>
    <div class="hb-actions">
      <button type="button" class="hb-btn hb-primary" onclick={ondone}>{PRACTICE_BACK}</button>
    </div>
  </Screen>
{:else}
  <Screen title={PRACTICE_HEADING}>
    <p>{PRACTICE_INTRO}</p>
    <p class="muted" role="status">Practice question {view.number} of {view.total}</p>
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
      <section aria-live="polite" class="feedback">
        <p><strong>{view.feedback.correct ? PRACTICE_CORRECT : PRACTICE_INCORRECT}</strong> {PRACTICE_ANSWER} {view.feedback.answer}.</p>
        <div class="hb-actions">
          <button type="button" class="hb-btn hb-primary" onclick={() => practice.next()}>{view.number < view.total ? PRACTICE_NEXT : PRACTICE_DONE}</button>
        </div>
      </section>
    {/if}
    <div class="hb-actions">
      <button type="button" class="hb-btn" onclick={() => practice.end()}>{PRACTICE_BACK}</button>
    </div>
  </Screen>
{/if}
