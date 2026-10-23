<!--
  One cube option (cube-net renderer, DESIGN §4.2): an isometric cube, top / front-left /
  front-right faces with their marks drawn in each face's affine frame. Decorative for assistive
  technology: the option's radio carries the description (copy.ts `cubenetOptionName`).
-->
<script lang="ts">
  import type { CubeView } from '../../tasks/cubenet/spec'
  import { CUBE_FACES, CUBE_VIEWBOX, EDGE_WIDTH, INK } from './draw'
  import MarkShape from './MarkShape.svelte'

  interface Props {
    view: CubeView
  }

  let { view }: Props = $props()
</script>

<svg class="cube" viewBox={CUBE_VIEWBOX} aria-hidden="true" focusable="false">
  {#each CUBE_FACES as f (f.face)}
    <polygon points={f.points} fill={f.fill} />
    <MarkShape mark={view[f.face]} transform={f.transform} />
    <polygon points={f.points} fill="none" stroke={INK} stroke-width={EDGE_WIDTH} stroke-linejoin="round" />
  {/each}
</svg>

<style>
  .cube {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1.732 / 2;
    max-height: 11rem;
    margin: 0 auto;
  }
</style>
