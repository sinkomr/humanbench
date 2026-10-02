<!--
  Emotion vignette renderer (ROADMAP M6.1; DESIGN §3 row 16, §5.1, §13, R-5.6.2): a short situation about a
  made-up person, then five feelings to choose from. The skill is named "Emotion Reading (text scenarios)"
  (`EMO_AXIS_NAME`) with its tooltip, the R-5.6.2 sentence word for word (`EMO_TOOLTIP`), opened from a
  button (`SkillTip.svelte`).

  Takes only the item's `spec` (the stem and the five options in display order, A18; never the key, the
  appraisal profile or the rule-engine emotion). The options are native radio inputs, so the browser
  supplies the group semantics and the arrow keys; keys 1 to 5 and A to E pick an option while focus is
  inside the group (WCAG 2.1.4), and Enter on an option or the Confirm button answers, as in the other
  multiple-choice renderers (`choice/keys.ts`). `onrespond(index)` is called once with the display
  position, the response every multiple-choice family scores (`mcResponseIndex`). `onshown(t)` reports the
  timestamp of the first animation frame showing the item (rAF clock = performance.now(), §11.6) and the
  options accept a choice only from then on, so no response exists without an onset (the contract of
  `visual.ts`). Nothing option-specific is written to the DOM but the position (`value`) and the option's
  own text: no data attribute, no class or id that depends on the key (`emotion.dom.test.ts`). No
  animation. The wording never says whether a choice is right.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../common/render.css'
  import { CONFIRM_LABEL, optionIndexForKey } from '../choice/keys'
  import { browserTiming, type RendererProps } from '../common/props'
  import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../../copy'
  import { ENTRY_COPY } from '../../tasks/emotion/copy'
  import { splitStem, type EmotionResponse, type EmotionSpec } from '../../tasks/emotion/spec'
  import SkillTip from './SkillTip.svelte'

  interface Props extends RendererProps<EmotionSpec, EmotionResponse> {
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    readonly onshown?: (onsetMs: number) => void
    /** Blocks responding (e.g. while the session is paused). */
    readonly disabled?: boolean
  }

  let { spec, onrespond, onshown, timing, disabled = false }: Props = $props()

  const uid = $props.id()
  const parts = $derived(splitStem(spec.stem))
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

<section class="hb-render emotion" aria-labelledby="{uid}-title">
  <div class="head">
    <p class="title" id="{uid}-title">{EMO_AXIS_NAME}</p>
    <SkillTip name={EMO_AXIS_NAME} text={EMO_TOOLTIP} label={ENTRY_COPY.tipButton} hint={ENTRY_COPY.tipClose} />
  </div>
  <p class="hb-instructions">{ENTRY_COPY.instructions}</p>
  <p class="scenario" aria-label={ENTRY_COPY.scenarioLabel}>{parts.scenario}</p>
  <form bind:this={form} class="choices" {onsubmit}>
    <fieldset disabled={locked}>
      <legend>{parts.question ?? ENTRY_COPY.legendFallback}</legend>
      <div class="options">
        {#each spec.options as option, i (i)}
          <label class="option">
            <input type="radio" name={uid} value={i} bind:group={selected} bind:this={inputs[i]} />
            <span class="word">{option}</span>
          </label>
        {/each}
      </div>
    </fieldset>
    <p class="hb-status" aria-live="polite">{submitted ? ENTRY_COPY.recorded : ''}</p>
    <button type="submit" class="hb-btn hb-primary" disabled={locked || selected === null}>{CONFIRM_LABEL}</button>
  </form>
</section>

<style>
  .emotion {
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
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
    gap: 0.5rem;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.75rem;
    padding: 0.375rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    cursor: pointer;
  }

  .option input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    flex: none;
    accent-color: var(--r-accent);
  }

  /* The chosen option is marked by a thicker border and bold text, not by colour alone. */
  .option:has(input:checked) {
    border-color: var(--r-accent);
    box-shadow: inset 0 0 0 1px var(--r-accent);
    font-weight: 600;
  }

  fieldset:disabled .option {
    cursor: default;
  }

  .choices .hb-primary {
    margin-top: 0.25rem;
  }
</style>
