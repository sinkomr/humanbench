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
  - Focus is always visible (the amber 3 px ring every control of the session has), and the chosen
    card is marked by a thicker frame and an inverted letter, not by colour alone. No transitions or
    animations. Confirm is the session's primary button (`hb-btn hb-primary`).
  - The second tap of a double tap on the button of the previous screen lands on whatever the new
    screen has under the finger, here an option (SKIM-15): a touch tap that repeats the spot of a
    touch tap made before the group appeared, in the first 350 ms after it appeared, selects
    nothing. A tap anywhere else, a later tap, and mouse, pen and keyboard selection are never held
    back (so a tap that is only fast, like the e2e drivers', still selects).
  - `flush` draws a card with no padding and no border (a frame outside the figure instead), so the
    figure fills its grid track exactly; the matrices renderer sizes the track like a cell of its grid.
  - Nothing option-specific is written to the DOM except the position (value, letter) and the
    caller's `optionName` text: no key, no correctness hint, no data attributes.
-->
<script module lang="ts">
  /** Where and when (performance.now()) a touch press was. */
  interface Tap {
    readonly x: number
    readonly y: number
    readonly at: number
  }

  /** A pointer press on the page, and the touch press before it. */
  interface Press extends Tap {
    readonly type: string
    readonly before: Tap | null
  }

  let lastTouch: Tap | null = null
  let lastPress: Press | null = null

  // One listener for the page, installed before any group exists: the tap that made the screen
  // change happened on another component.
  if (typeof document !== 'undefined') {
    document.addEventListener(
      'pointerdown',
      (e) => {
        const at = performance.now()
        lastPress = { type: e.pointerType, x: e.clientX, y: e.clientY, at, before: lastTouch }
        if (e.pointerType === 'touch') lastTouch = { x: e.clientX, y: e.clientY, at }
      },
      { capture: true, passive: true },
    )
  }

  /** How long after it appeared a group holds back the repeat of an earlier tap. */
  const SETTLE_MS = 350
  /** How close in time and in space two taps are to be one double tap. */
  const DOUBLE_TAP_MS = 600
  const DOUBLE_TAP_PX = 32

  /** True iff a click made now is the second tap of a double tap whose first tap came before a group appeared at `mountedAt`. */
  function repeatsEarlierTap(mountedAt: number): boolean {
    const now = performance.now()
    const press = lastPress
    if (now - mountedAt >= SETTLE_MS || press === null || press.type !== 'touch' || now - press.at > DOUBLE_TAP_MS) return false
    const first = press.before
    return first !== null && first.at < mountedAt && press.at - first.at <= DOUBLE_TAP_MS && Math.hypot(press.x - first.x, press.y - first.y) <= DOUBLE_TAP_PX
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import '../common/render.css'
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
    /** Cards without padding or border: the figure fills its grid track. */
    flush?: boolean
    /** The widest the grid of options may be (a CSS length); omitted = the whole width. */
    maxWidth?: string
  }

  let { count, legend, optionName, option, onrespond, disabled = false, columns = { narrow: 2, wide: 4 }, flush = false, maxWidth }: Props = $props()

  const mountedAt = performance.now()

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

  /** Holds back the repeat of an earlier tap while the group is still settling; leaves the radio as it was. */
  function onoptionclick(e: MouseEvent): void {
    if (repeatsEarlierTap(mountedAt)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
</script>

<form bind:this={form} class="choice hb-render" {onsubmit}>
  <fieldset disabled={locked}>
    <legend>{legend}</legend>
    <div class="options" class:flush style:--narrow={String(columns.narrow)} style:--wide={String(columns.wide)} style:--max={maxWidth}>
      {#each indices as i (i)}
        <label class="option">
          <input type="radio" name={uid} value={i} bind:group={selected} bind:this={inputs[i]} aria-label={optionName(i)} onclick={onoptionclick} />
          <span class="card">
            <span class="figure">{@render option(i)}</span>
            <span class="letter" aria-hidden="true">{optionLetter(i)}</span>
          </span>
        </label>
      {/each}
    </div>
  </fieldset>
  <button type="submit" class="hb-btn hb-primary" disabled={locked || selected === null}>{CONFIRM_LABEL}</button>
</form>

<style>
  .choice {
    --hb-card-border: #767676;
    --hb-chosen: var(--text-strong, #0b0a0f);
    --hb-surface: var(--bg, #ffffff);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* `screen`: paper stays light, as in app.css and render.css (the card border is drawn on white). */
  @media screen and (prefers-color-scheme: dark) {
    .choice {
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
    max-width: var(--max, none);
  }

  .options.flush {
    gap: 0.5rem;
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

  /* No padding, no border: the figure is as wide as its track and the frame is drawn outside it. */
  .flush .card {
    padding: 0 0 0.375rem;
    border: 0;
    border-radius: 0.25rem;
    box-shadow: 0 0 0 2px var(--hb-card-border);
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

  /* Chosen: a thicker frame and an inverted letter (not colour alone). */
  input:checked + .card {
    border-color: var(--hb-chosen);
    box-shadow: 0 0 0 2px var(--hb-chosen);
  }

  .flush input:checked + .card {
    box-shadow: 0 0 0 4px var(--hb-chosen);
  }

  input:checked + .card .letter {
    border-color: var(--hb-chosen);
    background: var(--hb-chosen);
    color: var(--hb-surface);
  }

  /* The amber ring of render.css (the form is an .hb-render): one focus colour for every control of the session. */
  input:focus-visible + .card {
    outline: 3px solid var(--r-focus);
    outline-offset: 2px;
  }

  .flush input:focus-visible + .card {
    outline-offset: 4px;
  }

  /* Confirm keeps its own width and the left edge (more specific than the shared button rule). */
  .choice > .hb-btn {
    align-self: flex-start;
    min-width: 8rem;
  }
</style>
