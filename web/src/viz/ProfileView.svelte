<script lang="ts" module>
  import { canvasTextMeasure } from './measure'
  import type { TextMeasure } from './blob'

  let instances = 0
  let pageMeasure: TextMeasure | null | undefined

  /** Canvas text widths in the page font, made once (only after real layout: jsdom has no canvas). */
  function textMeasure(): TextMeasure | undefined {
    if (pageMeasure === undefined) pageMeasure = canvasTextMeasure(getComputedStyle(document.body).fontFamily)
    return pageMeasure ?? undefined
  }
</script>

<script lang="ts">
  /**
   * The profile results view (DESIGN §9, §13; ROADMAP A7, A12, A15, M1.16): the blob, the bar /
   * lollipop table (always in the DOM; the screen-reader default, §9.5 c), a view toggle, and the
   * cluster drill-down to facet estimates (§9.6, A12: ≥ 5 items). Input is the engine's scoreAll
   * output plus, for the drill-down, facet-tagged observations.
   *
   * DOM order puts the table before the blob, so a screen reader meets the data first (§9.5 c);
   * the blob is one image. Each chart's text layout is fitted to its rendered width (`fitLayout`).
   *
   * The text follows the page's text size (UX-044): the root font size reaches `fitLayout`, and when
   * the labels cannot keep up the page points to the bar view. A click on a wedge brings the facet
   * panel into view (UX-046); the facet chart is drawn only from three measured facets, and a
   * cluster with none says so in a line (UX-041).
   *
   * Nothing here shows a sum, an average or the size of the shape (§9.5 a, CLAUDE.md blob rule).
   */
  import { onMount, tick, type Snippet } from 'svelte'
  import BarTable from './BarTable.svelte'
  import BlobChart from './BlobChart.svelte'
  import { buildBlob, fitLayoutDetailed, type BlobModel } from './blob'
  import {
    BARS_NOTE,
    BLOB_DESCRIPTION,
    BLOB_TITLE,
    DRILL_PROMPT,
    FACET_EMPTY,
    FACET_GROUP,
    FACET_SKILL,
    facetCaption,
    HATCH_CAPTION,
    facetHeading,
    facetNone,
    LARGE_TEXT_HINT,
    OFF_SCALE_BARS_NOTE,
    OFF_SCALE_CAPTION,
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
  import { clusterFacets, unmeasuredReasons, type FacetEstimate, type FacetObservation, type FacetOptions } from './facets'
  import { themeVars, THEMES, type ThemeName } from './palette'
  import { axisEstimates, type AxisEstimate, type ProfileInput } from './profile'
  import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../copy'
  import { widthOf } from './width'
  import type { Cluster } from '../engine/axes'

  interface Props {
    input: ProfileInput
    /** Facet-tagged observations for the drill-down (§9.6). */
    facetObservations?: readonly FacetObservation[]
    /** Known facets per axis, listed even without items. */
    facetCatalog?: FacetOptions['catalog']
    /** Facet estimates that arrive computed (the server's, M2.7). */
    facetPrecomputed?: FacetOptions['precomputed']
    /** Colour scheme; default follows prefers-color-scheme. */
    theme?: ThemeName
    /**
     * Maps the final estimates to what the BLOB draws (the reveal's build-up frames, M1.R). The
     * table, the drill-down and the text layout always use the final estimates; without this the
     * blob draws them too.
     */
    display?: (estimates: AxisEstimate[]) => AxisEstimate[]
    /** Drawn under the chart and above the cluster drill-down (the reveal's distinctive peaks, M1.R). */
    between?: Snippet
  }

  let { input, facetObservations = [], facetCatalog, facetPrecomputed, theme, display, between }: Props = $props()

  const uid = `hb-profile-${++instances}`
  /** Facet sub-blobs need at least 3 spokes and stay legible up to 24. */
  const SUB_BLOB_MIN = 3
  const SUB_BLOB_MAX = 24

  /** Spokes of a facet chart that is worth drawing: fewer measured facets are read from the table alone. */
  const SUB_BLOB_MIN_MEASURED = 3

  let view = $state<'blob' | 'bars'>('blob')
  let selected = $state<Cluster | null>(null)
  let prefersDark = $state(false)
  /**
   * Rendered widths of the two chart boxes (0 before layout and in jsdom: default text layout),
   * reported a frame after each resize (`width.ts`: no ResizeObserver loop in WebKit).
   */
  let blobWidth = $state(0)
  let subWidth = $state(0)
  /** The page's root font size in CSS px (16 until measured; jsdom never measures): follows the person's text size. */
  let rootPx = $state(16)

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return
    // Screen only: when the page is printed the query stops matching, and the chart takes the light palette (UX-047).
    const mq = window.matchMedia('screen and (prefers-color-scheme: dark)')
    prefersDark = mq.matches
    const on = (e: MediaQueryListEvent): void => {
      prefersDark = e.matches
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  })

  const estimates = $derived(axisEstimates(input))
  // Once any chart on the page has laid out, later mounts measure from their first frame.
  const measure = $derived(blobWidth > 0 || subWidth > 0 ? textMeasure() : (pageMeasure ?? undefined))
  const fit = $derived(fitLayoutDetailed(estimates, blobWidth, { measure, rootPx }))
  const layout = $derived(fit.layout)
  /** Enlarged text and labels that cannot keep up with it: say where the same data is readable (UX-044). */
  const largeTextHint = $derived(view === 'blob' && rootPx > 16.5 && blobWidth > 0 && !fit.legible)
  /**
   * What the blob draws: the final estimates, or a build-up frame (M1.R). A frame grows a spoke from
   * the centre, so its own off-scale mark would show on every spoke still to come; a spoke keeps the
   * mark only when the frame and the final estimate agree (UX-037).
   */
  const drawn = $derived.by((): AxisEstimate[] => {
    if (display === undefined) return estimates
    return display(estimates).map((e, i) => (e.measured && e.offScale !== estimates[i]?.offScale ? { ...e, offScale: 'none' as const } : e))
  })
  const model = $derived(buildBlob(drawn, { layout, measure }))
  const anyOffScale = $derived(model.spokes.some((s) => s.offScale !== undefined))
  const anyOffScaleFinal = $derived(estimates.some((e) => e.measured && e.offScale !== undefined && e.offScale !== 'none'))
  const clusters = $derived([...new Set(estimates.map((e) => e.cluster))])
  const unmeasured = $derived(unmeasuredReasons(estimates))
  /**
   * R-5.6.2: Emotion Reading is named with its tooltip wherever it is shown with a score. A tooltip does not reach
   * a screen reader or a touch screen reliably in a chart or a table row, so the sentence is printed under the figure
   * (in both views) and the table's row header points to it (`aria-describedby`).
   */
  const emoMeasured = $derived(estimates.some((e) => e.code === 'EMO' && e.measured))
  const emoNote = $derived(emoMeasured ? { EMO: `${uid}-note-EMO` } : undefined)
  const facets: FacetEstimate[] = $derived(
    selected === null ? [] : clusterFacets(input.score, facetObservations, selected, { catalog: facetCatalog, unmeasured, precomputed: facetPrecomputed }),
  )
  const measuredFacets = $derived(facets.filter((f) => f.measured).length)
  /** No facet has an estimate and each lacks only answers: one line and the names, not a table of the same stub (UX-041). */
  const noneYet = $derived(facets.length > 0 && facets.every((f) => f.reason === 'insufficient_data'))
  const facetModel: BlobModel | null = $derived(
    facets.length >= SUB_BLOB_MIN && facets.length <= SUB_BLOB_MAX && measuredFacets >= SUB_BLOB_MIN_MEASURED
      ? buildBlob(facets, { layout: fitLayoutDetailed(facets, subWidth, { measure, rootPx }).layout, measure })
      : null,
  )
  const style = $derived(
    Object.entries(themeVars(THEMES[theme ?? (prefersDark ? 'dark' : 'light')]))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; '),
  )

  /**
   * Open or close a cluster's facets. Opened from the chart (a click on a wedge), the panel is
   * ~700 px further down, so it is scrolled into view and its heading takes focus (UX-046); the
   * cluster buttons sit beside the panel and behave as before.
   */
  async function toggleCluster(c: string, fromChart = false): Promise<void> {
    const cluster = clusters.find((x) => x === c) ?? null
    const opening = cluster !== null && selected !== cluster
    selected = selected === cluster ? null : cluster
    if (!fromChart || !opening) return
    await tick()
    const heading = document.getElementById(`${uid}-facet-heading`)
    if (heading === null) return
    heading.focus({ preventScroll: true })
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const panel = heading.closest('.facet-panel') ?? heading
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })
  }
</script>

<section class="hb-profile" {style} aria-labelledby="{uid}-heading" data-view={view}>
  <h2 id="{uid}-heading">{PROFILE_HEADING}</h2>
  <!-- One rem wide: its width is the page's text size (a text-only zoom changes it, not the chart's width). -->
  <span class="rem" aria-hidden="true" {@attach widthOf((w) => (rootPx = w > 0 ? w : 16))}></span>

  <div class="toolbar-row">
    <div class="toolbar" role="group" aria-label={VIEW_GROUP_LABEL}>
      <button type="button" aria-pressed={view === 'blob'} onclick={() => (view = 'blob')}>{VIEW_BLOB}</button>
      <button type="button" aria-pressed={view === 'bars'} onclick={() => (view = 'bars')}>{VIEW_BARS}</button>
    </div>
    {#if largeTextHint}
      <p class="hint" data-large-text-hint>{LARGE_TEXT_HINT}</p>
    {/if}
  </div>

  <!-- Before the figure: the data table is what a screen reader meets first (§9.5 c). -->
  <BarTable rows={estimates} caption={TABLE_CAPTION} skillHeader={TABLE_SKILL} groupHeader={TABLE_CLUSTER} hidden={view === 'blob'} describedBy={emoNote} />

  {#if view === 'blob'}
    <!-- The figure's name is the title; the caption is content, not a name (UX-047). -->
    <figure class="blob-figure" aria-label={BLOB_TITLE}>
      <div class="chart-box" {@attach widthOf((w) => (blobWidth = w))}>
        <BlobChart {model} uid="{uid}-blob" title={BLOB_TITLE} description={BLOB_DESCRIPTION} onselect={(g) => toggleCluster(g, true)} {selected} />
      </div>
      <figcaption>
        <!-- The warning first: the size of the shape means nothing on its own (UX-039). -->
        <p>{READING_CAPTION}</p>
        <p>{RING_CAPTION}</p>
        <p>{UNCERTAINTY_CAPTION}</p>
        <p>{STUB_CAPTION}</p>
        {#if anyOffScale}
          <p>{OFF_SCALE_CAPTION}</p>
        {/if}
        <p>{TIER_LEGEND}</p>
        {#if model.hatch.length > 0}
          <p>{HATCH_CAPTION}</p>
        {/if}
      </figcaption>
    </figure>
  {/if}

  {#if view === 'bars'}
    <p class="note">{BARS_NOTE}</p>
    {#if anyOffScaleFinal}
      <p class="note">{OFF_SCALE_BARS_NOTE}</p>
    {/if}
    <p class="note">{TIER_LEGEND}</p>
  {/if}

  {#if emoMeasured}
    <p id="{uid}-note-EMO" class="note skill-note" data-skill-note="EMO"><strong>{EMO_AXIS_NAME}.</strong> {EMO_TOOLTIP}</p>
  {/if}

  {#if between}
    {@render between()}
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
          <h3 id="{uid}-facet-heading" tabindex="-1">{facetHeading(selected)}</h3>
          {#if facets.length === 0}
            <p>{FACET_EMPTY}</p>
          {:else if noneYet}
            <p class="facet-none">{facetNone(selected, facets.length)}</p>
            <ul class="facet-names">
              {#each facets as f (f.id)}
                <li>{f.name}</li>
              {/each}
            </ul>
          {:else}
            {#if facetModel !== null}
              <div class="chart-box" {@attach widthOf((w) => (subWidth = w))}>
                <BlobChart model={facetModel} uid="{uid}-sub" title={facetHeading(selected)} description={facetCaption(selected)} />
              </div>
              {#if facetModel.spokes.some((x) => x.offScale !== undefined)}
                <p class="note">{OFF_SCALE_CAPTION}</p>
              {/if}
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
  /* One heading size across the results (UX-047). */
  h2 {
    font-size: 1.25rem;
    color: var(--r-fg, var(--hb-text-strong));
  }
  h3 {
    font-size: 1.125rem;
  }
  h3:focus {
    outline: none;
  }
  h3:focus-visible {
    outline: 3px solid var(--hb-blob);
    outline-offset: 2px;
  }
  .rem {
    position: absolute;
    width: 1rem;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }
  .toolbar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--hb-text);
  }
  .facet-none {
    margin: 0;
  }
  .facet-names {
    margin: 0;
    padding-left: 1.25rem;
    columns: 2 14rem;
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
  /* The chart's own box: its width is what fitLayout sizes the text for. */
  .chart-box {
    width: 100%;
    max-width: 40rem;
    margin: 0 auto;
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
