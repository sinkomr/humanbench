<!--
  What comes after the save download (DESIGN §10 "download the save file … → share card"; Phase AI
  proposal v2 §3.3; ROADMAP M1.R): three slots that appear only once the save is safe.
  - **Share card** (M1.18 fills it): a slot with a placeholder until the card exists.
  - **Notes for your AI** (AI.5): a link to the builder route when there is one (`slots.ts`), else a
    placeholder. The notes come from the person's own choices, never from results.
  - **Talking about your results with an AI** (AI.6b): the 340-character preamble with a copy button,
    and the line that says never to paste the save file.
  Nothing here is drawn on a share card, and no results enter the preamble.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    AFTER_HEADING,
    NOTES_HEADING,
    NOTES_LINK,
    NOTES_SOON,
    NOTES_TEXT,
    SHARE_HEADING,
    SHARE_PLACEHOLDER,
    TALK_COPIED,
    TALK_COPY,
    TALK_COPY_FAILED,
    TALK_HEADING,
    TALK_PREAMBLE,
    TALK_TEXT,
  } from './copy'
  import { NOTES_BUILDER_HREF } from './slots'
  import './reveal.css'

  interface Props {
    /** The notes builder's route, or null while there is none (default `slots.ts`). */
    readonly notesHref?: string | null
    /** Injectable for tests: put text on the clipboard, true when it worked. */
    readonly copyText?: (text: string) => Promise<boolean>
    /** M1.18's share card, when it exists. */
    readonly shareCard?: Snippet
    /**
     * Replaces the two AI cards below (the notes card and the results-talk helper) as a whole. This
     * is where the notes module's own `RevealCard` (AI.6b) goes once that module is merged; the
     * cards here are the placeholders until then.
     */
    readonly ai?: Snippet
  }

  async function clipboardCopy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  let { notesHref = NOTES_BUILDER_HREF, copyText = clipboardCopy, shareCard, ai }: Props = $props()

  const uid = $props.id()
  let talkMessage = $state('')

  async function copyPreamble(): Promise<void> {
    talkMessage = (await copyText(TALK_PREAMBLE)) ? TALK_COPIED : TALK_COPY_FAILED
  }
</script>

<section class="hb-reveal-panel after" aria-labelledby="{uid}-h" data-section="after-save">
  <h2 id="{uid}-h">{AFTER_HEADING}</h2>

  <article class="hb-reveal-card" data-slot="share-card" aria-labelledby="{uid}-share">
    <h3 id="{uid}-share">{SHARE_HEADING}</h3>
    {#if shareCard}
      {@render shareCard()}
    {:else}
      <p>{SHARE_PLACEHOLDER}</p>
    {/if}
  </article>

  {#if ai}
    {@render ai()}
  {:else}
  <article class="hb-reveal-card" data-slot="notes-for-ai" aria-labelledby="{uid}-notes">
    <h3 id="{uid}-notes">{NOTES_HEADING}</h3>
    <p>{NOTES_TEXT}</p>
    {#if notesHref}
      <p><a class="hb-btn" href={notesHref}>{NOTES_LINK}</a></p>
    {:else}
      <p class="muted" data-placeholder>{NOTES_SOON}</p>
    {/if}
  </article>

  <article class="hb-reveal-card" data-slot="results-talk" aria-labelledby="{uid}-talk">
    <h3 id="{uid}-talk">{TALK_HEADING}</h3>
    <p>{TALK_TEXT}</p>
    <p class="preamble" id="{uid}-preamble">{TALK_PREAMBLE}</p>
    <div class="hb-actions">
      <button type="button" class="hb-btn" aria-describedby="{uid}-preamble" onclick={() => void copyPreamble()}>{TALK_COPY}</button>
    </div>
    <p class="hb-status" role="status">{talkMessage}</p>
  </article>
  {/if}
</section>

<style>
  .preamble {
    margin: 0 0 0.5rem;
    padding: 0.5rem 0.75rem;
    border-left: 4px solid var(--r-border);
    background: var(--r-bg);
  }
  a.hb-btn {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
</style>
