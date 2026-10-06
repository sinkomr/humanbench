<script lang="ts">
  /**
   * Dev-only demo of the word links entry (`#/dev/rat`; ROADMAP M6.3): the renderer on a synthetic practice puzzle
   * (`tasks/rat/demo.ts`), so e2e and axe can test it before any finite puzzle is served (M2). The renderer is given the
   * spec only; the demo keeps its accepted word here, as the server would, and shows it once an answer arrives, with the
   * check of `tasks/rat/answers.ts` (`matches`). `?seed=N` picks the puzzle (id `demo:rat:N`). Nothing is stored or
   * sent. Never in a production build (routes.ts).
   */
  import { untrack } from 'svelte'
  import '../render/common/render.css'
  import RatRenderer from '../render/rat/RatRenderer.svelte'
  import { matches } from '../tasks/rat/answers'
  import { DEMO_NOTE, demoRatItem } from '../tasks/rat/demo'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  let seed = $state(untrack(() => params.get('seed') ?? '1'))
  const item = $derived(demoRatItem(seed))
  let typed = $state<string | null>(null)

  function another(): void {
    typed = null
    const n = Number(seed)
    seed = String(Number.isSafeInteger(n) ? n + 1 : 1)
  }
</script>

<main class="hb-render demo">
  <h1>Word links entry demo (development only)</h1>
  <p>A made-up practice puzzle, so the entry can be tried before real ones are served. Nothing is stored or sent.</p>
  <p data-testid="rat-practice-id">Practice id {item.item_id}</p>
  <p data-testid="rat-practice-note">{DEMO_NOTE}</p>
  {#key seed}
    <RatRenderer spec={item.spec} onrespond={(text) => (typed = text)} />
  {/key}
  {#if typed !== null}
    {@const isMatch = matches(typed, item.accept)}
    <section class="feedback" aria-labelledby="rat-feedback-h" data-testid="rat-feedback" data-response={typed} data-match={String(isMatch)}>
      <h2 id="rat-feedback-h">About this demo answer</h2>
      <p data-testid="rat-feedback-typed">You typed “{typed}”. {isMatch ? 'It matches' : 'It does not match'} the demo's word.</p>
      <p data-testid="rat-feedback-word">The demo's word: {item.word}. {item.compounds.join(', ')}.</p>
      <button type="button" class="hb-btn" data-testid="rat-another" onclick={another}>Another puzzle</button>
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
