<!--
  The confidence slider (ROADMAP M1.15; DESIGN §3 row 12, §14.6 ex. 9): "How sure are you that your
  answer is right?" from the chance level 1/k (multiple choice) or 0 (typed entry) to 100%, in whole
  percent. A native range input, so the arrow keys, Home, End and Page keys work; the value is
  also written out next to it and in `aria-valuetext`. Focus starts on the slider so a keyboard
  user rates straight away. Nothing about right or wrong is shown for a counted item (§10).
  On a phone the whole form is scrolled into view when it appears, "Continue" included (UX-014); a
  held or repeated Enter on the slider does not submit (it is usually the key that answered the item).
  The slider may be confirmed where it starts, but `onconfirm` says whether it was moved: the session
  records an unmoved slider as not rated, so it stays out of the calibration (UX-063).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { CONFIDENCE_CONTINUE, CONFIDENCE_LEGEND, confidenceHint, confidenceValue } from './copy'

  interface Props {
    readonly floorPct: number
    readonly startPct: number
    readonly optionsCount: number | null
    /** `touched`: the person moved the slider (pointer, touch or keys) before confirming. */
    readonly onconfirm: (pct: number, touched: boolean) => void
  }

  let { floorPct, startPct, optionsCount, onconfirm }: Props = $props()

  const uid = $props.id()
  // The starting position of this answer only; the slider then belongs to the person.
  // svelte-ignore state_referenced_locally
  let value = $state(startPct)
  /** The slider was moved at least once (an `input` event), even if it ended where it started. */
  let touched = false
  let slider: HTMLInputElement | undefined = $state()
  let form: HTMLFormElement | undefined = $state()

  onMount(() => {
    // Focus without the browser's own scroll, then bring the whole form (its button too) into view once it is laid out.
    slider?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => form?.scrollIntoView?.({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  })

  /** Enter held down, or repeating after the key that answered the item, must not rate the item. */
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.repeat) event.preventDefault()
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    onconfirm(Math.round(value), touched)
  }
</script>

<form class="hb-render confidence" onsubmit={submit} bind:this={form}>
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
        onkeydown={keydown}
        oninput={() => (touched = true)}
      />
      <output for="{uid}-range" class="value" translate="no">{value}%</output>
    </div>
    <p class="hint" id="{uid}-hint">{confidenceHint(floorPct, optionsCount)}</p>
    <button type="submit" class="hb-btn hb-primary">{CONFIDENCE_CONTINUE}</button>
  </fieldset>
</form>

<style>
  .confidence {
    margin: 1rem 0;
    max-width: 38rem;
  }

  fieldset {
    margin: 0;
    padding: 0.75rem 1rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    min-width: 0;
  }

  /* Inside the frame, not across its edge: a legend of two or three lines on a phone would be cut by the border. */
  legend {
    float: left;
    width: 100%;
    padding: 0;
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  legend + .row {
    clear: both;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0.5rem 0;
  }

  /* The track and the thumb are drawn here so the unfilled track has an edge of at least 3:1 against the page (WCAG 1.4.11);
     the browser's own grey track is about 2:1. The input keeps its 44 px height as the touch target. */
  input[type='range'] {
    flex: 1;
    min-width: 0;
    height: 2.75rem;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    accent-color: var(--r-accent);
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 0.5rem;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  input[type='range']::-moz-range-track {
    height: 0.5rem;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    box-sizing: border-box;
    width: 1.5rem;
    height: 1.5rem;
    margin-top: calc((0.5rem + 2px - 1.5rem) / 2);
    border: 2px solid var(--r-bg);
    border-radius: 50%;
    background: var(--r-accent);
    box-shadow: 0 0 0 1px var(--r-accent);
  }

  input[type='range']::-moz-range-thumb {
    box-sizing: border-box;
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--r-bg);
    border-radius: 50%;
    background: var(--r-accent);
    box-shadow: 0 0 0 1px var(--r-accent);
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
