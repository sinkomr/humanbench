<!--
  The honour code (ROADMAP M1.15; DESIGN §13 "Honour code (checkbox at start)"): a lead-in that says what
  "your blob" is (provisional default, UX-REVIEW D26), the §13 sentence word for word, then what is and is
  not allowed beside it, said up front (owner decision 2026-10-05, UX-REVIEW D10).
-->
<script lang="ts">
  import Screen from './Screen.svelte'
  import { HONOUR_AGREE, HONOUR_CONTINUE, HONOUR_HEADING, HONOUR_LEAD, HONOUR_TEXT, HONOUR_TOOLS, HONOUR_UNCHECKED } from './copy'

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
  <p>{HONOUR_LEAD}</p>
  <p class="lead">{HONOUR_TEXT}</p>
  <p>{HONOUR_TOOLS}</p>
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
