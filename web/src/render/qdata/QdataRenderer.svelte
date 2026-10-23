<!--
  Qdata renderer (DESIGN §3 row 6, §4.2 "Math", §13; ROADMAP A18): the exhibit, if the item has one
  (a table, or a bar or line chart with a complete text alternative), then the stem, then a typed
  entry per `spec.input_format` with the item's own hint. The entry is checked like quant's
  (`checkNewEntry`: what score()'s `parseEntry` reads, less numbers with thousands commas; a
  whole-number item takes whole numbers only), and the typed text is the response
  (`QdataResponse`). The entry opens on the first frame the item is drawn in (`onshown`, rAF on the
  performance.now() clock), so no answer is taken before the question is on screen.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../common/render.css'
  import NumericEntry from '../common/NumericEntry.svelte'
  import type { EntryVerdict } from '../common/entry-copy'
  import { browserTiming, type EntryRendererProps } from '../common/props'
  import type { QdataSpec } from '../../tasks/qdata/spec'
  import type { QdataResponse } from '../../tasks/qdata/score'
  import { checkNewEntry, parseEntry } from '../../tasks/quant/numeric'
  import QdataChart from './QdataChart.svelte'
  import QdataTable from './QdataTable.svelte'
  import { QDATA_ENTRY_LABEL, QDATA_REGION_LABEL } from './copy'

  let { spec, onrespond, onshown, onpaste, timing, disabled = false }: EntryRendererProps<QdataSpec, QdataResponse> = $props()

  const clock = $derived((timing ?? browserTiming()).clock)
  let shown = $state(false)

  const check = (t: string): EntryVerdict => {
    const c = checkNewEntry(t)
    if (c !== 'ok') return c === 'thousands' ? 'thousands' : 'format'
    return spec.input_format === 'integer' && parseEntry(t)?.isInteger() !== true ? 'format' : 'ok'
  }

  onMount(() => {
    const frames = (timing ?? browserTiming()).frames
    const h = frames.request((ts) => {
      shown = true
      onshown?.(ts)
    })
    return () => frames.cancel(h)
  })
</script>

<section class="hb-render qdata" aria-label={QDATA_REGION_LABEL}>
  {#if spec.exhibit}
    {#if spec.exhibit.kind === 'table'}
      <QdataTable exhibit={spec.exhibit} />
    {:else}
      <QdataChart exhibit={spec.exhibit} />
    {/if}
  {/if}
  <p class="stem">{spec.stem}</p>
  <NumericEntry
    format={spec.input_format}
    hint={spec.hint}
    label={QDATA_ENTRY_LABEL}
    {check}
    onsubmit={(text) => {
      if (shown) onrespond(text)
    }}
    onpaste={() => onpaste?.({ t_ms: clock.now() })}
    disabled={disabled || !shown}
  />
</section>

<style>
  .qdata {
    padding: 0.5rem 0;
    min-width: 0;
  }

  .stem {
    max-width: 38rem;
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
    overflow-wrap: anywhere;
  }
</style>
