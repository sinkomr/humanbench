<!--
  Multiple-choice option group shared by the visual renderers (ROADMAP M1.13, A18; DESIGN §13).

  - Options are native radio inputs, one per display position 0 … count − 1, in that order (the
    `spec.options` order; nothing here sorts, keys or reorders them). Each radio is stretched,
    transparent, over its card, so the whole card is the click and touch target (WCAG 2.5.8) and
    the browser supplies radio-group semantics and arrow-key navigation.
  - The accessible name of option i is `optionName(i)`; the card's figure is decorative for
    assistive tech (the name describes it), and the visible letter is part of the name.
  - Keys `1`–`9` / `a`–`i` pick an option, Enter on an option or the Confirm button responds
    (see `keys.ts`). `onrespond(index)` is called once, with the display position, which is the
    MC response every item family's `score()` takes (`mcResponseIndex`, contract v2).
  - Focus is always visible (a 3 px ring outside the card), and the chosen card is marked by a
    thicker border and an inverted letter, not by colour alone. No transitions or animations.
  - Nothing option-specific is written to the DOM except the position (value, letter) and the
    caller's `optionName` text: no key, no correctness hint, no data attributes.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { CONFIRM_LABEL, MAX_OPTIONS, optionIndexForKey, optionLetter } from './keys'

  interface Props {
    /** Number of options (≤ 9). */
    count: number
    /** Visible legend of the group. */
    legend: string
    /** Accessible name of the option at display position i (must include its letter). */
    optionName: (index: number) => string
    /** The option's figure. */
    option: Snippet<[number]>
    /** Called once with the chosen display position. */
    onrespond: (index: number) => void
    disabled?: boolean
    /** Grid columns on narrow and on wide screens. */
    columns?: { readonly narrow: number; readonly wide: number }
  }

  let { count, legend, optionName, option, onrespond, disabled = false, columns = { narrow: 2, wide: 4 } }: Props = $props()

  const uid = $props.id()
  let selected: number | null = $state(null)
  let submitted = $state(false)
  let form: HTMLFormElement | undefined = $state()
  const inputs: (HTMLInputElement | undefined)[] = $state([])
  const indices = $derived.by(() => {
    if (!(Number.isInteger(count) && count >= 1 && count <= MAX_OPTIONS)) throw new RangeError(`option group: count must be 1–${MAX_OPTIONS}, got ${count}`)
    return Array.from({ length: count }, (_, i) => i)
  })
  const locked = $derived(disabled || submitted)

  function choose(i: number): void {
    if (locked) return
    selected = i
    inputs[i]?.focus()
  }

  function submit(): void {
    if (locked || selected === null) return
    submitted = true
    onrespond(selected)
  }

  // Character keys are handled on the form, so they act only while focus is inside it (WCAG 2.1.4).
  $effect(() => {
    const el = form
    if (!el) return
    const onkey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return
      const i = optionIndexForKey(e.key, count)
      if (i !== null) {
        e.preventDefault()
        choose(i)
      } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'radio') {
        e.preventDefault()
        submit()
      }
    }
    el.addEventListener('keydown', onkey)
    return () => el.removeEventListener('keydown', onkey)
  })

  function onsubmit(e: SubmitEvent): void {
    e.preventDefault()
    submit()
  }
</script>

<form bind:this={form} class="choice" {onsubmit}>
  <fieldset disabled={locked}>
    <legend>{legend}</legend>
    <div class="options" style:--narrow={String(columns.narrow)} style:--wide={String(columns.wide)}>
      {#each indices as i (i)}
        <label class="option">
          <input type="radio" name={uid} value={i} bind:group={selected} bind:this={inputs[i]} aria-label={optionName(i)} />
          <span class="card">
            <span class="figure">{@render option(i)}</span>
            <span class="letter" aria-hidden="true">{optionLetter(i)}</span>
          </span>
        </label>
      {/each}
    </div>
  </fieldset>
  <button type="submit" disabled={locked || selected === null}>{CONFIRM_LABEL}</button>
</form>

<style>
  .choice {
    --hb-focus: #1a5fb4;
    --hb-card-border: #767676;
    --hb-chosen: var(--text-strong, #0b0a0f);
    --hb-surface: var(--bg, #ffffff);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  @media (prefers-color-scheme: dark) {
    .choice {
      --hb-focus: #8cb4ff;
      --hb-card-border: #8d8b95;
    }
  }

  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 0.5rem;
    font-weight: 600;
  }

  .options {
    display: grid;
    grid-template-columns: repeat(var(--narrow), minmax(0, 1fr));
    gap: 0.75rem;
  }

  @media (min-width: 40rem) {
    .options {
      grid-template-columns: repeat(var(--wide), minmax(0, 1fr));
    }
  }

  .option {
    position: relative;
    display: block;
    min-width: 0;
  }

  /* The radio covers its whole card: the card is the target, the radio the semantics. */
  input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  input:disabled {
    cursor: default;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem;
    border: 2px solid var(--hb-card-border);
    border-radius: 0.5rem;
    background: var(--hb-surface);
  }

  .figure {
    display: block;
    width: 100%;
    line-height: 0;
  }

  .letter {
    min-width: 2rem;
    padding: 0 0.5rem;
    border: 2px solid transparent;
    border-radius: 999px;
    font-weight: 700;
    line-height: 1.5;
    text-align: center;
    color: var(--text-strong, #0b0a0f);
  }

  /* Chosen: thicker border and an inverted letter (not colour alone). */
  input:checked + .card {
    border-color: var(--hb-chosen);
    box-shadow: 0 0 0 2px var(--hb-chosen);
  }

  input:checked + .card .letter {
    border-color: var(--hb-chosen);
    background: var(--hb-chosen);
    color: var(--hb-surface);
  }

  input:focus-visible + .card {
    outline: 3px solid var(--hb-focus);
    outline-offset: 4px;
  }

  button {
    align-self: flex-start;
    min-height: 2.75rem;
    min-width: 8rem;
    padding: 0.5rem 1.25rem;
    border: 2px solid var(--hb-chosen);
    border-radius: 0.5rem;
    background: var(--hb-chosen);
    color: var(--hb-surface);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    border-color: var(--hb-card-border);
    background: transparent;
    color: var(--text, #3d3a44);
    cursor: default;
  }

  button:focus-visible {
    outline: 3px solid var(--hb-focus);
    outline-offset: 3px;
  }
</style>
