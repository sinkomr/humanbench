<script lang="ts" module>
  let instances = 0
</script>

<script lang="ts">
  /**
   * The profile results view (DESIGN §9, §13; ROADMAP A7, A12, A15, M1.16): the blob, the bar /
   * lollipop table (always in the DOM; the screen-reader default, §9.5 c), a view toggle, and the
   * cluster drill-down to facet estimates (§9.6, A12: ≥ 5 items). Input is the engine's scoreAll
   * output plus, for the drill-down, facet-tagged observations.
   *
   * Nothing here shows a sum, an average or the size of the shape (§9.5 a, CLAUDE.md blob rule).
   */
  import { onMount } from 'svelte'
  import BarTable from './BarTable.svelte'
  import BlobChart from './BlobChart.svelte'
  import { buildBlob, type BlobModel } from './blob'
  import {
    BARS_NOTE,
    BLOB_DESCRIPTION,
    BLOB_TITLE,
    DRILL_PROMPT,
    FACET_EMPTY,
    FACET_GROUP,
    FACET_SKILL,
    facetCaption,
    facetHeading,
    PROFILE_HEADING,
    READING_CAPTION,
    RING_CAPTION,
    STUB_CAPTION,
    TABLE_CAPTION,
    TABLE_CLUSTER,
    TABLE_SKILL,
    TIER_LEGEND,
    UNCERTAINTY_CAPTION,
    VIEW_BARS,
    VIEW_BLOB,
    VIEW_GROUP_LABEL,
  } from './copy'
  import { clusterFacets, type FacetEstimate, type FacetObservation, type FacetOptions } from './facets'
  import { themeVars, THEMES, type ThemeName } from './palette'
  import { axisEstimates, axisSamples, DEFAULT_FUZZ_SEED, independentSamples, N_FUZZ, type ProfileInput } from './profile'
  import type { Cluster } from '../engine/axes'

  interface Props {
    input: ProfileInput
    /** Facet-tagged observations for the drill-down (§9.6). */
    facetObservations?: readonly FacetObservation[]
    /** Known facets per axis, listed even without items. */
    facetCatalog?: FacetOptions['catalog']
    /** Seed of the fuzz draws (§9.3); fixed by default so a profile always looks the same. */
    seed?: string
    /** Colour scheme; default follows prefers-color-scheme. */
    theme?: ThemeName
  }

  let { input, facetObservations = [], facetCatalog, seed = DEFAULT_FUZZ_SEED, theme }: Props = $props()

  const uid = `hb-profile-${++instances}`
  /** Facet sub-blobs need at least 3 spokes and stay legible up to 24. */
  const SUB_BLOB_MIN = 3
  const SUB_BLOB_MAX = 24

  let view = $state<'blob' | 'bars'>('blob')
  let selected = $state<Cluster | null>(null)
  let prefersDark = $state(false)

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    prefersDark = mq.matches
    const on = (e: MediaQueryListEvent): void => {
      prefersDark = e.matches
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  })

  const estimates = $derived(axisEstimates(input))
  const model = $derived(buildBlob(estimates, axisSamples(input, estimates, N_FUZZ, seed)))
  const clusters = $derived([...new Set(estimates.map((e) => e.cluster))])
  const unmeasured = $derived(estimates.filter((e) => !e.measured).map((e) => e.code))
  const facets: FacetEstimate[] = $derived(
    selected === null ? [] : clusterFacets(input.score, facetObservations, selected, { catalog: facetCatalog, unmeasured }),
  )
  const facetModel: BlobModel | null = $derived(
    facets.length >= SUB_BLOB_MIN && facets.length <= SUB_BLOB_MAX ? buildBlob(facets, independentSamples(facets, N_FUZZ, `${seed}/${selected}`)) : null,
  )
  const style = $derived(
    Object.entries(themeVars(THEMES[theme ?? (prefersDark ? 'dark' : 'light')]))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; '),
  )

  function toggleCluster(c: string): void {
    const cluster = clusters.find((x) => x === c) ?? null
    selected = selected === cluster ? null : cluster
  }
</script>

<section class="hb-profile" {style} aria-labelledby="{uid}-heading" data-view={view}>
  <h2 id="{uid}-heading">{PROFILE_HEADING}</h2>

  <div class="toolbar" role="group" aria-label={VIEW_GROUP_LABEL}>
    <button type="button" aria-pressed={view === 'blob'} onclick={() => (view = 'blob')}>{VIEW_BLOB}</button>
    <button type="button" aria-pressed={view === 'bars'} onclick={() => (view = 'bars')}>{VIEW_BARS}</button>
  </div>

  {#if view === 'blob'}
    <figure class="blob-figure">
      <BlobChart {model} uid="{uid}-blob" title={BLOB_TITLE} description={BLOB_DESCRIPTION} onselect={toggleCluster} {selected} />
      <figcaption>
        <p>{RING_CAPTION}</p>
        <p>{UNCERTAINTY_CAPTION}</p>
        <p>{STUB_CAPTION}</p>
        <p>{TIER_LEGEND}</p>
        <p>{READING_CAPTION}</p>
      </figcaption>
    </figure>
  {/if}

  <BarTable rows={estimates} caption={TABLE_CAPTION} skillHeader={TABLE_SKILL} groupHeader={TABLE_CLUSTER} hidden={view === 'blob'} />
  {#if view === 'bars'}
    <p class="note">{BARS_NOTE}</p>
    <p class="note">{TIER_LEGEND}</p>
  {/if}

  <div class="drill" role="group" aria-labelledby="{uid}-drill">
    <p id="{uid}-drill" class="drill-prompt">{DRILL_PROMPT}</p>
    <div class="drill-buttons">
      {#each clusters as c (c)}
        <button type="button" aria-expanded={selected === c} aria-controls="{uid}-facets" onclick={() => toggleCluster(c)}>{c}</button>
      {/each}
    </div>
  </div>

  <div id="{uid}-facets" class="facets">
    {#if selected !== null}
      {#key selected}
        <section class="facet-panel" aria-labelledby="{uid}-facet-heading" data-cluster={selected}>
          <h3 id="{uid}-facet-heading">{facetHeading(selected)}</h3>
          {#if facets.length === 0}
            <p>{FACET_EMPTY}</p>
          {:else}
            {#if facetModel !== null}
              <BlobChart model={facetModel} uid="{uid}-sub" title={facetHeading(selected)} description={facetCaption(selected)} />
            {/if}
            <BarTable rows={facets} caption={facetCaption(selected)} skillHeader={FACET_SKILL} groupHeader={FACET_GROUP} />
          {/if}
        </section>
      {/key}
    {/if}
  </div>
</section>

<style>
  .hb-profile {
    color: var(--hb-text);
    background: var(--hb-bg);
    width: 100%;
    max-width: 52rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    text-align: left;
  }
  h2,
  h3 {
    color: var(--hb-text-strong);
    margin: 0;
  }
  h2 {
    font-size: 1.375rem;
  }
  h3 {
    font-size: 1.125rem;
  }
  .toolbar,
  .drill-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    font: inherit;
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: 0.4rem 0.9rem;
    border-radius: 0.5rem;
    border: 1px solid var(--hb-stub);
    background: var(--hb-bg);
    color: var(--hb-text-strong);
    cursor: pointer;
  }
  button[aria-pressed='true'],
  button[aria-expanded='true'] {
    border-color: var(--hb-blob);
    box-shadow: inset 0 0 0 1px var(--hb-blob);
    font-weight: 600;
  }
  button:focus-visible {
    outline: 3px solid var(--hb-blob);
    outline-offset: 2px;
  }
  figure {
    margin: 0;
  }
  figcaption {
    font-size: 0.875rem;
    max-width: 44rem;
    margin: 0.5rem auto 0;
  }
  figcaption p,
  .note {
    margin: 0.25rem 0;
    font-size: 0.875rem;
  }
  .drill-prompt {
    margin: 0 0 0.5rem;
    font-weight: 600;
    color: var(--hb-text-strong);
  }
  .facet-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--hb-grid);
    border-radius: 0.75rem;
    animation: hb-grow 220ms ease-out;
    transform-origin: top center;
  }
  /* Transform only: fading text would pass through low-contrast colours (§13, axe). */
  @keyframes hb-grow {
    from {
      transform: scale(0.94);
    }
    to {
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .facet-panel {
      animation: none;
    }
  }
</style>
