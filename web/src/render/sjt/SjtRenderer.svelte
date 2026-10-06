<!--
  Situational judgment renderer (ROADMAP M6.2; DESIGN §3 row 16, §5.2, §5.3, §13, R-5.6.2): a short situation, a question,
  and four responses (A to D) to rate. The skill is named "Emotion Reading (text scenarios)" (`EMO_AXIS_NAME`), and its
  tooltip is the R-5.6.2 sentence word for word followed by the note of this facet (`FACET_NOTE`: it measures agreement
  with typical and expert judgments, rewards conventional choices and overlaps with reading and vocabulary skills, which
  §5.2 and §5.3 say the page must say), opened from a button (`../emotion/SkillTip.svelte`, imported as it is).

  Two ways to answer (`mode`):
  - 'rate' (the default): each response is its own group of four native radio inputs, 1 "Very ineffective" to 4 "Very
    effective"; `onrespond` gets the four ratings in display order, once, when all four are set and Confirm is pressed;
  - 'most_least': two groups of four radio inputs, "Which response would work best?" and "Which response would work
    least well?"; `onrespond` gets `{ most, least }`, two different display positions. Choosing the same response for
    both says so in a note (a live region) and keeps Confirm off.

  Takes only the item's `spec` (the situation, the question and the four responses in display order, A18; never the
  key). The radios are native inputs, so the browser supplies the group semantics and the arrow keys; while focus is
  inside a group, the keys 1 to 4 pick that level (rate mode) or that response (most/least mode, also A to D) (WCAG 2.1.4:
  only while a control of the form has focus), and Enter on a radio answers once the answer is complete. `onshown(t)`
  reports the timestamp of the first animation frame showing the item (rAF clock = performance.now(), §11.6) and the
  inputs accept a choice only from then on, so no response exists without an onset (the contract of `visual.ts`).
  Nothing is written to the DOM that depends on the key: no data attribute, no class or id with a rating in it
  (`sjt.dom.test.ts`). No animation. The wording never says whether a choice is right.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import '../common/render.css'
  import { optionIndexForKey, optionLetter } from '../choice/keys'
  import { browserTiming, type RendererProps } from '../common/props'
  import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../../copy'
  import { ENTRY_COPY, FACET_NOTE, SCALE_LABELS, progressText } from '../../tasks/sjt/copy'
  import { RATING_LEVELS, type SjtMode, type SjtResponse, type SjtSpec } from '../../tasks/sjt/spec'
  import SkillTip from '../emotion/SkillTip.svelte'

  interface Props extends RendererProps<SjtSpec, SjtResponse> {
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    readonly onshown?: (onsetMs: number) => void
    /** Blocks responding (e.g. while the session is paused). */
    readonly disabled?: boolean
    /** Rate each response 1 to 4 (default), or choose the one that would work best and the one that would work least well. */
    readonly mode?: SjtMode
  }

  let { spec, onrespond, onshown, timing, disabled = false, mode = 'rate' }: Props = $props()

  const uid = $props.id()
  const levels = Array.from({ length: RATING_LEVELS }, (_v, i) => i + 1)
  /** The rating of each response (rate mode); null until it is set. */
  let ratings: (number | null)[] = $state(untrack(() => spec.responses.map(() => null)))
  let most: number | null = $state(null)
  let least: number | null = $state(null)
  let submitted = $state(false)
  let shown = $state(false)
  let form: HTMLFormElement | undefined = $state()

  const locked = $derived(disabled || submitted || !shown)
  const rated = $derived(ratings.filter((r) => r !== null).length)
  const same = $derived(mode === 'most_least' && most !== null && most === least)
  const complete = $derived(mode === 'rate' ? rated === spec.responses.length : most !== null && least !== null && most !== least)

  /** The radio of group `name` with value `value`, to move focus to it. */
  function radio(name: string, value: number): HTMLInputElement | undefined {
    return [...(form?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])].find((r) => r.name === name && r.value === String(value))
  }

  function submit(): void {
    if (locked || !complete) return
    submitted = true
    onrespond(mode === 'rate' ? ratings.map((r) => r as number) : { most: most as number, least: least as number })
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
      const target = e.target
      if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
        return
      }
      if (locked) return
      if (mode === 'rate') {
        const m = /-r(\d+)$/.exec(target.name)
        const level = /^[1-4]$/.test(e.key) ? Number(e.key) : null
        if (m === null || level === null) return
        e.preventDefault()
        ratings[Number(m[1])] = level
        radio(target.name, level)?.focus()
      } else {
        const position = optionIndexForKey(e.key, spec.responses.length)
        if (position === null) return
        e.preventDefault()
        if (target.name.endsWith('-most')) most = position
        else if (target.name.endsWith('-least')) least = position
        radio(target.name, position)?.focus()
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

<section class="hb-render sjt" aria-labelledby="{uid}-title">
  <div class="head">
    <p class="title" id="{uid}-title">{EMO_AXIS_NAME}</p>
    <SkillTip name={EMO_AXIS_NAME} text="{EMO_TOOLTIP} {FACET_NOTE}" label={ENTRY_COPY.tipButton} hint={ENTRY_COPY.tipClose} />
  </div>
  <p class="hb-instructions">{mode === 'rate' ? ENTRY_COPY.instructions : ENTRY_COPY.instructionsMostLeast}</p>
  <!-- The label sits on a group, not on the paragraph: a paragraph has no role that may be named (ARIA 1.2). -->
  <div role="group" aria-label={ENTRY_COPY.scenarioLabel}>
    <p class="scenario">{spec.scenario}</p>
  </div>
  <form bind:this={form} class="choices" {onsubmit}>
    <fieldset class="responses" disabled={locked}>
      <legend>{mode === 'rate' ? spec.question : ENTRY_COPY.legendMostLeast}</legend>
      {#if mode === 'rate'}
        {#each spec.responses as response, i (i)}
          <div class="item">
            <fieldset class="response">
              <legend><span class="letter">{optionLetter(i)}.</span> {response}</legend>
              <div class="levels">
                {#each levels as level (level)}
                  <label class="level">
                    <input type="radio" name="{uid}-r{i}" value={level} bind:group={ratings[i]} />
                    <span class="lbl"><span class="num">{level}</span> <span class="word">{SCALE_LABELS[level - 1]}</span></span>
                  </label>
                {/each}
              </div>
            </fieldset>
          </div>
        {/each}
      {:else}
        <div class="item">
          <fieldset class="response">
            <legend>{ENTRY_COPY.most}</legend>
            <div class="options">
              {#each spec.responses as response, i (i)}
                <label class="option">
                  <input type="radio" name="{uid}-most" value={i} bind:group={most} />
                  <span class="lbl"><span class="letter">{optionLetter(i)}.</span> {response}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        </div>
        <div class="item">
          <fieldset class="response">
            <legend>{ENTRY_COPY.least}</legend>
            <div class="options">
              {#each spec.responses as response, i (i)}
                <label class="option">
                  <input type="radio" name="{uid}-least" value={i} bind:group={least} />
                  <span class="lbl"><span class="letter">{optionLetter(i)}.</span> {response}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        </div>
      {/if}
    </fieldset>
    {#if mode === 'rate' && !submitted}
      <p class="progress">{progressText(rated, spec.responses.length)}</p>
    {/if}
    <p class="hb-note" aria-live="polite">{same ? ENTRY_COPY.mostLeastSame : ''}</p>
    <p class="hb-status" aria-live="polite">{submitted ? ENTRY_COPY.recorded : ''}</p>
    <button type="submit" class="hb-btn hb-primary" disabled={locked || !complete}>{ENTRY_COPY.submit}</button>
  </form>
</section>

<style>
  .sjt {
    padding: 0.5rem 0;
    max-width: 40rem;
  }

  .head {
    position: relative; /* the frame of the tooltip panel (SkillTip) */
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin: 0 0 0.75rem;
  }

  .title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .scenario {
    margin: 0 0 1rem;
    font-size: 1.0625rem;
    line-height: 1.6;
    overflow-wrap: break-word;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin: 0 0 0.5rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  /* The responses are told apart by a line between them, drawn on a wrapper: on the fieldset itself the legend would sit in the line. */
  .item + .item {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--r-border);
  }

  .letter {
    font-weight: 700;
  }

  .levels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(8rem, 100%), 1fr));
    gap: 0.5rem;
  }

  .options {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
  }

  .level,
  .option {
    min-width: 0;
    min-height: 2.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    cursor: pointer;
  }

  /* A level: the radio over its number and its words, so four of them share a row and the words get the width of the tile. */
  .level {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem;
    text-align: center;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem 0.75rem;
  }

  .level input,
  .option input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    flex: none;
    accent-color: var(--r-accent);
  }

  .lbl {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .level .lbl {
    font-size: 0.9375rem;
  }

  .num {
    font-weight: 700;
  }

  /* The chosen one is marked by a thicker border and bold text, not by colour alone. */
  .level:has(input:checked),
  .option:has(input:checked) {
    border-color: var(--r-accent);
    box-shadow: inset 0 0 0 1px var(--r-accent);
    font-weight: 600;
  }

  fieldset:disabled .level,
  fieldset:disabled .option {
    cursor: default;
  }

  .progress {
    margin: 0.75rem 0 0;
    color: var(--r-muted);
  }

  .choices .hb-primary {
    margin-top: 0.25rem;
  }
</style>
