<script lang="ts">
  /**
   * The jagged blob as SVG (DESIGN §9; ROADMAP M1.16). A pure view of a {@link BlobModel}
   * (`blob.ts` computes every path). The chart is one `role="img"` named by its title and described
   * by its description (the name stays short, UX-047); its data is in the table `ProfileView` always
   * renders (the screen-reader default, §9.5 c).
   * Colours come from the `--hb-*` custom properties of `palette.ts` set by the parent. Font
   * sizes come from the model (`fitLayout`), and every text has a halo in the page background, so
   * it keeps the palette's ≥ 4.5:1 text contrast over the band, fuzz and curve (§9.8).
   * UX review D13 (provisional defaults): a not-measured spoke leaves a gap in the curve with an ×
   * on the 0 SD ring; when the layout leaves those spokes without labels (narrow screens), a line
   * under the chart names them. D15 A: a share card's named peaks are ringed, their labels bold.
   */
  import { LABEL_LINE_EM, NOTE_LINE_EM, type BlobModel } from './blob'
  import { RING_NOTE, stubListText } from './copy'

  interface Props {
    model: BlobModel
    /** Unique id prefix (title, pattern and clip-path ids). */
    uid: string
    title: string
    description: string
    /** Mouse shortcut for the drill-down (§9.6); keyboard users have the cluster buttons. */
    onselect?: (group: string) => void
    selected?: string | null
  }

  let { model, uid, title, description, onselect, selected = null }: Props = $props()

  const f = (v: number): string => v.toFixed(2)
  const mutedRuns = $derived(model.muteRuns.filter((r) => r.muted))
  const credibleRuns = $derived(model.muteRuns.filter((r) => !r.muted))
  const stubs = $derived(model.spokes.filter((s) => !s.measured))
</script>

<svg class="hb-blob" viewBox={model.viewBox} role="img" aria-labelledby="{uid}-title" aria-describedby="{uid}-desc" data-spokes={model.spokes.length}>
  <title id="{uid}-title">{title}</title>
  <desc id="{uid}-desc">{description}</desc>
  <defs>
    <pattern id="{uid}-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line class="hatch-line" x1="0" y1="0" x2="0" y2="7" />
    </pattern>
    {#each model.hatch as h, i (h.id)}
      <clipPath id="{uid}-clip-{i}"><path d={h.d} /></clipPath>
    {/each}
    {#if mutedRuns.length > 0}
      <!-- §9.5: the crisp curve in the blob colour only where spokes are credible, muted elsewhere. -->
      <clipPath id="{uid}-credible">
        {#each credibleRuns as run (run.spokeIds[0])}<path d={run.d} />{/each}
      </clipPath>
      <clipPath id="{uid}-muted">
        {#each mutedRuns as run (run.spokeIds[0])}<path d={run.d} />{/each}
      </clipPath>
    {/if}
  </defs>

  {#if onselect}
    <g class="wedges">
      {#each model.wedges as w (w.group)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <path class="wedge" class:selected={selected === w.group} d={w.d} data-group={w.group} onclick={() => onselect?.(w.group)} />
      {/each}
    </g>
  {/if}

  <g class="grid">
    {#each model.rings as ring (ring.theta)}
      <circle class="ring" class:reference={ring.reference} r={f(ring.r)} />
    {/each}
    {#each model.spokes as s (s.id)}
      <line class="spoke" class:unmeasured={!s.measured} x1="0" y1="0" x2={f(s.outer[0])} y2={f(s.outer[1])} />
    {/each}
  </g>

  {#if stubs.length > 0}
    <!-- D13 A: the stub and the gap marker (an × on the 0 SD ring, over a halo in the page background) of each
         not-measured spoke. Placeholders, not data: under the ring labels, so a label's halo may cover part of an ×
         and the label stays readable. -->
    <g class="stubs">
      {#each stubs as s (s.id)}
        <g class="mark unmeasured" data-spoke={s.id} data-tier={s.tier}>
          {#if s.stub && s.gapMark}
            <line class="stub" x1="0" y1="0" x2={f(s.stub[0])} y2={f(s.stub[1])} />
            <path class="gap-halo" d={s.gapMark} />
            <path class="gap" d={s.gapMark} />
          {/if}
        </g>
      {/each}
    </g>
  {/if}

  <!-- Under the data (UX-045): a ring label's halo knocks out the grid only, never the curve, a marker or a whisker. -->
  <g class="ring-labels" font-size={f(model.text.small)} stroke-width={f(model.text.halo)}>
    {#each model.rings.filter((x) => x.showLabel) as ring (ring.theta)}
      <text class="ring-label" class:reference={ring.reference} x={f(ring.labelAt[0])} y={f(ring.labelAt[1])}>{ring.label}</text>
    {/each}
  </g>

  <path class="band" d={model.band.d} fill-rule="evenodd" />
  <!-- §9.3: 20 nested curves at θ + z·SD, each filling the band toward the mean, opacity ∝ φ(z). -->
  <g class="fuzz">
    {#each model.fuzz as c, i (i)}
      <path d={c.band} fill-rule="evenodd" fill-opacity={c.opacity.toFixed(3)} data-curve={c.kind} />
    {/each}
  </g>
  {#each model.hatch as h, i (h.id)}
    <path class="hatch" d={model.hatchFill} fill="url(#{uid}-hatch)" clip-path="url(#{uid}-clip-{i})" />
  {/each}
  <path class="crisp" d={model.crisp.d} data-curve={model.crisp.kind} clip-path={mutedRuns.length > 0 ? `url(#${uid}-credible)` : undefined} />
  {#if mutedRuns.length > 0}
    <path class="crisp-muted" d={model.crisp.d} clip-path="url(#{uid}-muted)" data-spokes={mutedRuns.flatMap((r) => r.spokeIds).join(' ')} />
  {/if}

  <g class="marks">
    {#each model.spokes.filter((x) => x.measured) as s (s.id)}
      <g class="mark" class:muted={s.muted} class:peak={s.peak} data-spoke={s.id} data-tier={s.tier}>
        {#if s.whisker && s.marker}
          <line class="whisker" x1={f(s.whisker[0][0])} y1={f(s.whisker[0][1])} x2={f(s.whisker[1][0])} y2={f(s.whisker[1][1])} />
          {#if s.arrow}
            <!-- UX-037: beyond the scale, an arrowhead on the clamp instead of the dot (never the grey stub). -->
            <path class="arrow" d={s.arrow} data-off-scale={s.offScale} />
          {:else}
            <circle class="marker" cx={f(s.marker[0])} cy={f(s.marker[1])} r="4.5" />
          {/if}
          {#if s.peak}
            <!-- D15 A: a named peak of a share card, ringed. -->
            <circle class="peak-ring" cx={f(s.marker[0])} cy={f(s.marker[1])} r="9" />
          {/if}
        {/if}
      </g>
    {/each}
  </g>

  {#if model.showNote}
    <text class="ring-note" x={f(model.noteAt[0])} y={f(model.noteAt[1])} font-size={f(model.text.small)} stroke-width={f(model.text.halo)}>
      {#each RING_NOTE as line, li (li)}
        <tspan x={f(model.noteAt[0])} dy={li === 0 ? '0' : `${NOTE_LINE_EM}em`}>{line}</tspan>
      {/each}
    </text>
  {/if}

  <g class="labels" font-size={f(model.text.label)} stroke-width={f(model.text.halo)}>
    {#each model.spokes.filter((x) => x.lines.length > 0) as s (s.id)}
      <text class="label" class:muted={s.muted} class:unmeasured={!s.measured} class:peak={s.peak} x={f(s.label.at[0])} y={f(s.label.at[1])} text-anchor={s.label.anchor}>
        {#each s.lines as line, li (li)}
          <tspan
            x={f(s.label.at[0])}
            dy="{li === 0 ? s.label.dy0.toFixed(2) : LABEL_LINE_EM}em"
            class:note={line.note}
            font-size={line.note ? f(model.text.small) : undefined}>{line.text}{#if line.glyph}&nbsp;{s.glyph}{/if}</tspan
          >
        {/each}
      </text>
    {/each}
  </g>
</svg>
{#if model.stubList.length > 0}
  <!-- D13 B: the not-measured spokes have no labels on this narrow chart; this line names them. -->
  <p class="stub-list" data-stub-list>
    {#each model.stubList as g, gi (g.lead)}{gi > 0 ? ' ' : ''}{stubListText(g.lead, g.names)}{/each}
  </p>
{/if}

<style>
  .hb-blob {
    display: block;
    width: 100%;
    height: auto;
    max-width: 40rem;
    margin: 0 auto;
    overflow: visible;
    font-family: inherit;
  }

  .wedge {
    fill: transparent;
    cursor: pointer;
  }
  .wedge:hover,
  .wedge.selected {
    fill: var(--hb-band);
    fill-opacity: 0.12;
  }

  .ring {
    fill: none;
    stroke: var(--hb-grid);
    stroke-width: 1;
  }
  .ring.reference {
    stroke: var(--hb-stub);
    stroke-width: 1.75; /* REFERENCE_RING_STROKE_WIDTH (geometry.ts): a slightly heavier 0 SD ring, no label of its own */
    stroke-dasharray: 5 4;
  }
  .spoke {
    stroke: var(--hb-grid);
    stroke-width: 1;
  }
  .spoke.unmeasured {
    stroke: var(--hb-stub);
    stroke-dasharray: 3 4;
  }

  /* §9.3: the light ±1 SD band (the accessible fallback) under the fuzz, whose per-band
     fill-opacity (∝ φ(z)) is an attribute from the model; CSS must not set it. */
  .band {
    fill: var(--hb-band);
    fill-opacity: 0.12;
    /* The ±1 SD edge, outlined so the band shows against the page (UX-047; palette.ts keeps it ≥ 1.5:1). */
    stroke: var(--hb-band);
    stroke-opacity: var(--hb-band-edge-opacity, 0.6);
    stroke-width: 1;
    pointer-events: none;
  }
  .fuzz path {
    fill: var(--hb-band);
    stroke: none;
    pointer-events: none;
  }
  .hatch {
    stroke: none;
    pointer-events: none;
  }
  .hatch-line {
    stroke: var(--hb-hatch);
    stroke-width: 2;
  }
  .crisp {
    fill: none;
    stroke: var(--hb-blob);
    stroke-width: 2.5;
    stroke-linejoin: round;
    pointer-events: none;
  }
  /* §9.5: the curve around spikes whose 90% interval overlaps 0 SD. */
  .crisp-muted {
    fill: none;
    stroke: var(--hb-muted);
    stroke-width: 2;
    stroke-linejoin: round;
    pointer-events: none;
  }

  .marks,
  .stubs {
    pointer-events: none;
  }
  .whisker {
    stroke: var(--hb-blob);
    stroke-width: 1.75;
  }
  .marker {
    fill: var(--hb-blob);
    stroke: var(--hb-bg);
    stroke-width: 1.5;
  }
  .arrow {
    fill: var(--hb-blob);
    stroke: var(--hb-bg);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .muted .whisker {
    stroke: var(--hb-muted);
  }
  .muted .arrow {
    fill: var(--hb-bg);
    stroke: var(--hb-muted);
    stroke-width: 2;
  }
  .muted .marker {
    fill: var(--hb-bg);
    stroke: var(--hb-muted);
    stroke-width: 2;
  }
  .stub {
    stroke: var(--hb-stub);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .gap-halo {
    fill: none;
    stroke: var(--hb-bg);
    stroke-width: 5;
    stroke-linecap: round;
  }
  .gap {
    fill: none;
    stroke: var(--hb-stub);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .peak-ring {
    fill: none;
    stroke: var(--hb-blob);
    stroke-width: 2;
  }

  /* A halo in the page background behind every chart text (paint-order: stroke first), so the
     text's contrast is the palette's text contrast wherever it sits (§9.8). The halo width and the
     font sizes are attributes from the model; CSS must not set them. */
  text {
    paint-order: stroke fill;
    stroke: var(--hb-bg);
    stroke-linejoin: round;
  }
  .ring-label {
    fill: var(--hb-text-muted);
    pointer-events: none;
  }
  .ring-note {
    fill: var(--hb-text-muted);
  }
  .ring-label.reference {
    font-weight: 600;
  }
  .label {
    fill: var(--hb-text-strong);
    pointer-events: none;
  }
  .label.muted {
    fill: var(--hb-text);
  }
  .label.unmeasured {
    fill: var(--hb-text-muted);
  }
  .label .note {
    font-style: italic;
  }
  .label.peak {
    font-weight: 700;
  }

  /* HTML text: it grows with the page's text size (UX-044), like the captions under the chart. */
  .stub-list {
    max-width: 40rem;
    margin: 0.25rem auto 0;
    font-size: 0.875rem;
    color: var(--hb-text-muted);
  }
</style>
