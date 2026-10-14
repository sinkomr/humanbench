<!--
  Text multiple-choice renderer for a served question (ROADMAP M3.11 phase 1; DESIGN §3 rows 2, 5, 13 to
  15, §10, §11.2, §11.6, §13, R-11.1): a text to read (when there is one), the question, and two to six
  options as text.

  Takes only the item's `spec` (`spec.ts`: the stem, the stimulus paragraphs and the options in the
  order the server sent them); the page holds no key and no verdict for a served question, so nothing
  here could show one. **Every string is written as text** (Svelte text interpolation, never `{@html}`):
  what the server sends is data, and a stem that contains markup is shown as the characters it is.

  - The options are native radio inputs in one column, so the browser supplies the group semantics and
    the arrow keys; the question is the group's legend, so a screen reader announces it with the first
    option. Each option's name is its letter and its text ("B. …", set on the radio so every engine reads it
    the same way); both are visible in the row (WCAG 2.5.3).
  - Keys 1 to 6 and A to F pick an option while focus is inside the group (WCAG 2.1.4); Enter on an
    option or the Confirm button answers, as in the other multiple-choice renderers (`choice/keys.ts`).
  - `onrespond(index)` is called once with the display position. `onshown(t)` reports the timestamp of
    the first animation frame showing the item (rAF clock = performance.now(), §11.6), and the options
    accept a choice only from then on, so no response exists without an onset (the contract of `visual.ts`).
  - The whole option row is the target (at least 44 px high); the chosen one is marked by a thicker frame
    and an inverted letter, not by colour alone. Long words and long options wrap inside the column, at
    320 px and with a wide font, and the reading column is capped at a comfortable line length.
  - In a session the optional confidence scale (`common/answer-slot.ts`) sits between the options and Confirm,
    inside the form: Confirm sends both with one press.
  - Nothing option-specific is in the DOM but the position (`value`, the letter) and the option's own text:
    no data attribute, class or id depends on anything else (`text.dom.test.ts`). No animation. The wording
    never says whether a choice is right (§10).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  // No `import '../common/render.css'` here: the session's screen and the dev demo's page already load it, and this
  // component is both in the entry chunk and imported by a dev demo, which made the bundler split that stylesheet
  // out and link it after the entry's (scripts/dev-routes.test.ts keeps it in the entry stylesheet).
  import { CONFIRM_LABEL, optionIndexForKey, optionLetter } from '../choice/keys'
  import { getAnswerSlot } from '../common/answer-slot'
  import { browserTiming, type RendererProps } from '../common/props'
  import { TEXT_MC_COPY } from './copy'
  import { splitTextStem, type TextMcResponse, type TextMcSpec } from './spec'

  /** The name of an option for assistive technology: its letter, then its text ("B. …"), both of which are on screen. */
  const optionName = (i: number, text: string): string => `${optionLetter(i)}. ${text}`

  interface Props extends RendererProps<TextMcSpec, TextMcResponse> {
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    readonly onshown?: (onsetMs: number) => void
    /** Part of the shared renderer props (`visual.ts`); never called: text always draws. */
    readonly onunavailable?: () => void
    /** Blocks responding (e.g. while the question cannot be shown). */
    readonly disabled?: boolean
  }

  let { spec, onrespond, onshown, timing, disabled = false }: Props = $props()

  const uid = $props.id()
  /** The session's control before Confirm (the optional confidence scale, owner decision 2026-10-13), or none. */
  const slot = getAnswerSlot()
  const stem = $derived(splitTextStem(spec.stem))
  /** What is read before the question: the stimulus, then the stem's paragraphs before its last. */
  const reading = $derived([...spec.stimulus, ...stem.lead])
  let selected: number | null = $state(null)
  let submitted = $state(false)
  let shown = $state(false)
  let form: HTMLFormElement | undefined = $state()
  const inputs: (HTMLInputElement | undefined)[] = $state([])
  const locked = $derived(disabled || submitted || !shown)

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

  function onsubmit(event: SubmitEvent): void {
    event.preventDefault()
    submit()
  }

  // Character keys are handled on the form, so they act only while focus is inside it (WCAG 2.1.4).
  $effect(() => {
    const el = form
    if (!el) return
    const onkey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return
      const i = optionIndexForKey(e.key, spec.options.length)
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

  onMount(() => {
    // The DOM is drawn when this runs; the next frame is the first to show it (§11.6: rAF-locked onset).
    const frames = (timing ?? browserTiming()).frames
    const h = frames.request((ts) => {
      shown = true
      onshown?.(ts)
    })
    return () => frames.cancel(h)
  })
</script>

<!-- No landmark of its own: the session names the question's region ("Question 3", `question-focus.ts`). -->
<div class="hb-render text-mc">
  {#if reading.length > 0}
    <!-- A named group, not a labelled paragraph: a paragraph has no role that may be named (ARIA 1.2). -->
    <div class="reading" role="group" aria-label={TEXT_MC_COPY.readingLabel}>
      {#each reading as paragraph, i (i)}
        <p>{paragraph}</p>
      {/each}
    </div>
  {/if}
  <form bind:this={form} class="choices" {onsubmit}>
    <fieldset disabled={locked}>
      <legend>{stem.question}</legend>
      <div class="options">
        {#each spec.options as option, i (i)}
          <label class="option">
            <input type="radio" name={uid} value={i} bind:group={selected} bind:this={inputs[i]} aria-label={optionName(i, option)} />
            <span class="letter">{optionLetter(i)}</span>
            <span class="words">{option}</span>
          </label>
        {/each}
      </div>
    </fieldset>
    {#if slot?.snippet}
      {@render slot.snippet()}
    {/if}
    <p class="hb-status" aria-live="polite">{submitted ? TEXT_MC_COPY.recorded : ''}</p>
    <button type="submit" class="hb-btn hb-primary" disabled={locked || selected === null}>{CONFIRM_LABEL}</button>
  </form>
</div>

<style>
  .text-mc {
    padding: 0.5rem 0;
    width: 100%;
    max-width: 42rem;
  }

  /* Text from the server: a line break inside a paragraph is kept, and nothing can run past the column. */
  .reading p,
  legend,
  .words {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .reading {
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    border-left: 4px solid var(--r-border);
    background: var(--r-surface);
    font-size: 1.0625rem;
    line-height: 1.6;
  }

  .reading p {
    margin: 0;
  }

  .reading p + p {
    margin-top: 0.75rem;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin: 0 0 0.75rem;
    max-width: 100%;
    font-size: 1.0625rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .options {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    cursor: pointer;
  }

  .option input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    margin: 0.25rem 0 0;
    accent-color: var(--r-accent);
  }

  .letter {
    flex: none;
    min-width: 1.75rem;
    padding: 0 0.375rem;
    border: 2px solid var(--r-border);
    border-radius: 999px;
    font-weight: 700;
    line-height: 1.5;
    text-align: center;
  }

  .words {
    flex: 1;
    min-width: 0;
    padding-top: 0.125rem;
  }

  /* The chosen option: a thicker frame and an inverted letter, not colour alone. */
  .option:has(input:checked) {
    border-color: var(--r-accent);
    box-shadow: inset 0 0 0 1px var(--r-accent);
  }

  .option:has(input:checked) .letter {
    border-color: var(--r-accent);
    background: var(--r-accent);
    color: var(--r-accent-fg);
  }

  .option:has(input:checked) .words {
    font-weight: 600;
  }

  /* The ring is on the row, which is the target; the radio inside it keeps the browser's own. */
  .option:has(input:focus-visible) {
    outline: 3px solid var(--r-focus);
    outline-offset: 2px;
  }

  .option input:focus-visible {
    outline: none;
  }

  fieldset:disabled .option {
    cursor: default;
  }

  .choices .hb-primary {
    margin-top: 0.25rem;
    min-width: 8rem;
  }
</style>
