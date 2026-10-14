<!--
  The optional confidence scale (owner decision 2026-10-13; ROADMAP M1.15; DESIGN §3 row 12, §13, §14.6 ex. 9):
  "How sure are you?" on the question screen itself, just above the question's own submit button (the renderer
  draws it there through `render/common/answer-slot.ts`), so one press of that button sends the answer and, if
  set, the confidence. There is no step after the answer.

  - Five points from the chance level ("a guess": 1/k for k options, 0% for typed entry) to 100% ("certain"),
    `confidenceLevels`. Native radio inputs, so the browser supplies the group semantics and the arrow keys; the
    whole pill is the 44 px target.
  - **It starts unset, visibly**: no point is filled and the line says "Not set". One click, tap, Space or arrow
    key sets it; "Clear" (in the place of "Not set") unsets it and hands focus back to the scale. Unset means no
    confidence is recorded (null), never a default value.
  - Keys typed here stay here: the renderer's form picks an answer with 1–9 / A–I, which must not happen while
    focus is on the scale. Enter submits the answer (the form's own submit, as Enter on an option does); a held
    or repeated Enter does not.
  - Compact and quiet: one row of small pills under a one-line legend, the ends' meaning in a muted line below.
    The pills wrap with large text or a wide font rather than run past a 320 px screen.
  - The second tap of a double tap on the previous question's submit button sets nothing (`render/common/double-tap.ts`,
    as the option cards do): the scale sits just above that button, where such a tap lands.
  - Nothing about right or wrong is shown (§10).
-->
<script lang="ts">
  import { submitClosestForm } from '../render/common/answer-slot'
  import { repeatsEarlierTap } from '../render/common/double-tap'
  import { confidenceLevels } from './calibration'
  import { CONFIDENCE_CLEAR, CONFIDENCE_LEGEND, CONFIDENCE_OPTIONAL, CONFIDENCE_UNSET, confidenceEnds, confidenceHint, confidencePointName } from './copy'

  interface Props {
    /** The lowest point, in percent: the chance level for k options, 0 for typed entry. */
    readonly floorPct: number
    readonly optionsCount: number | null
    /** Called with the chosen point, or null when it is cleared. */
    readonly onchange: (pct: number | null) => void
    readonly disabled?: boolean
  }

  let { floorPct, optionsCount, onchange, disabled = false }: Props = $props()

  const uid = $props.id()
  const mountedAt = performance.now()
  const levels = $derived(confidenceLevels(floorPct))
  const ends = $derived(confidenceEnds(floorPct))
  let value: number | null = $state(null)
  const inputs: (HTMLInputElement | undefined)[] = $state([])
  let group: HTMLFieldSetElement | undefined = $state()

  /** The second tap of a double tap on the previous question's submit button sets nothing here (SKIM-15). */
  function onpointclick(e: MouseEvent): void {
    if (repeatsEarlierTap(mountedAt)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function changed(): void {
    onchange(value)
  }

  function clear(): void {
    value = null
    onchange(null)
    // The button that had focus is gone: focus goes back to the scale's first point (focusing a radio does not check it).
    inputs[0]?.focus()
  }

  // The keys of the points, handled on the group (as the option group does) before the answer form sees them.
  $effect(() => {
    const el = group
    if (!el) return
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat && !event.isComposing && !disabled) submitClosestForm(el)
        return
      }
      // A character key here is not the answer form's shortcut (1–9, A–I pick an option there).
      if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) event.stopPropagation()
    }
    el.addEventListener('keydown', keydown)
    return () => el.removeEventListener('keydown', keydown)
  })
</script>

<fieldset class="confidence" {disabled} aria-describedby="{uid}-hint" bind:this={group} data-confidence>
  <legend class="head">
    <span class="legend">{CONFIDENCE_LEGEND}</span>
    <span class="optional">{CONFIDENCE_OPTIONAL}</span>
  </legend>
  <div class="state">
    {#if value === null}
      <span class="unset" data-confidence-unset>{CONFIDENCE_UNSET}</span>
    {:else}
      <button type="button" class="clear" onclick={clear}>{CONFIDENCE_CLEAR}</button>
    {/if}
  </div>
  <div class="points">
    {#each levels as pct, i (pct)}
      <label class="point">
        <input type="radio" name={uid} value={pct} bind:group={value} bind:this={inputs[i]} onclick={onpointclick} onchange={changed} aria-label={confidencePointName(pct, floorPct)} />
        <span class="pill" aria-hidden="true" translate="no">{pct}%</span>
      </label>
    {/each}
  </div>
  <p class="ends" aria-hidden="true"><span>{ends.low}</span><span>{ends.high}</span></p>
  <p class="hb-sr-only" id="{uid}-hint">{confidenceHint(floorPct, optionsCount)}</p>
</fieldset>

<style>
  .confidence {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.25rem 0.75rem;
    margin: 0.25rem 0 0.75rem;
    padding: 0;
    border: 0;
    min-width: 0;
    max-width: 26rem;
  }

  /* The legend is laid out as the grid's first cell (float takes it out of the fieldset's border slot). */
  .head {
    float: left;
    grid-column: 1;
    grid-row: 1;
    padding: 0;
    margin: 0;
    font-size: 0.9375rem;
  }

  .legend {
    font-weight: 600;
  }

  .optional {
    margin-left: 0.375rem;
    color: var(--r-muted);
  }

  .state {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-height: 2.75rem;
  }

  .unset {
    font-size: 0.875rem;
    color: var(--r-muted);
  }

  .clear {
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: 0 0.75rem;
    border: 0;
    background: transparent;
    color: var(--r-accent);
    font: inherit;
    font-size: 0.9375rem;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }

  .clear:focus-visible {
    outline: 3px solid var(--r-focus);
    outline-offset: 2px;
  }

  .points {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .point {
    position: relative;
    flex: 1 1 0;
    min-width: 2.75rem;
  }

  /* The radio covers its pill: the pill is the target, the radio the semantics. */
  .point input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .pill {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: 2.75rem;
    padding: 0 0.25rem;
    border: 1px solid var(--r-border);
    border-radius: 999px;
    background: var(--r-bg);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--r-fg);
  }

  /* Chosen: filled and a thicker frame, not colour alone. */
  .point input:checked + .pill {
    border: 2px solid var(--r-accent);
    background: var(--r-accent);
    color: var(--r-accent-fg);
    font-weight: 700;
  }

  .point input:focus-visible + .pill {
    outline: 3px solid var(--r-focus);
    outline-offset: 2px;
  }

  .confidence:disabled .point input {
    cursor: default;
  }

  .ends {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 1rem;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--r-muted);
  }
</style>
