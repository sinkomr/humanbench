<!--
  Consent and the 18+ gate (ROADMAP M1.15; DESIGN §13 "Consent and age gate"): "I am 18 or older" and
  a terms and privacy summary (three points and a link). Under-18s are blocked and nothing is stored:
  this component never touches storage; the flow records the consent only after `onagree`.
-->
<script lang="ts">
  import Screen from './Screen.svelte'
  import { BLOCKED_HEADING, BLOCKED_TEXT, GATE_AGREE, GATE_CONTINUE, GATE_HEADING, GATE_LINK, GATE_POINTS, GATE_UNCHECKED, GATE_UNDER_18 } from './copy'

  interface Props {
    /** The person confirmed they are 18 or older and agreed (the flow then keeps the consent). */
    readonly onagree: () => void
    /** The person said they are under 18 (the flow keeps nothing). */
    readonly onunder18: () => void
    /** Show the blocked screen instead (the under-18 path). */
    readonly blocked?: boolean
  }

  let { onagree, onunder18, blocked = false }: Props = $props()

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
</script>

{#if blocked}
  <Screen title={BLOCKED_HEADING}>
    <p role="status">{BLOCKED_TEXT}</p>
  </Screen>
{:else}
  <Screen title={GATE_HEADING}>
    <ul class="points">
      {#each GATE_POINTS as point (point)}
        <li>{point}</li>
      {/each}
    </ul>
    <p><a href="#/privacy" target="_blank" rel="noopener">{GATE_LINK}</a></p>
    <form onsubmit={submit} novalidate>
      <div class="check">
        <input id="{uid}-agree" type="checkbox" bind:checked={agreed} aria-describedby={showError ? `${uid}-err` : undefined} />
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
