<!-- The honour code (ROADMAP M1.15; DESIGN §13 "Honour code (checkbox at start)"). -->
<script lang="ts">
  import Screen from './Screen.svelte'
  import { HONOUR_AGREE, HONOUR_CONTINUE, HONOUR_HEADING, HONOUR_TEXT, HONOUR_UNCHECKED } from './copy'

  interface Props {
    readonly onagree: () => void
  }

  let { onagree }: Props = $props()

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

<Screen title={HONOUR_HEADING}>
  <p class="lead">{HONOUR_TEXT}</p>
  <form onsubmit={submit} novalidate>
    <div class="check">
      <input id="{uid}-agree" type="checkbox" bind:checked={agreed} aria-describedby={showError && !agreed ? `${uid}-err` : undefined} aria-invalid={showError && !agreed ? 'true' : undefined} />
      <label for="{uid}-agree">{HONOUR_AGREE}</label>
    </div>
    {#if showError && !agreed}
      <p class="error" id="{uid}-err" role="alert">{HONOUR_UNCHECKED}</p>
    {/if}
    <div class="hb-actions">
      <button type="submit" class="hb-btn hb-primary">{HONOUR_CONTINUE}</button>
    </div>
  </form>
</Screen>
