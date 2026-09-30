<script lang="ts">
  /**
   * The "Working with AI" card for the reveal screen (AI.6b; proposal §3.3, requirement R-17.13): a
   * short line about the notes page and the results-talk preamble. It appears only after the save
   * download (`saved`), because the download is the one required step of the reveal and nothing
   * should compete with it; and it is never part of a share card (`NOTES_LEAK_MARKERS` in
   * `leak-markers.ts` lists what a share card must not contain).
   *
   * Props:
   * - `saved`: true once the required save download has happened. Until then the card renders nothing.
   * - `notesHref`: where the notes page is (the page passes its base path plus `notes.html`). The link opens
   *   in a new tab, so the reveal and its save download stay where they are.
   * - `copy`, `status`: passed to `ResultsTalk` (see there).
   * - `level`: heading level of the card title (default 2); the helper's title is one level lower.
   * - `talkId`: passed to `ResultsTalk` as its `anchorId` (the share card links to the helper by it).
   */
  import { REVEAL_CARD } from '../results-talk'
  import type { ResultsTalkStatus } from '../results-talk-gate'
  import ResultsTalk from './ResultsTalk.svelte'

  interface Props {
    saved: boolean
    notesHref: string
    copy?: (text: string) => Promise<boolean>
    status?: ResultsTalkStatus
    level?: 2 | 3
    talkId?: string
  }
  let { saved, notesHref, copy, status, level = 2, talkId }: Props = $props()

  const uid = $props.id()
  const inner = $derived((level + 1) as 3 | 4)
</script>

{#if saved}
  <section class="card" aria-labelledby="{uid}-title" data-testid="reveal-card">
    <svelte:element this={`h${level}`} id="{uid}-title">{REVEAL_CARD.heading}</svelte:element>
    <p>{REVEAL_CARD.body}</p>
    <p><a href={notesHref} target="_blank" rel="noopener" data-testid="notes-link">{REVEAL_CARD.link}{REVEAL_CARD.newTab}</a></p>
    <ResultsTalk {copy} {status} level={inner} anchorId={talkId} />
  </section>
{/if}

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem 1rem;
    margin: 1.5rem 0;
    background: var(--bg);
    color: var(--text);
    overflow-wrap: anywhere;
  }
</style>
