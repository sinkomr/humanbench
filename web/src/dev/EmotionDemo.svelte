<script lang="ts">
  /**
   * Dev-only demo of the emotion vignette entry (`#/dev/emotion`; ROADMAP M6.1): the renderer on a synthetic
   * practice situation (`tasks/emotion/demo.ts`), so e2e and axe can test it before any finite vignette is
   * served (M2). The renderer is given the spec only; the demo keeps its intended answer here, as the server
   * would, and shows it once an answer arrives. `?seed=N` picks the situation. Never in a production build
   * (routes.ts).
   */
  import { untrack } from 'svelte'
  import '../render/common/render.css'
  import EmotionRenderer from '../render/emotion/EmotionRenderer.svelte'
  import { demoEmotionItem } from '../tasks/emotion/demo'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  let seed = $state(untrack(() => params.get('seed') ?? '1'))
  const item = $derived(demoEmotionItem(seed))
  let chosen = $state<number | null>(null)

  function another(): void {
    chosen = null
    seed = String(Number(seed) + 1)
  }
</script>

<main class="hb-render demo">
  <h1>Emotion reading entry demo (development only)</h1>
  <p>A made-up situation, so the entry can be tried before real ones are served. Nothing is stored or sent.</p>
  {#key seed}
    <EmotionRenderer spec={item.spec} onrespond={(i) => (chosen = i)} />
  {/key}
  {#if chosen !== null}
    <section class="feedback" aria-labelledby="emotion-feedback-h" data-testid="emotion-feedback" data-response={String(chosen)}>
      <h2 id="emotion-feedback-h">About this demo answer</h2>
      <p data-testid="emotion-feedback-choice">You chose {item.spec.options[chosen]}.</p>
      <p data-testid="emotion-feedback-intended">The demo's intended answer: {item.spec.options[item.answer_index]}. {item.explanation}</p>
      <button type="button" class="hb-btn" data-testid="emotion-another" onclick={another}>Another situation</button>
    </section>
  {/if}
</main>

<style>
  .demo {
    box-sizing: border-box;
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 2rem;
  }
  /* The page is a flex item with auto margins (#app), so its width follows its longest word: let the heading break. */
  .demo h1 {
    font-size: 1.5rem;
    overflow-wrap: anywhere;
  }
  .demo p {
    overflow-wrap: anywhere;
  }
  .feedback {
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    padding: 1rem;
    margin: 1.5rem 0 0;
  }
  .feedback h2 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }
</style>
