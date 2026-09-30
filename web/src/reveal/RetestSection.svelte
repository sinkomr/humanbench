<!--
  Retest motivation (DESIGN §10 "Retest motivation"; ROADMAP M1.R): what another session would buy
  (the predicted shrinkage of §7.6), which skills have the widest ranges, an optional 20-minute focus
  session on chosen parts, and the advice to leave at least 7 days between sessions. Wide ranges are
  described as uncertainty, never as weakness (R-5.6.4). The focus session runs only the parts the
  person picks (`RunConfig.focus`); the flow calls `onfocus` with their skills.
-->
<script lang="ts">
  import type { AxisCode } from '../engine/axes'
  import { formatTheta } from '../viz/geometry'
  import type { AxisEstimate } from '../viz/profile'
  import {
    FOCUS_HEADING,
    FOCUS_SAVE_FIRST,
    FOCUS_TEXT,
    FUZZIEST_HEADING,
    FUZZIEST_NONE,
    FUZZIEST_NOTE,
    RETEST_HEADING,
    RETEST_INTRO,
    SHRINKAGE_BASIS,
    SPACING_HEADING,
    SPACING_TEXT,
    shrinkageLine,
  } from './copy'
  import FocusPicker from './FocusPicker.svelte'
  import { focusOptions, focusOptionsKey, fuzziestAxes, shrinkagePercent } from './next'
  import './reveal.css'

  interface Props {
    /** The final estimates of the profile. */
    readonly estimates: readonly AxisEstimate[]
    /** Sessions the typical measured skill has had so far (this one included; `typicalSessions`). */
    readonly sessions: number
    /** Start a focus session on these skills; without it the focus form is left out. */
    readonly onfocus?: (axes: AxisCode[]) => void
    /**
     * The save file is not safe yet: a focus session leaves the results, so the form waits for the
     * download (DESIGN §10: the save is required before leaving).
     */
    readonly focusLocked?: boolean
  }

  let { estimates, sessions, onfocus, focusLocked = false }: Props = $props()

  const uid = $props.id()
  const fuzzy = $derived(fuzziestAxes(estimates))
  const options = $derived(focusOptions(estimates))
  // The picker keeps the person's ticks; new options (another save loaded) start it afresh.
  const optionsKey = $derived(focusOptionsKey(options))
</script>

<section class="hb-reveal-panel retest" aria-labelledby="{uid}-h" data-section="retest">
  <h2 id="{uid}-h">{RETEST_HEADING}</h2>
  <p>{RETEST_INTRO}</p>
  <p data-shrinkage>{shrinkageLine(sessions, shrinkagePercent(sessions))}</p>
  <p class="note">{SHRINKAGE_BASIS}</p>

  <h3>{FUZZIEST_HEADING}</h3>
  {#if fuzzy.length === 0}
    <p>{FUZZIEST_NONE}</p>
  {:else}
    <ul class="fuzzy">
      {#each fuzzy as f (f.code)}
        <li data-fuzzy={f.code}><strong>{f.name}</strong>: 90% range {formatTheta(f.lo90, 1)} to {formatTheta(f.hi90, 1)} SD</li>
      {/each}
    </ul>
    <p class="note">{FUZZIEST_NOTE}</p>
  {/if}

  {#if onfocus}
    <h3>{FOCUS_HEADING}</h3>
    <p>{FOCUS_TEXT}</p>
    {#if focusLocked}
      <p class="note" data-focus-locked>{FOCUS_SAVE_FIRST}</p>
    {:else}
      {#key optionsKey}
        <FocusPicker {options} onstart={onfocus} />
      {/key}
    {/if}
  {/if}

  <h3>{SPACING_HEADING}</h3>
  <p data-spacing>{SPACING_TEXT}</p>
</section>
