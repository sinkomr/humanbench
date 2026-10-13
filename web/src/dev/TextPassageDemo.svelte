<script lang="ts">
  /**
   * Dev-only demo of the passage screen (`#/dev/text-passage`; ROADMAP M3.11 phase 2): a made-up passage beside
   * (or, on a narrow screen, above) made-up questions about it (`render/text/demo-passage.ts`), so e2e and axe
   * can test the layout without a server. The payload goes through the same check as a served one
   * (`passageSpec`); the page holds no answer key, as for a served question, and only shows which position was
   * chosen. "Next question" moves to the passage's next question and leaves the passage as it is, as the session
   * does. `?item=N` picks the passage, `?q=K` its question. Never in a production build (routes.ts).
   */
  import { untrack } from 'svelte'
  // The shared renderer styles (render.css) come with the app's entry stylesheet; importing them here again splits
  // them into a stylesheet of their own that loads after it (see TextChoiceRenderer.svelte).
  import { optionLetter } from '../render/choice/keys'
  import { PASSAGE_COPY } from '../render/text/copy'
  import { DEMO_PASSAGES, demoPassage, demoPassagePayload } from '../render/text/demo-passage'
  import { passageSpec, passageTextOf } from '../render/text/passage'
  import PassageLayout from '../render/text/PassageLayout.svelte'
  import TextChoiceRenderer from '../render/text/TextChoiceRenderer.svelte'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  let index = $state(untrack(() => Number(params.get('item') ?? '0') || 0))
  let q = $state(untrack(() => Number(params.get('q') ?? '0') || 0))
  const passage = $derived(demoPassage(index))
  const at = $derived(((q % passage.questions.length) + passage.questions.length) % passage.questions.length)
  const spec = $derived(passageSpec(demoPassagePayload(passage, at)))
  let chosen = $state<number | null>(null)
  let onset = $state<number | null>(null)

  function next(): void {
    chosen = null
    onset = null
    if (at + 1 < passage.questions.length) q = at + 1
    else {
      q = 0
      index = (index + 1) % DEMO_PASSAGES.length
    }
  }
</script>

<main class="hb-render demo">
  <h1>Passage question demo (development only)</h1>
  <p>A made-up passage with made-up questions that have no right answer, so the screen can be tried before real ones are served. Nothing is stored or sent.</p>
  <p class="what" data-testid="text-passage-what">{passage.id}: {passage.what}</p>
  {#if spec !== null}
    {#key spec.passageKey}
      <PassageLayout passage={passageTextOf(spec)} regionId="text-passage-region">
        <div class="item-region" role="group" aria-label="Question {at + 1}">
          <p class="position" data-set-position>{PASSAGE_COPY.position(at + 1, passage.questions.length)}</p>
          {#key at}
            <TextChoiceRenderer {spec} onrespond={(i) => (chosen = i)} onshown={(t) => (onset = t)} />
          {/key}
          <p class="hb-sr-only" data-testid="text-passage-onset" data-onset={onset === null ? '' : String(onset)}></p>
          {#if chosen !== null}
            <section class="feedback" aria-labelledby="text-passage-feedback-h" data-testid="text-passage-feedback" data-response={String(chosen)}>
              <h2 id="text-passage-feedback-h">About this demo answer</h2>
              <p data-testid="text-passage-feedback-choice">You chose option {optionLetter(chosen)}. The demo has no answer key.</p>
              <button type="button" class="hb-btn" data-testid="text-passage-next" onclick={next}>Next question</button>
            </section>
          {/if}
        </div>
      </PassageLayout>
    {/key}
  {/if}
</main>

<style>
  .demo {
    box-sizing: border-box;
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 2rem;
    min-width: 0;
  }
  /* The page is a flex item with auto margins (#app), so its width follows its longest word: let the heading break. */
  .demo h1 {
    font-size: 1.5rem;
    overflow-wrap: anywhere;
  }
  .demo p {
    overflow-wrap: anywhere;
  }
  .what,
  .position {
    color: var(--r-muted);
  }
  .position {
    margin: 0 0 0.5rem;
    font-size: 0.875rem;
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
