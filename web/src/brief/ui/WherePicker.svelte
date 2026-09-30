<script lang="ts">
  /** Step 1: where the notes will be used (context presets), and the person's sets of notes (up to five). */
  import { addContext, choosePreset, removeContext, selectContext, type BuilderState } from '../builder'
  import { PRESET_INFO } from '../contexts'
  import { STEPS } from '../copy'
  import { destination } from '../surfaces'
  import { MAX_CONTEXTS } from '../topics'
  import { PRESETS } from '../types'

  interface Props {
    model: BuilderState
    onchange: (next: BuilderState) => void
  }
  let { model, onchange }: Props = $props()

  const current = $derived(model.contexts[model.active])
  /** A label made from the preset and destination, never typed (so no free text needs storing). */
  const labelOf = (i: number): string => {
    const c = model.contexts[i]
    return c === undefined ? '' : `${PRESET_INFO[c.preset].label}, ${destination(c.destination)?.label ?? 'no destination'}`
  }
</script>

<section aria-labelledby="step-where">
  <h2 id="step-where">1. {STEPS.where.heading}</h2>
  <p>{STEPS.where.hint}</p>

  <div class="row sets" role="group" aria-label="Your sets of notes">
      {#each model.contexts as _c, i (i)}
        <button type="button" aria-pressed={i === model.active} class:selected={i === model.active} onclick={() => onchange(selectContext(model, i))}>
          Set {i + 1}: {labelOf(i)}
        </button>
      {/each}
      <button type="button" disabled={model.contexts.length >= MAX_CONTEXTS} onclick={() => onchange(addContext(model))}>Add another set of notes</button>
      <button type="button" disabled={model.contexts.length <= 1} onclick={() => onchange(removeContext(model, model.active))}>Remove this set</button>
  </div>

  <fieldset>
    <legend>Use for set {model.active + 1}</legend>
    {#each PRESETS as p (p)}
      <label class="choice">
        <input type="radio" name="preset" value={p} checked={current?.preset === p} onchange={() => onchange(choosePreset(model, p))} />
        <span>
          {PRESET_INFO[p].label}
          <span class="hint">{PRESET_INFO[p].blurb}</span>
        </span>
      </label>
    {/each}
  </fieldset>
</section>

<style>
  .sets {
    margin-bottom: 1rem;
  }
  button.selected {
    border-width: 2px;
    font-weight: 600;
  }
</style>
