<script lang="ts">
  /**
   * Dev-only demo of the unusual uses entry (`#/dev/aut`; ROADMAP M6.4, DESIGN §5.4): the renderer on a practice object
   * (`tasks/aut/demo.ts`: a brick or a paperclip), so e2e and axe can test it before any prompt is served. The renderer is
   * given the spec only and does not score; the demo scores the round with a scorer on this device (`tasks/aut/run.ts`).
   * `?seed=N` picks the object (id `demo:aut:N`), `?seconds=N` shortens the round (at least 5, for tests), and
   * `?embedder=mock` uses the test stand-in instead of the model. Without it a button downloads the model (about 25 MB, from
   * Hugging Face, once) and that download is the only request the page ever makes. Nothing is stored. Never in a
   * production build (routes.ts).
   */
  import { onDestroy, untrack } from 'svelte'
  import '../render/common/render.css'
  import AutRenderer from '../render/aut/AutRenderer.svelte'
  import AutResults from '../render/aut/AutResults.svelte'
  import OcsaiConsent from '../render/aut/OcsaiConsent.svelte'
  import { EXPERIMENTAL_NOTE, SCORER_COPY } from '../tasks/aut/copy'
  import { DEMO_NOTE, demoAutItem, parseEmbedderChoice, parseSeconds } from '../tasks/aut/demo'
  import { createMockEmbedder, type Embedder, type LoadProgress } from '../tasks/aut/embedder'
  import { loadMiniLmEmbedder } from '../tasks/aut/minilm'
  import { scoreResponses } from '../tasks/aut/run'
  import type { AutScore } from '../tasks/aut/scoring'
  import { AUT_DEFAULT_SECONDS, type AutResponse } from '../tasks/aut/spec'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  const choice = parseEmbedderChoice(untrack(() => params.get('embedder')))
  const seconds = parseSeconds(untrack(() => params.get('seconds'))) ?? AUT_DEFAULT_SECONDS
  let seed = $state(untrack(() => params.get('seed') ?? '1'))
  const item = $derived(demoAutItem(seed, seconds))

  // The scorer: the test stand-in at once, or the model after a press. Raw state: an embedder is an object with methods.
  let embedder = $state.raw<Embedder | null>(choice === 'mock' ? createMockEmbedder() : null)
  let loading = $state<'idle' | 'loading' | 'failed'>('idle')
  let progress = $state.raw<LoadProgress | null>(null)
  let controller: AbortController | null = null

  async function loadScorer(): Promise<void> {
    if (loading === 'loading' || embedder !== null) return
    loading = 'loading'
    progress = null
    const own = new AbortController()
    controller = own
    try {
      embedder = await loadMiniLmEmbedder({ onProgress: (p) => (progress = p), signal: own.signal })
      loading = 'idle'
    } catch (error) {
      if (own.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      loading = 'failed'
    }
  }

  onDestroy(() => controller?.abort())

  const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(1)
  const preparing = $derived(progress !== null && progress.totalBytes !== null && progress.loadedBytes >= progress.totalBytes)
  const progressText = $derived(
    progress === null ? SCORER_COPY.loading : preparing ? SCORER_COPY.preparing : progress.totalBytes === null ? `${SCORER_COPY.loading}: ${megabytes(progress.loadedBytes)} MB` : `${SCORER_COPY.loading}: ${megabytes(progress.loadedBytes)} of ${megabytes(progress.totalBytes)} MB`,
  )

  // The round and its score: scored as soon as there is both a finished round and a scorer.
  let answer = $state.raw<AutResponse | null>(null)
  let score = $state.raw<AutScore | null>(null)
  let scoring = $state<'idle' | 'busy' | 'failed'>('idle')

  $effect(() => {
    const given = answer
    const scorer = embedder
    const object = item.spec.object
    if (given === null || scorer === null) return
    let stale = false
    untrack(() => (scoring = 'busy'))
    scoreResponses(scorer, object, given.responses).then(
      (s) => {
        if (stale) return
        score = s
        scoring = 'idle'
      },
      () => {
        if (!stale) scoring = 'failed'
      },
    )
    return () => {
      stale = true
    }
  })

  function another(): void {
    answer = null
    score = null
    scoring = 'idle'
    const n = Number(seed)
    seed = String(Number.isSafeInteger(n) ? n + 1 : 1)
  }
</script>

<main class="hb-render demo">
  <h1>Unusual uses entry demo (development only)</h1>
  <p>A practice object, so the entry can be tried before real ones are served. Nothing is stored. The only request this page ever makes is the scorer's download, after you press its button.</p>
  <p data-testid="aut-practice-id">Practice id {item.item_id}</p>
  <p data-testid="aut-practice-note">{DEMO_NOTE}</p>

  {#key seed}
    <AutRenderer spec={item.spec} onrespond={(r) => (answer = r)} />
  {/key}

  {#if answer !== null}
    <section class="panel" aria-labelledby="aut-results-h" data-testid="aut-results">
      <h2 id="aut-results-h">Results</h2>
      {#if score !== null && embedder !== null}
        <AutResults {score} modelId={embedder.modelId} />
      {:else}
        {#if embedder === null}
          <p data-testid="aut-waiting">{SCORER_COPY.waiting}</p>
        {:else if scoring === 'failed'}
          <p class="hb-note" role="alert">{SCORER_COPY.scoringFailed}</p>
        {:else}
          <p data-testid="aut-scoring">{SCORER_COPY.scoring}</p>
        {/if}
        <p class="hb-note" data-testid="aut-experimental">{EXPERIMENTAL_NOTE}</p>
      {/if}
      <div class="hb-actions">
        <button type="button" class="hb-btn" data-testid="aut-another" onclick={another}>Another object</button>
      </div>
    </section>
  {/if}

  <section class="panel" aria-labelledby="aut-scorer-h">
    <h2 id="aut-scorer-h">{SCORER_COPY.heading}</h2>
    <p>{SCORER_COPY.note}</p>
    {#if choice === 'mock'}
      <p data-testid="aut-scorer-state">{SCORER_COPY.mock}</p>
    {:else if embedder !== null}
      <p data-testid="aut-scorer-state">{SCORER_COPY.ready}</p>
    {:else if loading === 'loading'}
      <p id="aut-progress-text" data-testid="aut-scorer-state">{progressText}</p>
      <!-- A bar with no `value` attribute is indeterminate; the attribute cannot be taken away from one that has it, so each is its own element. -->
      {#if progress !== null && progress.totalBytes !== null && !preparing}
        <progress class="bar" aria-labelledby="aut-progress-text" value={progress.loadedBytes} max={progress.totalBytes}></progress>
      {:else}
        <progress class="bar" aria-labelledby="aut-progress-text"></progress>
      {/if}
    {:else}
      {#if loading === 'failed'}
        <p class="hb-note" role="alert" data-testid="aut-scorer-error">{SCORER_COPY.failed}</p>
      {/if}
      <div class="hb-actions">
        <button type="button" class="hb-btn hb-primary" data-testid="aut-load" onclick={loadScorer}>{loading === 'failed' ? SCORER_COPY.retry : SCORER_COPY.load}</button>
      </div>
    {/if}
    <OcsaiConsent />
  </section>
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
  .panel {
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    padding: 1rem;
    margin: 1.5rem 0 0;
  }
  .panel h2 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }
  .bar {
    display: block;
    width: 100%;
    max-width: 24rem;
    height: 1rem;
    accent-color: var(--r-accent);
  }
</style>
