<!--
  Closing a session on the server (ROADMAP M2.7): the last answers are sent, the server builds and signs
  the session, and the scores of the served parts are fetched (`rescore`). If the server cannot be
  reached the person can try again, or continue without it: the parts the server scores then show as not
  measured, and the answers stay in the save file. Nothing here stores anything.
-->
<script lang="ts">
  import Screen from '../session/Screen.svelte'
  import { CLOSING_CONTINUE, CLOSING_CONTINUE_NOTE, CLOSING_HEADING, CLOSING_PROBLEM, CLOSING_RETRY, CLOSING_TEXT } from './copy'

  interface Props {
    /** True once a try has failed. */
    readonly failed: boolean
    readonly onretry: () => void
    readonly oncontinue: () => void
  }

  let { failed, onretry, oncontinue }: Props = $props()
</script>

<Screen title={CLOSING_HEADING}>
  {#if !failed}
    <p role="status">{CLOSING_TEXT}</p>
  {:else}
    <p role="alert">{CLOSING_PROBLEM}</p>
    <div class="hb-actions">
      <button type="button" class="hb-btn hb-primary" onclick={onretry}>{CLOSING_RETRY}</button>
      <button type="button" class="hb-btn" onclick={oncontinue}>{CLOSING_CONTINUE}</button>
    </div>
    <p class="muted">{CLOSING_CONTINUE_NOTE}</p>
  {/if}
</Screen>
