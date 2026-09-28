<!--
  Quant renderer (ROADMAP M1.8, M1.13, A18; DESIGN §3 row 6, §4.2 "Math", §14.6 ex. 3): the stem
  (powers as superscripts), then a typed entry per `spec.input_format` with the item's own hint.
  The entry is checked with quant's score() parser (`parseEntry`), and the typed text is the
  response (`QuantResponse`).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../common/render.css'
  import NumericEntry from '../common/NumericEntry.svelte'
  import { browserTiming, type EntryRendererProps } from '../common/props'
  import type { QuantSpec } from '../../tasks/quant/gen'
  import { parseEntry } from '../../tasks/quant/numeric'
  import type { QuantResponse } from '../../tasks/quant/score'
  import { stemParts } from './stem'

  let { spec, onrespond, onshown, onpaste, timing, disabled = false }: EntryRendererProps<QuantSpec, QuantResponse> = $props()

  const clock = $derived((timing ?? browserTiming()).clock)
  const parts = $derived(stemParts(spec.stem))
  const accepts = (t: string): boolean => parseEntry(t) !== null

  onMount(() => {
    if (!onshown) return
    const frames = (timing ?? browserTiming()).frames
    const h = frames.request((ts) => onshown(ts))
    return () => frames.cancel(h)
  })
</script>

<section class="hb-render quant" aria-label="Quantitative question">
  <p class="stem">
    {#each parts as part, i (i)}{#if 'sup' in part}<span class="hb-sr-only"> to the power </span><sup>{part.sup}</sup>{:else}{part.text}{/if}{/each}
  </p>
  <NumericEntry
    format={spec.input_format}
    hint={spec.hint}
    label="Your answer"
    {accepts}
    onsubmit={(text) => onrespond(text)}
    onpaste={() => onpaste?.({ t_ms: clock.now() })}
    {disabled}
  />
</section>

<style>
  .quant {
    padding: 0.5rem 0;
  }

  .stem {
    max-width: 38rem;
    margin: 0;
    font-size: 1.125rem;
    overflow-wrap: anywhere;
  }

  sup {
    font-size: 0.75em;
    line-height: 0;
  }
</style>
