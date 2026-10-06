<script lang="ts">
  /**
   * Dev-only demo of the situational judgment entry (`#/dev/sjt`; ROADMAP M6.2): the renderer on a synthetic practice
   * situation (`tasks/sjt/demo.ts`), so e2e and axe can test it before any finite situation is served. The renderer is
   * given the spec only; the demo keeps its own ratings here, as the server would keep a key, and shows how close an
   * answer is to them once it arrives (`tasks/sjt/scoring.ts`, the formulas of the bank's `hb.sjt.scoring`).
   * `?seed=N` picks the situation (id `demo:sjt:N`), `?mode=most_least` asks for the best and the least effective
   * response instead of a rating for each. Nothing is stored or sent. Never in a production build (routes.ts).
   */
  import { untrack } from 'svelte'
  import '../render/common/render.css'
  import { optionLetter } from '../render/choice/keys'
  import SjtRenderer from '../render/sjt/SjtRenderer.svelte'
  import { SCALE_LABELS } from '../tasks/sjt/copy'
  import { demoSjtItem } from '../tasks/sjt/demo'
  import { mostLeastScore, ratingScore } from '../tasks/sjt/scoring'
  import { isSjtRatings, type SjtMode, type SjtResponse } from '../tasks/sjt/spec'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  let seed = $state(untrack(() => params.get('seed') ?? '1'))
  const mode: SjtMode = $derived(params.get('mode') === 'most_least' ? 'most_least' : 'rate')
  const item = $derived(demoSjtItem(seed))
  let response = $state<SjtResponse | null>(null)

  /** How close the answer is to the demo's ratings, from 0 to 1. */
  const closeness = $derived(
    response === null ? null : isSjtRatings(response) ? ratingScore(response, item.ratings) : mostLeastScore(response.most, response.least, item.ratings),
  )
  const recorded = $derived(response === null ? '' : isSjtRatings(response) ? response.join(',') : `most=${response.most},least=${response.least}`)

  function mine(r: SjtResponse, i: number): string {
    if (isSjtRatings(r)) return `Your rating: ${r[i]} (${SCALE_LABELS[(r[i] as number) - 1]}).`
    return r.most === i ? 'You chose it as the one that would work best.' : r.least === i ? 'You chose it as the one that would work least well.' : 'You did not choose it.'
  }

  function another(): void {
    response = null
    const n = Number.parseInt(seed, 10)
    seed = String((Number.isSafeInteger(n) ? n : 0) + 1)
  }
</script>

<main class="hb-render demo">
  <h1>Situational judgment entry demo (development only)</h1>
  <p>A made-up practice item, so the entry can be tried before real ones are served. Nothing is stored or sent.</p>
  <p data-testid="sjt-practice-id">Practice id {item.item_id}</p>
  {#key seed}
    <SjtRenderer spec={item.spec} {mode} onrespond={(r) => (response = r)} />
  {/key}
  {#if response !== null && closeness !== null}
    <section class="feedback" aria-labelledby="sjt-feedback-h" data-testid="sjt-feedback" data-response={recorded} data-closeness={String(closeness)}>
      <h2 id="sjt-feedback-h">About this demo answer</h2>
      <p data-testid="sjt-feedback-closeness">Closeness to the demo's ratings: {closeness.toFixed(2)} of 1</p>
      <p>{item.explanation} The ratings come from this page, not from any real key.</p>
      <ul class="compare">
        {#each item.spec.responses as text, i (i)}
          <li data-testid="sjt-feedback-row">
            <span class="what">{optionLetter(i)}. {text}</span>
            <span class="nums">{mine(response, i)} The demo's rating: {item.ratings[i]}.</span>
          </li>
        {/each}
      </ul>
      <button type="button" class="hb-btn" data-testid="sjt-another" onclick={another}>Another situation</button>
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
  .compare {
    margin: 0 0 1rem;
    padding: 0;
    list-style: none;
  }
  .compare li {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--r-border);
    overflow-wrap: anywhere;
  }
  .what {
    font-weight: 600;
  }
  .nums {
    color: var(--r-muted);
  }
</style>
