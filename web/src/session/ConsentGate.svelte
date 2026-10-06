<!--
  Consent and the 18+ gate (ROADMAP M1.15; DESIGN §13 "Consent and age gate"): "I am 18 or older" and
  a terms and privacy summary (three points and a link). Under-18s are blocked and nothing is stored:
  this component never touches storage; the flow records the consent only after `onagree`. The notice link opens
  in this tab: the flow stays mounted under the notice, and "Back" there returns to this screen with the box as
  it was (UX-011).
  The under-18 screen has a quiet way back from a mis-tap (provisional default, UX-REVIEW D24): "I chose this by
  mistake" shows the gate again with its box unticked. It keeps nothing either way, so it does not weaken the
  block; the gate's heading takes focus, as on every new screen.
-->
<script lang="ts">
  import Screen from './Screen.svelte'
  import { BLOCKED_HEADING, BLOCKED_MISTAKE, BLOCKED_TEXT, GATE_AGREE, GATE_CONTINUE, GATE_HEADING, GATE_LINK, GATE_POINTS, GATE_UNCHECKED, GATE_UNDER_18 } from './copy'

  interface Props {
    /** The person confirmed they are 18 or older and agreed (the flow then keeps the consent). */
    readonly onagree: () => void
    /** The person said they are under 18 (the flow keeps nothing). */
    readonly onunder18: () => void
    /** The person chose "I am under 18" by mistake and wants the gate again (the flow shows it; this screen has cleared its box). */
    readonly onmistake?: () => void
    /** Show the blocked screen instead (the under-18 path). */
    readonly blocked?: boolean
    /** The points of the summary; default the static version's (nothing is uploaded). The online version passes its own (ROADMAP M2.7). */
    readonly points?: readonly string[]
  }

  let { onagree, onunder18, onmistake, blocked = false, points = GATE_POINTS }: Props = $props()

  const uid = $props.id()
  let agreed = $state(false)
  let showError = $state(false)

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (!agreed) {
      showError = true
      return
    }
    onagree()
  }

  /** Back to the gate as if it had not been seen: the box unticked, no message. Nothing is stored. */
  function mistake(): void {
    agreed = false
    showError = false
    onmistake?.()
  }
</script>

{#if blocked}
  <Screen title={BLOCKED_HEADING}>
    <p role="status">{BLOCKED_TEXT}</p>
    {#if onmistake !== undefined}
      <p class="mistake"><button type="button" class="again" onclick={mistake}>{BLOCKED_MISTAKE}</button></p>
    {/if}
  </Screen>
{:else}
  <Screen title={GATE_HEADING}>
    <ul class="points">
      {#each points as point (point)}
        <li>{point}</li>
      {/each}
    </ul>
    <p><a class="hb-standalone-link" href="#/privacy">{GATE_LINK}</a></p>
    <form onsubmit={submit} novalidate>
      <div class="check">
        <input id="{uid}-agree" type="checkbox" bind:checked={agreed} aria-describedby={showError && !agreed ? `${uid}-err` : undefined} aria-invalid={showError && !agreed ? 'true' : undefined} />
        <label for="{uid}-agree">{GATE_AGREE}</label>
      </div>
      {#if showError && !agreed}
        <p class="error" id="{uid}-err" role="alert">{GATE_UNCHECKED}</p>
      {/if}
      <div class="hb-actions">
        <button type="submit" class="hb-btn hb-primary">{GATE_CONTINUE}</button>
        <button type="button" class="hb-btn" onclick={onunder18}>{GATE_UNDER_18}</button>
      </div>
    </form>
  </Screen>
{/if}

<style>
  /* A link in looks and a button in kind (it changes the screen, it goes nowhere): quiet, a target of 44 px (UX-016). */
  .again {
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: 0.5rem 0;
    border: 0;
    background: none;
    color: var(--r-accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    touch-action: manipulation;
  }
</style>
