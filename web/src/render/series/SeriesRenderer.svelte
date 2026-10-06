<!--
  Series renderer (ROADMAP M1.7, M1.13, A18; DESIGN §4.2 "Series", §14.6 ex. 2): the 5–7 visible
  terms in spec order, then a typed entry for the next term, integer or one letter per
  `spec.input_format`. The entry is checked with the series score() parsers, and the typed text is
  the response (`SeriesResponse`).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../common/render.css'
  import NumericEntry from '../common/NumericEntry.svelte'
  import { FORMAT_HINTS, type EntryVerdict } from '../common/entry-copy'
  import { browserTiming, type EntryRendererProps } from '../common/props'
  import { parseIntegerResponse, parseLetterResponse } from '../../tasks/series/score'
  import type { SeriesResponse, SeriesSpec } from '../../tasks/series/types'
  import { displayTerm } from './terms'

  let { spec, onrespond, onshown, onpaste, timing, disabled = false }: EntryRendererProps<SeriesSpec, SeriesResponse> = $props()

  const clock = $derived((timing ?? browserTiming()).clock)
  // One noun for the whole item: the prompt, the field and the hidden text all say number or all say letter.
  const noun = $derived(spec.input_format === 'letter' ? 'letter' : 'number')
  const reads = $derived(
    spec.input_format === 'letter' ? (t: string) => parseLetterResponse(t) !== undefined : (t: string) => parseIntegerResponse(t) !== undefined,
  )
  const check = (t: string): EntryVerdict => (reads(t) ? 'ok' : 'format')

  onMount(() => {
    if (!onshown) return
    const frames = (timing ?? browserTiming()).frames
    const h = frames.request((ts) => onshown(ts))
    return () => frames.cancel(h)
  })
</script>

<section class="hb-render series" aria-label="Number or letter sequence">
  <p class="prompt">Which {noun} comes next in this sequence?</p>
  <ol class="terms" aria-label="Sequence, {spec.terms.length} terms shown, then the missing next {noun}">
    {#each spec.terms as term, i (i)}
      <li class="term">{displayTerm(term)}</li>
    {/each}
    <li class="term next"><span aria-hidden="true">?</span><span class="hb-sr-only">missing next {noun}</span></li>
  </ol>
  <NumericEntry
    format={spec.input_format}
    hint={FORMAT_HINTS[spec.input_format]}
    label="Next {noun}"
    {check}
    onsubmit={(text) => onrespond(text)}
    onpaste={() => onpaste?.({ t_ms: clock.now() })}
    {disabled}
  />
</section>

<style>
  .series {
    padding: 0.5rem 0;
  }

  .prompt {
    margin: 0 0 0.75rem;
    font-weight: 600;
  }

  .terms {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .term {
    min-width: 3rem;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
    font-size: 1.375rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .term.next {
    border-style: dashed;
    background: transparent;
  }
</style>
