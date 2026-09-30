<!--
  Choosing the parts of a 20-minute focus session (DESIGN §10 "focus sessions of 20 minutes that
  target chosen axes"; ROADMAP M1.R). One checkbox per A15 part, the parts that hold the widest
  ranges ticked to begin with; the person chooses, and starting with none ticked asks for a choice.
  Used on the results and on the start screen of a returning person.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { AxisCode } from '../engine/axes'
  import type { SegmentId } from '../engine/selector'
  import { FOCUS_LEGEND, FOCUS_NONE_SELECTED, FOCUS_START, FOCUS_SUGGESTED } from './copy'
  import { focusAxes, type FocusOption } from './next'
  import './reveal.css'

  interface Props {
    readonly options: readonly FocusOption[]
    /** Start the session on the skills of the chosen parts. */
    readonly onstart: (axes: AxisCode[]) => void
  }

  let { options, onstart }: Props = $props()

  const uid = $props.id()
  let chosen: ReadonlySet<SegmentId> = $state.raw(untrack(() => new Set(options.filter((o) => o.suggested).map((o) => o.segment))))
  let problem = $state('')

  function toggle(id: SegmentId, on: boolean): void {
    const next = new Set(chosen)
    if (on) next.add(id)
    else next.delete(id)
    chosen = next
    problem = ''
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const axes = focusAxes(options, chosen)
    if (axes.length === 0) {
      problem = FOCUS_NONE_SELECTED
      return
    }
    onstart(axes)
  }
</script>

<form onsubmit={submit} novalidate data-focus-form>
  <fieldset aria-describedby={problem === '' ? undefined : `${uid}-problem`}>
    <legend>{FOCUS_LEGEND}</legend>
    {#each options as o (o.segment)}
      <div class="check">
        <input id="{uid}-{o.segment}" type="checkbox" checked={chosen.has(o.segment)} onchange={(e) => toggle(o.segment, e.currentTarget.checked)} />
        <label for="{uid}-{o.segment}">{o.title}{#if o.suggested} <span class="suggested">({FOCUS_SUGGESTED})</span>{/if}</label>
      </div>
    {/each}
  </fieldset>
  {#if problem !== ''}
    <p class="error" id="{uid}-problem" role="alert">{problem}</p>
  {/if}
  <div class="hb-actions">
    <button type="submit" class="hb-btn hb-primary">{FOCUS_START}</button>
  </div>
</form>

<style>
  .suggested {
    color: var(--r-muted);
  }
  fieldset {
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    min-width: 0;
  }
  legend {
    padding: 0 0.25rem;
    font-weight: 600;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.75rem;
  }
  .check input {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    margin: 0;
  }
  .error {
    color: var(--r-note);
    margin: 0.5rem 0;
  }
</style>
