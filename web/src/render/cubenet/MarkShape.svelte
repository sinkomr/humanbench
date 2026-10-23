<!--
  One mark (cube-net renderer, DESIGN §4.2): its filled parts in the [0, 100]² square, placed by
  `transform` (a translation on the net, an affine map onto a cube face).
-->
<script lang="ts">
  import type { Mark } from '../../tasks/cubenet/spec'
  import { INK, MARK_PARTS } from './draw'

  interface Props {
    mark: Mark
    transform: string
  }

  let { mark, transform }: Props = $props()
</script>

<g {transform}>
  {#each MARK_PARTS[mark] as part, i (i)}
    <path d={part.d} fill={INK} fill-rule={part.rule} />
  {/each}
</g>
