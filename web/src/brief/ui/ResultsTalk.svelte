<script lang="ts">
  /**
   * "Talking about your results with an AI?" (AI.6b; proposal §3.3, requirement R-17.13): the
   * words-only preamble to paste first, a button that copies it, and the warning never to paste the
   * save file. Meant for the reveal screen (inside `RevealCard`) and the share-card screen (on its
   * own). The preamble is the same for everyone; nothing about the person's results is in it, on
   * the screen or on the clipboard, and nothing is sent or stored.
   *
   * Props:
   * - `copy(text)`: puts text on the clipboard and resolves to whether it worked. Default: the
   *   browser's clipboard, with the text-box fallback WebKit needs (`copyText` in `browser.ts`).
   * - `status`: the gate status of the preamble (default: from the bundled gates file). `blocked`
   *   hides the preamble and its button but keeps the warning; `experimental` adds a badge.
   * - `level`: the heading level of the title (default 3, for use inside a card or a page section).
   */
  import { copyText } from '../browser'
  import { RESULTS_TALK, PREAMBLE } from '../results-talk'
  import { resultsTalkStatus, type ResultsTalkStatus } from '../results-talk-gate'

  interface Props {
    copy?: (text: string) => Promise<boolean>
    status?: ResultsTalkStatus
    level?: 2 | 3 | 4
  }
  let { copy = (t: string) => copyText(t), status = resultsTalkStatus(), level = 3 }: Props = $props()

  const uid = $props.id()
  let message = $state('')

  function selectPreamble(): void {
    const el = document.getElementById(`${uid}-preamble`)
    const sel = window.getSelection()
    if (!el || !sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  async function onCopy(): Promise<void> {
    const ok = await copy(PREAMBLE)
    if (!ok) selectPreamble()
    // Clear first so the same message is announced again on a second press.
    message = ''
    await Promise.resolve()
    message = ok ? RESULTS_TALK.copied : RESULTS_TALK.copyFailed
  }
</script>

<div class="results-talk" data-testid="results-talk">
  <svelte:element this={`h${level}`} id="{uid}-title">{RESULTS_TALK.heading}</svelte:element>
  {#if status !== 'blocked'}
    <p>
      {RESULTS_TALK.paste}
      {#if status === 'experimental'}<span class="badge" data-testid="results-talk-badge">{RESULTS_TALK.experimental}</span>{/if}
    </p>
    <blockquote id="{uid}-preamble" class="preamble" data-testid="preamble">{PREAMBLE}</blockquote>
    <div class="row">
      <button type="button" class="primary hb-btn hb-primary" data-testid="copy-preamble" onclick={() => void onCopy()}>{RESULTS_TALK.copyButton}</button>
    </div>
  {:else}
    <p data-testid="results-talk-blocked">{RESULTS_TALK.blockedNote}</p>
  {/if}
  <p class="warn" data-testid="never-paste">{RESULTS_TALK.neverPaste}</p>
  <p class="status" role="status" aria-live="polite" data-testid="results-talk-status">{message}</p>
</div>

<style>
  /*
   * Self-contained: the helper sits on the notes page (notes.css) and on the reveal and share-card
   * screens (the renderer look, render/common/render.css), so it uses only the app-wide tokens of
   * app.css and gives its own fallbacks for the rest. Text is at least 4.5:1 on its background in
   * light and dark, and the button is at least 2.75rem tall (WCAG 2.2 target size).
   */
  .results-talk {
    --rt-note-bg: #fff4d6;
    --rt-note-text: #4a3500;
    --rt-note-border: #b7791f;
    --rt-quote-bg: #f6f5f8;
    --rt-quote-edge: #55525d;
  }
  @media (prefers-color-scheme: dark) {
    .results-talk {
      --rt-note-bg: #3a2f10;
      --rt-note-text: #ffe7a3;
      --rt-note-border: #b7912f;
      --rt-quote-bg: #1e1d25;
      --rt-quote-edge: #a9a7b3;
    }
  }
  .preamble {
    margin: 0.5rem 0;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-left: 4px solid var(--rt-quote-edge);
    border-radius: 0.375rem;
    background: var(--rt-quote-bg);
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.5rem 0;
  }
  .row button {
    min-height: 2.75rem;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .warn {
    background: var(--rt-note-bg);
    color: var(--rt-note-text);
    border: 1px solid var(--rt-note-border);
    border-radius: 0.5rem;
    padding: 0.6rem 0.9rem;
    margin: 0.75rem 0;
  }
  .badge {
    display: inline-block;
    border: 1px solid var(--rt-quote-edge);
    border-radius: 999px;
    padding: 0 0.55rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-strong);
    white-space: nowrap;
  }
  .status {
    min-height: 1.5rem;
    margin: 0.25rem 0;
    font-weight: 600;
    color: var(--text-strong);
  }
</style>
