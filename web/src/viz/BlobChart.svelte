<script lang="ts">
  /**
   * The jagged blob as SVG (DESIGN §9; ROADMAP M1.16). A pure view of a {@link BlobModel}
   * (`blob.ts` computes every path). The chart is one `role="img"` with a title and description;
   * its data is in the table `ProfileView` always renders (the screen-reader default, §9.5 c).
   * Colours come from the `--hb-*` custom properties of `palette.ts` set by the parent.
   */
  import type { BlobModel } from './blob'
  import { RING_NOTE } from './copy'

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
</script>

<svg class="hb-blob" viewBox={model.viewBox} role="img" aria-labelledby="{uid}-title {uid}-desc" data-spokes={model.spokes.length}>
  <title id="{uid}-title">{title}</title>
  <desc id="{uid}-desc">{description}</desc>
  <defs>
    <pattern id="{uid}-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line class="hatch-line" x1="0" y1="0" x2="0" y2="7" />
    </pattern>
    {#each model.hatch as h, i (h.id)}
      <clipPath id="{uid}-clip-{i}"><path d={h.d} /></clipPath>
    {/each}
  </defs>

  <g class="wedges">
    {#each model.wedges as w (w.group)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <path class="wedge" class:selected={selected === w.group} d={w.d} data-group={w.group} onclick={() => onselect?.(w.group)} />
    {/each}
  </g>

  <g class="grid">
    {#each model.rings as ring (ring.theta)}
      <circle class="ring" class:reference={ring.reference} r={f(ring.r)} />
    {/each}
    {#each model.spokes as s (s.id)}
      <line class="spoke" class:unmeasured={!s.measured} x1="0" y1="0" x2={f(s.outer[0])} y2={f(s.outer[1])} />
    {/each}
  </g>

  <path class="band" d={model.band.d} fill-rule="evenodd" />
  <g class="fuzz">
    {#each model.fuzz as c, i (i)}
      <path d={c.d} data-curve={c.kind} />
    {/each}
  </g>
  {#each model.hatch as h, i (h.id)}
    <path class="hatch" d={model.crisp.d} fill="url(#{uid}-hatch)" clip-path="url(#{uid}-clip-{i})" />
  {/each}
  <path class="crisp" d={model.crisp.d} data-curve={model.crisp.kind} />

  <g class="marks">
    {#each model.spokes as s (s.id)}
      <g class="mark" class:muted={s.muted} class:unmeasured={!s.measured} data-spoke={s.id} data-tier={s.tier}>
        {#if s.whisker && s.marker}
          <line class="whisker" x1={f(s.whisker[0][0])} y1={f(s.whisker[0][1])} x2={f(s.whisker[1][0])} y2={f(s.whisker[1][1])} />
          <circle class="marker" cx={f(s.marker[0])} cy={f(s.marker[1])} r="4.5" />
        {:else if s.stub && s.gap}
          <line class="stub" x1="0" y1="0" x2={f(s.stub[0])} y2={f(s.stub[1])} />
          <circle class="gap" cx={f(s.gap[0])} cy={f(s.gap[1])} r="3" />
        {/if}
      </g>
    {/each}
  </g>

  <g class="ring-labels">
    {#each model.rings as ring (ring.theta)}
      <text class="ring-label" class:reference={ring.reference} x={f(ring.labelAt[0])} y={f(ring.labelAt[1])}>{ring.label}</text>
    {/each}
  </g>

  <text class="ring-note" x={f(model.noteAt[0])} y={f(model.noteAt[1])}>
    {#each RING_NOTE as line, li (li)}
      <tspan x={f(model.noteAt[0])} dy={li === 0 ? '0' : '1.2em'}>{line}</tspan>
    {/each}
  </text>

  <g class="labels">
    {#each model.spokes as s (s.id)}
      <text class="label" class:muted={s.muted} class:unmeasured={!s.measured} x={f(s.label.at[0])} y={f(s.label.at[1])} text-anchor={s.label.anchor}>
        {#each s.lines as line, li (li)}
          <tspan x={f(s.label.at[0])} dy="{li === 0 ? s.label.dy0.toFixed(2) : '1.15'}em" class:note={!s.measured && li === s.lines.length - 1}
            >{line}{#if li === 0 && s.glyph}&nbsp;{s.glyph}{/if}</tspan
          >
        {/each}
      </text>
    {/each}
  </g>
</svg>

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

  .band {
    fill: var(--hb-band);
    fill-opacity: 0.28;
    stroke: none;
    pointer-events: none;
  }
  .fuzz path {
    fill: none;
    stroke: var(--hb-band);
    stroke-opacity: 0.45;
    stroke-width: 1;
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

  .marks {
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
  .muted .whisker {
    stroke: var(--hb-muted);
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
  .gap {
    fill: var(--hb-bg);
    stroke: var(--hb-stub);
    stroke-width: 1.5;
  }

  .ring-label {
    font-size: 10px;
    fill: var(--hb-text-muted);
    pointer-events: none;
  }
  .ring-note {
    font-size: 11px;
    fill: var(--hb-text-muted);
  }
  .ring-label.reference {
    font-weight: 600;
  }
  .label {
    font-size: 12.5px;
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
    font-size: 11px;
  }
</style>
