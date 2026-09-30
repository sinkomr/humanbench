<!--
  "Your most distinctive peaks" (DESIGN §10; ROADMAP M1.R, A12): only the skills whose within-person
  contrast has a 90% interval clearly above 0 (`peaks.ts`), or a plain sentence when there are none.
  Only peaks: no lows are picked out (R-5.6.4), and no mean or total is shown (§9.5 a).
-->
<script lang="ts">
  import { formatTheta } from '../viz/geometry'
  import { PEAKS_HEADING, PEAKS_INTRO, PEAKS_NONE, PEAKS_NOTE, PEAKS_TOO_FEW, peakDetail } from './copy'
  import type { Contrast } from './peaks'
  import { PEAKS_MIN_MEASURED } from './peaks'
  import './reveal.css'

  interface Props {
    readonly peaks: readonly Contrast[]
    /** How many skills were measured (fewer than three cannot be compared with each other). */
    readonly measured: number
  }

  let { peaks, measured }: Props = $props()

  const uid = $props.id()
</script>

<section class="hb-reveal-panel" aria-labelledby="{uid}-h" data-section="peaks">
  <h2 id="{uid}-h">{PEAKS_HEADING}</h2>
  <p>{PEAKS_INTRO}</p>
  {#if measured < PEAKS_MIN_MEASURED}
    <p>{PEAKS_TOO_FEW}</p>
  {:else if peaks.length === 0}
    <p>{PEAKS_NONE}</p>
  {:else}
    <ol class="peaks">
      {#each peaks as p (p.code)}
        <li data-peak={p.code}>
          <strong>{p.name}</strong>
          {peakDetail(Math.abs(p.contrast).toFixed(1), formatTheta(p.lo90, 1), formatTheta(p.hi90, 1))}
        </li>
      {/each}
    </ol>
  {/if}
  <p class="note">{PEAKS_NOTE}</p>
</section>
