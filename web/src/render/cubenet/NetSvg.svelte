<!--
  The net (cube-net renderer, DESIGN §4.2): its squares on a 100-unit grid, each with its mark,
  dashed light fold lines where two squares are joined and a solid outline round the pattern. An
  image with the complete text alternative of copy.ts `netAlt`.
-->
<script lang="ts">
  import type { NetSquare } from '../../tasks/cubenet/spec'
  import { EDGE_WIDTH, FOLD, INK, PAPER, UNIT, netEdges, netSize } from './draw'
  import MarkShape from './MarkShape.svelte'

  interface Props {
    net: readonly NetSquare[]
    label: string
  }

  let { net, label }: Props = $props()

  const size = $derived(netSize(net))
  const edges = $derived(netEdges(net))
  const M = 4
</script>

<svg
  class="net"
  viewBox="{-M} {-M} {size.cols * UNIT + 2 * M} {size.rows * UNIT + 2 * M}"
  style:--cols={size.cols}
  role="img"
  aria-label={label}
  focusable="false"
>
  {#each net as q (`${q.r},${q.c}`)}
    <rect x={q.c * UNIT} y={q.r * UNIT} width={UNIT} height={UNIT} fill={PAPER} />
    <MarkShape mark={q.mark} transform="translate({q.c * UNIT} {q.r * UNIT})" />
  {/each}
  {#each edges.folds as s, i (i)}
    <line class="fold" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={FOLD} stroke-width="2" stroke-dasharray="8 6" />
  {/each}
  {#each edges.outline as s, i (i)}
    <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={INK} stroke-width={EDGE_WIDTH} stroke-linecap="square" />
  {/each}
</svg>

<style>
  .net {
    display: block;
    width: min(100%, calc(var(--cols) * 4.5rem));
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
</style>
