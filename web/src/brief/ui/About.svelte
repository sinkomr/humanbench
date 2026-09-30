<script lang="ts">
  /**
   * Below the paste steps: the control-word card, the data-free repo snippet, `for-ai.md`
   * (human documentation, never linked from the notes), and "Remove my notes settings".
   */
  import { CLAIM, COPY, DATA_FREE_SNIPPET } from '../copy'
  import { controlWordCardSvg } from '../card'
  import { forAiMarkdown } from '../forai'
  import type { Keywords } from '../types'

  interface Props {
    keywords: Keywords
    /** Whether the page has a place to keep settings (then removal also clears what was kept). */
    stored: boolean
    /** After the settings were removed, the device still holds a save: offer a fresh download of it (proposal §3.3 "Removing"). */
    freshSave?: boolean
    /** The last thing done in this section, announced politely. */
    status: string
    oncopysnippet: () => void
    ondownloadcard: (svg: string) => void
    ondownloadforai: (text: string) => void
    onremove: () => void
    ondownloadfresh?: () => void
  }
  let { keywords, stored, freshSave = false, status, oncopysnippet, ondownloadcard, ondownloadforai, onremove, ondownloadfresh }: Props = $props()

  const card = $derived(controlWordCardSvg(keywords))
  const forAi = forAiMarkdown()
</script>

<section aria-labelledby="step-more">
  <h2 id="step-more">More</h2>

  {#if card !== null}
    <h3>Words you can say</h3>
    <p>A card to screenshot, so you remember the words your notes teach the assistant.</p>
    <figure data-testid="card">
      <!-- The SVG is built from a fixed list of words and meanings (card.ts); nothing typed by the person is in it. -->
      {@html card}
    </figure>
    <button type="button" onclick={() => ondownloadcard(card)}>Download the card (SVG)</button>
  {/if}

  <h3>For a team repository</h3>
  <p>To let coding agents honour personal notes without any personal information entering git, a repository can carry this data-free snippet. It contains no information about anyone.</p>
  <pre data-testid="snippet">{DATA_FREE_SNIPPET}</pre>
  <div class="row"><button type="button" onclick={oncopysnippet}>Copy the snippet</button></div>

  <h3>How the notes work</h3>
  <p>The three explanation settings behind the topic lines, and what each mode does with each. This is documentation for people. The notes never link to it.</p>
  <details>
    <summary>Read for-ai.md</summary>
    <pre data-testid="for-ai">{forAi}</pre>
  </details>
  <div class="row"><button type="button" onclick={() => ondownloadforai(forAi)}>Download for-ai.md</button></div>

  <h3>Start over</h3>
  <p data-testid="remove-text">{stored ? COPY.remove : COPY.removeStorageless}</p>
  <button type="button" onclick={onremove}>Remove my notes settings</button>
  {#if freshSave}
    <div class="row">
      <button type="button" data-testid="download-fresh" onclick={ondownloadfresh}>{COPY.removeFresh}</button>
    </div>
  {/if}
  <p class="status" role="status" aria-live="polite" data-testid="more-status">{status}</p>
  <p class="hint">{CLAIM}</p>
</section>

<style>
  figure {
    margin: 0.75rem 0;
  }
  .status {
    min-height: 1.5rem;
    font-weight: 600;
    color: var(--text-strong);
  }
  figure :global(svg) {
    max-width: 100%;
    height: auto;
  }
</style>
