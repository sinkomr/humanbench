<!--
  What the server could check about the sessions in a save (ROADMAP M2.7; DESIGN §8 "Tamper evidence and
  the trust tradeoff"; ROADMAP A16): how many sessions the server issued and finds unchanged, and which
  it could not check and why, in plain words. An unchecked session is still the person's: it counts in
  their own results, and the test never uses it. Only the server can tell (it holds the key), so this
  component only reports what it was told. It says nothing about the notes settings except that they do
  not matter here (AI.26: editing them never changes a session).
-->
<script lang="ts">
  import { countStanding, type SessionStanding } from './standing'
  import { VERIFY_HEADING, VERIFY_LOCAL_ONLY, VERIFY_NOTE, VERIFY_REASON, VERIFY_UNAVAILABLE, unverifiedLine, verifiedLine } from './copy'
  import '../reveal/reveal.css'

  interface Props {
    readonly sessions: readonly SessionStanding[]
    /** Show the heading as a panel of the results (default) or as a plain block (the ready screen). */
    readonly panel?: boolean
    /** The timed tasks of the session just taken stay on the device (always true when the session was served). */
    readonly localTasks?: boolean
    /** Heading level of the block (2 under a screen's title). */
    readonly level?: 2 | 3
  }

  let { sessions, panel = true, localTasks = false, level = 2 }: Props = $props()

  const uid = $props.id()
  const counts = $derived(countStanding(sessions))
  const unverified = $derived(sessions.filter((s) => s.standing === 'unverified'))
</script>

{#if sessions.length > 0}
  <section class={{ 'hb-reveal-panel': panel, check: true }} aria-labelledby="{uid}-h" data-section="save-check">
    <svelte:element this={`h${level}`} id="{uid}-h">{VERIFY_HEADING}</svelte:element>
    <ul>
      {#if counts.verified > 0}
        <li data-verified>{verifiedLine(counts.verified)}</li>
      {/if}
      {#if counts.unverified > 0}
        <li data-unverified>{unverifiedLine(counts.unverified)}</li>
      {/if}
      {#if counts.unchecked > 0}
        <li data-unchecked>{VERIFY_UNAVAILABLE}</li>
      {/if}
    </ul>
    {#if unverified.length > 0}
      <details>
        <summary>Which ones</summary>
        <ul>
          {#each unverified as s (s.sessionId)}
            <li>Session of {s.date}: {s.reason === null ? VERIFY_REASON.bad_signature : VERIFY_REASON[s.reason]}.</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if localTasks}
      <p class="note">{VERIFY_LOCAL_ONLY}</p>
    {/if}
    <p class="note">{VERIFY_NOTE}</p>
  </section>
{/if}

<style>
  .note {
    font-size: 0.9375rem;
    color: var(--r-muted);
  }
</style>
