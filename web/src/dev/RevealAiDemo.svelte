<script lang="ts">
  /**
   * Dev-only demo of the reveal and share-card screens' notes pieces (`#/dev/reveal-ai`; ROADMAP
   * AI.6b): the "Working with AI" card that appears after the save download, and the results-talk
   * helper on the share-card screen. M1.R and M1.18 wire the same components into the real
   * screens; this page lets e2e and axe test them in the renderer look before those exist. Never in
   * a production build (routes.ts). `?screen=share` shows the share-card screen, `?saved=1` starts
   * with the save already downloaded.
   */
  import { untrack } from 'svelte'
  import '../render/common/render.css'
  import { ResultsTalk, RevealCard } from '../brief/reveal'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  const screen = untrack(() => (params.get('screen') === 'share' ? 'share' : 'reveal'))
  let saved = $state(untrack(() => params.get('saved') === '1'))
  const notesHref = `${import.meta.env.BASE_URL}notes.html`
</script>

<main class="hb-render demo">
  <h1>Reveal screens demo (development only)</h1>
  {#if screen === 'reveal'}
    <p>The reveal screen asks for the save download. Only after it does the notes card appear.</p>
    <button type="button" class="hb-btn hb-primary" data-testid="demo-download" onclick={() => (saved = true)}>Download my save (demo)</button>
    <p class="hb-status" role="status" aria-live="polite" data-testid="demo-saved">{saved ? 'Save downloaded.' : ''}</p>
    <RevealCard {saved} {notesHref} />
  {:else}
    <p>The share-card screen shows the card, and offers the same text to paste first.</p>
    <div class="share-card" data-testid="share-card" role="img" aria-label="Share card (demo): a shape and a title">
      <p aria-hidden="true">A shape and a title, and nothing else.</p>
    </div>
    <ResultsTalk level={2} />
  {/if}
</main>

<style>
  .demo {
    box-sizing: border-box;
    max-width: 42rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 2rem;
  }
  .share-card {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 1rem;
    margin: 1rem 0;
    aspect-ratio: 1200 / 630;
    display: grid;
    place-items: center;
  }
</style>
