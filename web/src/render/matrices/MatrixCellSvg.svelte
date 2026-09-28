<!--
  One matrix cell as SVG (ROADMAP M1.13; DESIGN §4.2 "Matrices"): the paper square, then per
  object its grey fill, its orientation stripe and its black outline on top (so the stripe's ends
  never cut the outline). `cell = null` is the missing ninth cell, drawn as a dashed square with a
  question mark (a path, not text, so it looks the same with every font). With a `label` the SVG is
  an image with that text alternative; without one it is decorative (an option's radio carries the
  description instead). All geometry comes from `draw.ts`.
-->
<script lang="ts">
  import type { MatrixCell } from '../../tasks/matrices/grammar'
  import { CELL, CELL_BORDER, OUTLINE, OUTLINE_WIDTH, PAPER, STRIPE_WIDTH, cellObjects } from './draw'

  interface Props {
    /** The cell, or null for the missing ninth cell. */
    cell: MatrixCell | null
    /** Text alternative; omit when an enclosing control already describes the cell. */
    label?: string
  }

  let { cell, label }: Props = $props()

  const objects = $derived(cell === null ? [] : cellObjects(cell))
</script>

{#if label !== undefined}
  <svg class="cell" viewBox="0 0 {CELL} {CELL}" role="img" aria-label={label} focusable="false">
    {@render body()}
  </svg>
{:else}
  <svg class="cell" viewBox="0 0 {CELL} {CELL}" aria-hidden="true" focusable="false">
    {@render body()}
  </svg>
{/if}

{#snippet body()}
  {#if cell === null}
    <rect x="1.5" y="1.5" width="97" height="97" fill={PAPER} stroke={CELL_BORDER} stroke-width="3" stroke-dasharray="8 6" />
    <path d="M38 38 C38 24 62 24 62 38 C62 48 50 49 50 60 L50 63" fill="none" stroke={OUTLINE} stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="50" cy="75" r="4" fill={OUTLINE} />
  {:else}
    <rect x="1" y="1" width="98" height="98" fill={PAPER} stroke={CELL_BORDER} stroke-width="2" />
    {#each objects as o, k (k)}
      {#if o.points !== null}
        <polygon points={o.points} fill={o.fill} />
      {:else}
        <circle cx={o.cx} cy={o.cy} r={o.r} fill={o.fill} />
      {/if}
      <line x1={o.stripe.x1} y1={o.stripe.y1} x2={o.stripe.x2} y2={o.stripe.y2} stroke={o.stripe.stroke} stroke-width={STRIPE_WIDTH} />
      {#if o.points !== null}
        <polygon points={o.points} fill="none" stroke={OUTLINE} stroke-width={OUTLINE_WIDTH} stroke-linejoin="round" />
      {:else}
        <circle cx={o.cx} cy={o.cy} r={o.r} fill="none" stroke={OUTLINE} stroke-width={OUTLINE_WIDTH} />
      {/if}
    {/each}
  {/if}
{/snippet}

<style>
  .cell {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }
</style>
