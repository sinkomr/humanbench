<script lang="ts">
  /**
   * Dev-only demo of the Fermi entry (`#/dev/fermi`; ROADMAP M5.1): the magnitude + unit entry with its
   * 80% range on a synthetic question (`tasks/fermi/demo.ts`), so e2e and axe can test it before any
   * finite Fermi item is served (M2). The renderer is given the spec only; the demo keeps the truth here,
   * as the server would, scores the response when it arrives and shows what the results screen will:
   * how far off the best guess was, and whether the range held the answer. `?seed=N` picks the question.
   * Never in a production build (routes.ts).
   */
  import { untrack } from 'svelte'
  import '../render/common/render.css'
  import FermiRenderer from '../render/fermi/FermiRenderer.svelte'
  import { demoFermiItem } from '../tasks/fermi/demo'
  import { formatMagnitude } from '../tasks/fermi/magnitude'
  import { scoreFermi, type FermiResponse, type FermiScore } from '../tasks/fermi/scoring'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  let seed = $state(untrack(() => params.get('seed') ?? '1'))
  const item = $derived(demoFermiItem(seed))
  let answered = $state<{ response: FermiResponse; score: FermiScore } | null>(null)

  function onrespond(response: FermiResponse): void {
    answered = { response, score: scoreFermi(response, item.truth) }
  }

  function another(): void {
    answered = null
    seed = String(Number(seed) + 1)
  }

  const factorText = (f: number): string => (f < 10 ? f.toFixed(2) : f.toPrecision(2))
</script>

<main class="hb-render demo">
  <h1>Estimation entry demo (development only)</h1>
  <p>A made-up question, so the entry can be tried before real questions are served. Nothing is stored or sent.</p>
  {#key seed}
    <FermiRenderer spec={item.spec} {onrespond} />
  {/key}
  {#if answered}
    {@const s = answered.score}
    <section class="feedback" aria-labelledby="fermi-feedback-h" data-testid="fermi-feedback" data-response={JSON.stringify(answered.response)} data-hit={String(s.hit)}>
      <h2 id="fermi-feedback-h">About your answer</h2>
      <p data-testid="fermi-feedback-error">Your best guess was within a factor of {factorText(s.factor)} of the answer.</p>
      <p data-testid="fermi-feedback-range">
        {#if s.hit}
          Your 80% range held the answer.
        {:else if s.low_error_dex > 0}
          Your 80% range did not hold the answer: it was lower than your range.
        {:else}
          Your 80% range did not hold the answer: it was higher than your range.
        {/if}
      </p>
      <p data-testid="fermi-feedback-truth">The answer: {formatMagnitude(Number(item.truth.true_value))} {item.truth.unit}. {item.explanation}</p>
      <button type="button" class="hb-btn" data-testid="fermi-another" onclick={another}>Another question</button>
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
