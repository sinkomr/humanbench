<!--
  The confidence slider (ROADMAP M1.15; DESIGN §3 row 12, §14.6 ex. 9): "How sure are you that your
  answer is right?" from the chance level 1/k (multiple choice) or 0 (typed entry) to 100%, in whole
  percent. A native range input, so the arrow keys, Home, End and Page keys work; the value is
  also written out next to it and in `aria-valuetext`. Focus starts on the slider so a keyboard
  user rates straight away. Nothing about right or wrong is shown for a counted item (§10).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { CONFIDENCE_CONTINUE, CONFIDENCE_LEGEND, confidenceHint, confidenceValue } from './copy'

  interface Props {
    readonly floorPct: number
    readonly startPct: number
    readonly optionsCount: number | null
    readonly onconfirm: (pct: number) => void
  }

  let { floorPct, startPct, optionsCount, onconfirm }: Props = $props()

  const uid = $props.id()
  // The starting position of this answer only; the slider then belongs to the person.
  // svelte-ignore state_referenced_locally
  let value = $state(startPct)
  let slider: HTMLInputElement | undefined = $state()

  onMount(() => slider?.focus())

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    onconfirm(Math.round(value))
  }
</script>

<form class="hb-render confidence" onsubmit={submit}>
  <fieldset>
    <legend id="{uid}-legend">{CONFIDENCE_LEGEND}</legend>
    <div class="row">
      <input
        id="{uid}-range"
        type="range"
        min={floorPct}
        max={100}
        step={1}
        bind:value
        bind:this={slider}
        aria-labelledby="{uid}-legend"
        aria-valuetext={confidenceValue(value)}
        aria-describedby="{uid}-hint"
      />
      <output for="{uid}-range" class="value">{value}%</output>
    </div>
    <p class="hint" id="{uid}-hint">{confidenceHint(floorPct, optionsCount)}</p>
    <button type="submit" class="hb-btn hb-primary">{CONFIDENCE_CONTINUE}</button>
  </fieldset>
</form>

<style>
  .confidence {
    margin: 1rem 0;
  }

  fieldset {
    margin: 0;
    padding: 0.75rem 1rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    min-width: 0;
  }

  legend {
    padding: 0 0.25rem;
    font-weight: 600;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0.5rem 0;
  }

  input[type='range'] {
    flex: 1;
    min-width: 0;
    height: 2.75rem;
    accent-color: var(--r-accent);
  }

  input[type='range']:focus-visible {
    outline: 3px solid var(--r-focus);
    outline-offset: 2px;
  }

  .value {
    flex: none;
    min-width: 3.5rem;
    font-size: 1.375rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .hint {
    margin: 0 0 1rem;
    color: var(--r-muted);
    max-width: 38rem;
  }
</style>
