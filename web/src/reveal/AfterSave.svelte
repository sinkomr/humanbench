<!--
  What comes after the save download (DESIGN §10 "download the save file … → share card"; Phase AI
  proposal v2 §3.3; ROADMAP M1.R): two slots that appear only once the save is safe.
  - **Share card** (M1.18, `ShareCard.svelte`): the picture with its skill toggles and exports, then
    a link to the results-talk helper below it. Without a card (this component alone) a placeholder.
  - **Working with AI** (AI.6b `RevealCard`, from the notes module's light barrel `brief/reveal.ts`):
    a link to the "Notes for your AI" builder (AI.5, `slots.ts`), opening in a new tab so the results
    and their save stay where they are, and the results-talk helper (the gated preamble with a copy
    button, and the line that says never to paste the save file). The notes come from the person's
    own choices, never from results.
  Nothing here is drawn on a share card, and no results enter the preamble.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { RevealCard } from '../brief/reveal'
  import { AFTER_HEADING, SHARE_HEADING, SHARE_PLACEHOLDER, SHARE_TALK_LEAD, SHARE_TALK_LINK } from './copy'
  import { NOTES_BUILDER_HREF, TALK_ANCHOR_ID } from './slots'
  import './reveal.css'

  interface Props {
    /** The notes builder's page (default `slots.ts`: `notes.html` under the base path). */
    readonly notesHref?: string
    /** Injectable for tests: put text on the clipboard, true when it worked. Default: the helper's own. */
    readonly copyText?: (text: string) => Promise<boolean>
    /** M1.18's share card, when it exists. */
    readonly shareCard?: Snippet
    /** Replaces the "Working with AI" card as a whole (a demo or test may pass its own). */
    readonly ai?: Snippet
  }

  /**
   * The share card links to the results-talk helper below it (proposal §8, M1.18; R-17.13): the
   * link moves keyboard focus to the helper's card, and the browser scrolls it into view. Without
   * the card (a replacement that lacks the id) the browser's own anchor behaviour is left alone.
   */
  function jumpToTalk(e: MouseEvent): void {
    const target = document.getElementById(TALK_ANCHOR_ID)
    if (target === null) return
    e.preventDefault()
    target.focus()
  }

  let { notesHref = NOTES_BUILDER_HREF, copyText, shareCard, ai }: Props = $props()

  const uid = $props.id()
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
    <p class="talk-link" data-talk-link>{SHARE_TALK_LEAD} <a href="#{TALK_ANCHOR_ID}" onclick={jumpToTalk}>{SHARE_TALK_LINK}</a>.</p>
  </article>

  {#if ai}
    {@render ai()}
  {:else}
    <div class="ai-slot" data-slot="working-with-ai">
      <RevealCard saved={true} {notesHref} copy={copyText} level={3} talkId={TALK_ANCHOR_ID} />
    </div>
  {/if}
</section>

<style>
  .talk-link {
    margin-top: 1rem;
  }
</style>
