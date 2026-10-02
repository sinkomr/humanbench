<!--
  Opening a session on the server (ROADMAP M2.7): shown between "Begin" and the first part while the
  server issues the session. If it cannot (no network, a limit, a refusal) the person is told why in
  plain words and can try again, go back, or take the test on this device only: the static fallback
  (M1), where nothing is sent anywhere. Nothing here stores anything.
-->
<script lang="ts">
  import Screen from '../session/Screen.svelte'
  import type { LoadProblem } from './errors'
  import { OPENING_BACK, OPENING_HEADING, OPENING_LOCAL, OPENING_LOCAL_NOTE, OPENING_PROBLEM, OPENING_RETRY, OPENING_TEXT } from './copy'

  interface Props {
    /** Why the server could not start the session, or null while it is being asked. */
    readonly problem: LoadProblem | null
    readonly onretry: () => void
    /** Go on without the server. */
    readonly onlocal: () => void
    readonly onback: () => void
  }

  let { problem, onretry, onlocal, onback }: Props = $props()
</script>

<Screen title={OPENING_HEADING}>
  {#if problem === null}
    <p role="status">{OPENING_TEXT}</p>
  {:else}
    <p role="alert">{OPENING_PROBLEM[problem]}</p>
    <div class="hb-actions">
      {#if problem !== 'ended'}
        <button type="button" class="hb-btn hb-primary" onclick={onretry}>{OPENING_RETRY}</button>
      {/if}
      <button type="button" class="hb-btn" onclick={onlocal}>{OPENING_LOCAL}</button>
      <button type="button" class="hb-btn" onclick={onback}>{OPENING_BACK}</button>
    </div>
    <p class="muted">{OPENING_LOCAL_NOTE}</p>
  {/if}
</Screen>
