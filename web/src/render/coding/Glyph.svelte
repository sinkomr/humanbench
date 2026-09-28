<!-- One coding glyph as SVG with its text alternative (ROADMAP M1.13; `glyphs.ts`). -->
<script lang="ts">
  import type { CodingSymbol } from '../../tasks/coding/config'
  import { GLYPHS } from './glyphs'

  interface Props {
    readonly symbol: CodingSymbol
    /** Rendered size (CSS length). */
    readonly size?: string
    /** Hide from assistive tech (when a caption already names it). */
    readonly decorative?: boolean
  }

  let { symbol, size = '2.5rem', decorative = false }: Props = $props()
  const def = $derived(GLYPHS[symbol])
</script>

<svg
  class="glyph"
  viewBox="0 0 100 100"
  width={size}
  height={size}
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : def.name}
  aria-hidden={decorative ? 'true' : undefined}
  focusable="false"
>
  {#each def.shapes as s, i (i)}
    {#if s.kind === 'path'}
      <path {...s.attrs} class:fill={s.filled} class:line={!s.filled} />
    {:else if s.kind === 'polygon'}
      <polygon {...s.attrs} class:fill={s.filled} class:line={!s.filled} />
    {:else if s.kind === 'circle'}
      <circle {...s.attrs} class:fill={s.filled} class:line={!s.filled} />
    {:else}
      <rect {...s.attrs} class:fill={s.filled} class:line={!s.filled} />
    {/if}
  {/each}
</svg>

<style>
  .glyph {
    display: block;
    overflow: visible;
  }

  .fill {
    fill: currentColor;
    stroke: none;
  }

  .line {
    fill: none;
    stroke: currentColor;
    stroke-width: 8;
    stroke-linejoin: round;
  }
</style>
