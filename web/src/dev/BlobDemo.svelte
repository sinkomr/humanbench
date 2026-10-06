<script lang="ts">
  /**
   * Dev-only blob demo (`#/dev/blob?profile=<id>`; ROADMAP M1.16): the profile view on synthetic
   * profiles scored by the real engine, for e2e, axe and render timing. Never in a production
   * build (routes.ts). `data-render-ms` on <main> is the last render time (M1.16 bench) and
   * `data-render-seq` counts finished renders, so a test can wait for the next one (two renders
   * can take the same time: Chromium rounds performance.now() to 0.1 ms).
   */
  import { onMount, tick, untrack } from 'svelte'
  import { DISCLAIMER } from '../copy'
  import ProfileView from '../viz/ProfileView.svelte'
  import { SYNTHETIC_PROFILES, syntheticProfile } from '../viz/synthetic'
  import type { DevRouteProps } from './routes'

  let { params }: DevRouteProps = $props()

  const t0 = performance.now()
  // The URL picks the first profile once; the buttons switch after that.
  const first = untrack(() => syntheticProfile(params.get('profile') ?? '')) ?? SYNTHETIC_PROFILES[0]!
  let profileId = $state(first.id)
  let renderMs = $state<number | null>(null)
  let renderSeq = $state(0)
  const profile = $derived(syntheticProfile(profileId) ?? first)

  onMount(() => {
    document.title = 'HumanBench — blob demo (development only)'
    renderMs = performance.now() - t0
    renderSeq += 1
  })

  async function choose(id: string): Promise<void> {
    const start = performance.now()
    profileId = id
    await tick()
    renderMs = performance.now() - start
    renderSeq += 1
  }
</script>

<main data-render-ms={renderMs === null ? undefined : renderMs.toFixed(2)} data-render-seq={renderSeq}>
  <h1>Blob demo (development only)</h1>
  <p class="intro">Synthetic profiles scored by the engine, for tests. These are not anyone's results.</p>
  <div class="profiles" role="group" aria-label="Synthetic profile">
    {#each SYNTHETIC_PROFILES as p (p.id)}
      <button type="button" aria-pressed={profileId === p.id} data-profile={p.id} onclick={() => choose(p.id)}>{p.label}</button>
    {/each}
  </div>
  {#key profile.id}
    <ProfileView input={profile.input} facetObservations={profile.facetObservations} facetCatalog={profile.catalog} />
  {/key}
</main>

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
</footer>

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem 1rem 3rem;
    max-width: 56rem;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  h1 {
    margin: 0;
    font-size: 1.75rem;
    color: var(--text-strong);
    /* At 200% text in a wide font "(development" is wider than a phone: it breaks rather than scrolls the page (WCAG 1.4.10). */
    overflow-wrap: anywhere;
  }
  .intro {
    margin: 0;
  }
  .profiles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    font: inherit;
    min-height: 2.75rem;
    padding: 0.4rem 0.9rem;
    border-radius: 0.5rem;
    border: 1px solid var(--text);
    background: var(--bg);
    color: var(--text-strong);
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    font-weight: 600;
    box-shadow: inset 0 0 0 2px var(--text-strong);
  }
  footer {
    border-top: 1px solid var(--border);
    padding: 1rem;
    text-align: center;
  }
  .disclaimer {
    margin: 0 auto;
    max-width: 40rem;
    font-size: 0.875rem;
  }
</style>
