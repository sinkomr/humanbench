<script lang="ts">
  /**
   * Dev-only demo of the text multiple-choice renderer (`#/dev/text-mc`; ROADMAP M3.11 phase 1): the
   * renderer of a served text question on made-up payloads (`render/text/demo.ts`), so e2e and axe can test
   * it without a server. The payload goes through the same check as a served one (`textMcSpec`); the page
   * holds no answer key, as for a served question, and only shows which position was chosen.
   * `?item=N` picks the payload. Never in a production build (routes.ts).
   */
  import { untrack } from 'svelte'
  // The shared renderer styles (render.css) come with the app's entry stylesheet; importing them here again splits
  // them into a stylesheet of their own that loads after it (see TextChoiceRenderer.svelte).
  import { optionLetter } from '../render/choice/keys'
  import { DEMO_TEXT_ITEMS, demoTextItem } from '../render/text/demo'
  import { textMcSpec } from '../render/text/spec'
  import TextChoiceRenderer from '../render/text/TextChoiceRenderer.svelte'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  let index = $state(untrack(() => Number(params.get('item') ?? '0') || 0))
  const item = $derived(demoTextItem(index))
  const spec = $derived(textMcSpec({ stem: item.payload.stem, media: item.payload.media ?? null, options: item.payload.options }))
  let chosen = $state<number | null>(null)
  let onset = $state<number | null>(null)

  function another(): void {
    chosen = null
    onset = null
    index = (index + 1) % DEMO_TEXT_ITEMS.length
  }
</script>

<main class="hb-render demo">
  <h1>Text question demo (development only)</h1>
  <p>Made-up questions with no right answer, so the screen can be tried before real ones are served. Nothing is stored or sent.</p>
  <p class="what" data-testid="text-mc-what">{item.item_id}: {item.what}</p>
  {#key index}
    {#if spec !== null}
      <TextChoiceRenderer {spec} onrespond={(i) => (chosen = i)} onshown={(t) => (onset = t)} />
    {/if}
  {/key}
  <p class="hb-sr-only" data-testid="text-mc-onset" data-onset={onset === null ? '' : String(onset)}></p>
  {#if chosen !== null}
    <section class="feedback" aria-labelledby="text-mc-feedback-h" data-testid="text-mc-feedback" data-response={String(chosen)}>
      <h2 id="text-mc-feedback-h">About this demo answer</h2>
      <p data-testid="text-mc-feedback-choice">You chose option {optionLetter(chosen)}. The demo has no answer key.</p>
      <button type="button" class="hb-btn" data-testid="text-mc-another" onclick={another}>Another question</button>
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
  .what {
    color: var(--r-muted);
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
