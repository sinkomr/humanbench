<!--
  Three worked examples (DESIGN §10 "3 procedural items with worked solutions"; ROADMAP M1.R): a
  fresh matrix, series and quantitative item with the solution written out (`worked/`). They are
  shown after the session, are not counted and never repeat as counted items (their families go into
  the save's seen families, §7.7). Each solution is behind a disclosure, so the person can try first;
  the item itself is drawn with the same cell drawing as the session's matrices.
-->
<script lang="ts">
  import { optionLetter } from '../render/choice/keys'
  import { describeCell, gridCellLabel } from '../render/matrices/draw'
  import { MATRIX_GRID_LABEL, MATRIX_MISSING_LABEL, MATRIX_STEM } from '../render/matrices/copy'
  import MatrixCellSvg from '../render/matrices/MatrixCellSvg.svelte'
  import type { MatrixSpec } from '../tasks/matrices/grammar'
  import type { QuantSpec } from '../tasks/quant'
  import type { SeriesSpec } from '../tasks/series/types'
  import {
    WORKED_ANSWER,
    WORKED_INTRO,
    WORKED_MATRIX_OPTIONS,
    WORKED_NONE,
    WORKED_SERIES_PROMPT,
    WORKED_SHOW,
    WORKED_TRY_FIRST,
    workedHeading,
    workedMatrixOption,
    workedTitle,
  } from './copy'
  import type { WorkedItem } from './worked/types'
  import { num } from './worked/text'
  import './reveal.css'

  interface Props {
    readonly items: readonly WorkedItem[]
  }

  let { items }: Props = $props()

  const uid = $props.id()
  const matrixSpec = (w: WorkedItem): MatrixSpec => w.item.spec as unknown as MatrixSpec
  const seriesTerms = (w: WorkedItem): string => {
    const spec = w.item.spec as unknown as SeriesSpec
    return [...spec.terms].map((t) => (typeof t === 'number' ? num(t) : t)).join(', ')
  }
  const quantStem = (w: WorkedItem): string => (w.item.spec as unknown as QuantSpec).stem
  const answerIndex = (w: WorkedItem): number => Number(w.solution.exact)
</script>

<section class="hb-reveal-panel worked" aria-labelledby="{uid}-h" data-section="worked">
  <h2 id="{uid}-h">{workedHeading(items.length)}</h2>
  {#if items.length === 0}
    <p>{WORKED_NONE}</p>
  {:else}
    <p>{WORKED_INTRO}</p>
    {#each items as w, i (w.item.item_id)}
      <article class="hb-reveal-card" data-worked={w.kind} data-family={w.item.family_id} aria-labelledby="{uid}-t{i}">
        <h3 id="{uid}-t{i}">{workedTitle(i + 1, w.title)}</h3>
        {#if w.kind === 'matrix'}
          {@const spec = matrixSpec(w)}
          <p>{MATRIX_STEM}</p>
          <div class="grid" role="group" aria-label={MATRIX_GRID_LABEL}>
            {#each spec.grid as row, r (r)}
              {#each row as cell, c (c)}
                <MatrixCellSvg {cell} label={gridCellLabel(r + 1, c + 1, cell)} />
              {/each}
            {/each}
            <MatrixCellSvg cell={null} label={MATRIX_MISSING_LABEL} />
          </div>
          <ul class="options" aria-label={WORKED_MATRIX_OPTIONS}>
            {#each spec.options as option, k (k)}
              <li>
                <MatrixCellSvg cell={option} label="{workedMatrixOption(optionLetter(k))}: {describeCell(option)}" />
                <span class="letter" aria-hidden="true">{optionLetter(k)}</span>
              </li>
            {/each}
          </ul>
        {:else if w.kind === 'series'}
          <p>{WORKED_SERIES_PROMPT}</p>
          <p class="terms"><strong>{seriesTerms(w)}, ?</strong></p>
        {:else}
          <p class="terms">{quantStem(w)}</p>
        {/if}
        <p class="note">{WORKED_TRY_FIRST}</p>
        <details>
          <summary>{WORKED_SHOW}</summary>
          <ol class="steps">
            {#each w.solution.steps as step, k (k)}
              <li>{step}</li>
            {/each}
          </ol>
          <p class="answer">
            {WORKED_ANSWER}: <strong>{w.solution.answer}</strong>
          </p>
          {#if w.kind === 'matrix'}
            {@const spec = matrixSpec(w)}
            <div class="chosen">
              <MatrixCellSvg cell={spec.options[answerIndex(w)] ?? null} label="{workedMatrixOption(w.solution.answer)}: {describeCell(spec.options[answerIndex(w)]!)}" />
            </div>
          {/if}
        </details>
      </article>
    {/each}
  {/if}
</section>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.375rem;
    width: min(100%, 15rem);
    margin: 0.5rem 0;
  }
  .options {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 1rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: 0.5rem;
    max-width: 30rem;
  }
  .options li {
    margin: 0;
    text-align: center;
  }
  .letter {
    display: block;
    font-weight: 600;
  }
  .chosen {
    width: 5rem;
    margin: 0 0 0.5rem;
  }
  .terms {
    overflow-wrap: anywhere;
  }
  .steps {
    margin-top: 0.5rem;
  }
</style>
