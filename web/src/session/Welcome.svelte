<!--
  The first screen (ROADMAP M1.15; DESIGN §10, §13). This screen reads and writes nothing itself: the flow
  decides what a returning visitor is shown (below), and the 18+ gate comes next.
  On the first load focus stays where the browser put it; when the person comes back here ("Back to the start")
  the heading takes focus like on every other screen (`focus`, UX-006).
  A browser that already holds HumanBench data gets one more row under Start (provisional default, UX-REVIEW
  D22): "See my results" (the ready screen's way to the earlier results without a new session, UX-010) and,
  when notes settings are kept, "Notes for your AI". A first visit sees what it always saw, and Start stays the
  one primary button. Whether the row is shown is the flow's decision (`returning`, `returning.ts`).
-->
<script lang="ts">
  import { NOTES_BUILDER_HREF } from '../reveal/slots'
  import Screen from './Screen.svelte'
  import { NEW_TAB, PRIVACY_LINK, READY_SHOW_RESULTS, WELCOME_HEADING, WELCOME_INTRO, WELCOME_NOTES, WELCOME_RETURNING_LABEL, WELCOME_START, WELCOME_TAGLINE } from './copy'
  import type { Returning } from './returning'

  interface Props {
    readonly onstart: () => void
    /** Move focus to the heading (a return to this screen); default false (the first screen of a page load). */
    readonly focus?: boolean
    /** What this browser holds, when the row is to be shown; null or absent for a first visit. */
    readonly returning?: Returning | null
    /** "See my results": the flow shows the 18+ gate first when the consent kept here is not for the current terms. */
    readonly onresults?: () => void
    /** The notes builder's page (default `slots.ts`: `notes.html` under the base path). */
    readonly notesHref?: string
  }

  let { onstart, focus = false, returning = null, onresults, notesHref = NOTES_BUILDER_HREF }: Props = $props()

  const showResults = $derived(returning !== null && returning.results && onresults !== undefined)
  const showNotes = $derived(returning !== null && returning.notes)
</script>

<Screen title={WELCOME_HEADING} {focus} translate="no">
  <p class="lead">{WELCOME_TAGLINE}</p>
  <p>{WELCOME_INTRO}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={onstart}>{WELCOME_START}</button>
  </div>
  {#if showResults || showNotes}
    <div class="returning" role="group" aria-label={WELCOME_RETURNING_LABEL} data-testid="welcome-returning">
      {#if showResults}
        <button type="button" class="hb-btn" onclick={onresults}>{READY_SHOW_RESULTS}</button>
      {/if}
      {#if showNotes}
        <a class="hb-standalone-link notes" href={notesHref} target="_blank" rel="noopener" data-testid="welcome-notes">{WELCOME_NOTES}{NEW_TAB}</a>
      {/if}
    </div>
  {/if}
  <p class="privacy"><a class="hb-standalone-link" href="#/privacy">{PRIVACY_LINK}</a></p>
</Screen>

<style>
  /* Under Start, not beside it: one primary button. The row wraps on a narrow window or with large text. */
  .returning {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 1.25rem;
    margin: 0 0 0.5rem;
  }

  /* Its own line, clear of Start, and a target of 44 px (UX-016). */
  .privacy {
    margin-top: 1rem;
  }

  .privacy a,
  .notes {
    display: inline-block;
    padding: 0.625rem 0;
  }
</style>
