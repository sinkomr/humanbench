<!--
  Matrices renderer (ROADMAP M1.13, A18; DESIGN §4.2 "Matrices", §11.6, §12, §13).

  Takes only the item's `spec` (never the key): the 3 × 3 grid of 8 visible SVG cells plus the
  missing "?" cell, and the options as SVG cells in `spec.options` order. Every grid cell has a
  structural text alternative ("Row 1, column 2: 3 small black triangles, turned 45°, at …"), and
  every option's radio is named the same way. `onrespond(index)` gets the chosen display
  position, the response `matrices.score()` takes. `onshown(t)` reports the timestamp of the
  first animation frame showing the item (rAF clock = performance.now(), §11.6), and the options
  accept a choice only from then on, so no response exists without an onset (the same contract
  as the rotation renderer, `visual.ts`). No animation.

  Scale (UX-020): size is a rule attribute of the matrix grammar, so an option is drawn at exactly
  the size of a cell of the grid: both lay out three tracks of the same width (the options as two
  rows of three, as wide as the grid and left-aligned with it, with flush cards that have no padding
  to eat into the figure).
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { MatrixCell, MatrixResponse, MatrixSpec } from '../../tasks/matrices/grammar'
  import OptionGroup from '../choice/OptionGroup.svelte'
  import { optionLetter } from '../choice/keys'
  import { MATRIX_GRID_LABEL, MATRIX_MISSING_LABEL, MATRIX_OPTIONS_LEGEND, MATRIX_STEM, matrixOptionName } from './copy'
  import { gridCellLabel } from './draw'
  import MatrixCellSvg from './MatrixCellSvg.svelte'

  interface Props {
    /** The item's render payload (never the key). */
    spec: MatrixSpec
    /** The chosen option's display position (the matrices family's response type). */
    onrespond: (response: MatrixResponse) => void
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    onshown?: (onsetMs: number) => void
    /** Part of the shared renderer props (visual.ts); never called: plain SVG always draws. */
    onunavailable?: () => void
    disabled?: boolean
  }

  let { spec, onrespond, onshown, disabled = false }: Props = $props()

  /** The widest the grid and, with it, the options may be. */
  const GRID_MAX = '22.5rem'

  function optionCell(i: number): MatrixCell {
    const cell = spec.options[i]
    if (cell === undefined) throw new RangeError(`matrices renderer: no option ${i}`)
    return cell
  }

  /** The spec whose onset was reported (its options unlock then). */
  let shownFor: MatrixSpec | null = $state.raw(null)
  const shown = $derived(shownFor === spec)
  $effect(() => {
    const s = spec
    if (untrack(() => shownFor) === s) return
    // The SVG is in the DOM when effects run; the next frame is the first to show it.
    const frame = requestAnimationFrame((t) => {
      shownFor = s
      onshown?.(t)
    })
    return () => cancelAnimationFrame(frame)
  })
</script>

<div class="matrix" style:--grid-max={GRID_MAX}>
  <p class="stem">{MATRIX_STEM}</p>
  <div class="grid" role="group" aria-label={MATRIX_GRID_LABEL}>
    {#each spec.grid as row, r (r)}
      {#each row as cell, c (c)}
        <MatrixCellSvg {cell} label={gridCellLabel(r + 1, c + 1, cell)} />
      {/each}
    {/each}
    <MatrixCellSvg cell={null} label={MATRIX_MISSING_LABEL} />
  </div>
  {#key spec}
    <OptionGroup
      count={spec.options.length}
      legend={MATRIX_OPTIONS_LEGEND}
      optionName={(i) => matrixOptionName(optionLetter(i), optionCell(i))}
      {onrespond}
      disabled={disabled || !shown}
      columns={{ narrow: 3, wide: 3 }}
      flush
      maxWidth="var(--grid-max)"
    >
      {#snippet option(i: number)}
        <MatrixCellSvg cell={optionCell(i)} />
      {/snippet}
    </OptionGroup>
  {/key}
</div>

<style>
  .matrix {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 48rem;
  }

  .stem {
    margin: 0;
    font-size: 1.125rem;
    color: var(--text-strong, #0b0a0f);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    width: min(100%, var(--grid-max));
    align-self: flex-start;
  }
</style>
