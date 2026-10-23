<!--
  Paper-folding renderer (DESIGN §3 row 7, §11.6, §13; ROADMAP A18; family `tasks/folding`).

  Takes only the item's `spec` (never the key). A row of panels that wraps (two per row on a phone):
  panel k shows the paper before fold k, the half that moves hatched, the fold line dashed and a
  curved arrow from the moving half to where it lands; the last panel shows the fully folded paper
  with the punched holes, the sheet's outline dotted behind it so positions read against the sheet.
  Every intermediate shape is derived from the spec (`draw.ts`, the family's shared geometry).
  The five options are full sheets with a faint slot grid and filled holes, in `spec.options` order
  (`../choice/OptionGroup.svelte`: keyboard, pointer, Confirm).

  Text alternative: the panels are hidden from assistive tech and an ordered list (visually hidden)
  describes the sheet, each fold and the punches completely; each option's radio is named by its
  holes, row by row, in the same format for every option (`copy.ts`). Nothing in the DOM depends on
  which option is the key. `onshown(t)` reports the first animation frame showing the item
  (performance.now() clock), and the options accept a choice only from then on. No animation.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import '../common/render.css'
  import type { FoldingResponse, FoldingSpec } from '../../tasks/folding/spec'
  import OptionGroup from '../choice/OptionGroup.svelte'
  import { optionLetter } from '../choice/keys'
  import { FOLDING_FIGURE_LABEL, FOLDING_OPTIONS_LEGEND, FOLDING_STEM, PUNCH_CAPTION, foldCaption, foldText, optionName, punchText, sheetText } from './copy'
  import { HOLE_R, SLOT_R, allSlots, foldPanel, holeCentre, planOf, pointsOf, viewBoxOf } from './draw'

  interface Props {
    /** The item's render payload (never the key). */
    spec: FoldingSpec
    /** The chosen option's display position (the folding family's response type). */
    onrespond: (response: FoldingResponse) => void
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    onshown?: (onsetMs: number) => void
    /** Part of the shared renderer props (visual.ts); never called: plain SVG always draws. */
    onunavailable?: () => void
    disabled?: boolean
  }

  let { spec, onrespond, onshown, disabled = false }: Props = $props()

  const uid = $props.id()
  const n = $derived(spec.grid)
  const plan = $derived(planOf(spec))
  const panels = $derived(plan === null ? [] : spec.folds.map((_, k) => foldPanel(plan, k)))
  const folded = $derived(plan === null ? '' : pointsOf(plan.shapes[spec.folds.length] ?? []))
  const sheet = $derived(`0,0 ${2 * n},0 ${2 * n},${2 * n} 0,${2 * n}`)
  const slots = $derived(allSlots(n))
  /** Grid lines between the slots of an option sheet. */
  const gridLines = $derived(Array.from({ length: n - 1 }, (_, i) => 2 * (i + 1)))

  function holesOf(i: number) {
    const o = spec.options[i]
    if (o === undefined) throw new RangeError(`folding renderer: no option ${i}`)
    return o.holes
  }

  /** The spec whose onset was reported (its options unlock then). */
  let shownFor: FoldingSpec | null = $state.raw(null)
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

<section class="hb-render folding">
  <p class="stem">{FOLDING_STEM}</p>
  <div class="figure" role="group" aria-label={FOLDING_FIGURE_LABEL}>
    <ol class="hb-sr-only">
      <li>{sheetText(n)}</li>
      {#each spec.folds as fold, k (k)}
        <li>{foldText(k + 1, fold)}</li>
      {/each}
      <li>{punchText(spec.punches)}</li>
    </ol>
    <div class="panels" aria-hidden="true">
      {#each panels as p, k (k)}
        <figure class="panel">
          <svg class="paper" viewBox={viewBoxOf(n)} focusable="false">
            <defs>
              <pattern id="{uid}-hatch-{k}" patternUnits="userSpaceOnUse" width="0.8" height="0.8" patternTransform="rotate(45)">
                <line class="hatch" x1="0" y1="0" x2="0" y2="0.8" />
              </pattern>
            </defs>
            {#if k > 0}
              <polygon class="outline" points={sheet} />
            {/if}
            <polygon class="sheet" points={p.shape} />
            <polygon class="moving" points={p.moving} fill="url(#{uid}-hatch-{k})" />
            <line class="fold" x1={p.line.x1} y1={p.line.y1} x2={p.line.x2} y2={p.line.y2} />
            <path class="arrow" d={p.arrow} />
            <polygon class="head" points={p.head} />
          </svg>
          <figcaption>{foldCaption(k + 1)}</figcaption>
        </figure>
      {/each}
      {#if plan !== null}
        <figure class="panel">
          <svg class="paper" viewBox={viewBoxOf(n)} focusable="false">
            <polygon class="outline" points={sheet} />
            <polygon class="sheet" points={folded} />
            {#each spec.punches as s, j (j)}
              <circle class="hole" cx={holeCentre(s)[0]} cy={holeCentre(s)[1]} r={HOLE_R} />
            {/each}
          </svg>
          <figcaption>{PUNCH_CAPTION}</figcaption>
        </figure>
      {/if}
    </div>
  </div>
  {#key spec}
    <OptionGroup
      count={spec.options.length}
      legend={FOLDING_OPTIONS_LEGEND}
      optionName={(i) => optionName(optionLetter(i), holesOf(i))}
      {onrespond}
      disabled={disabled || !shown}
      columns={{ narrow: 3, wide: 5 }}
    >
      {#snippet option(i: number)}
        <svg class="paper option-sheet" viewBox={viewBoxOf(n)} aria-hidden="true" focusable="false">
          <polygon class="sheet" points={sheet} />
          {#each gridLines as g (g)}
            <line class="grid" x1={g} y1="0" x2={g} y2={2 * n} />
            <line class="grid" x1="0" y1={g} x2={2 * n} y2={g} />
          {/each}
          {#each slots as s, j (j)}
            <circle class="slot" cx={holeCentre(s)[0]} cy={holeCentre(s)[1]} r={SLOT_R} />
          {/each}
          {#each holesOf(i) as s, j (j)}
            <circle class="hole" cx={holeCentre(s)[0]} cy={holeCentre(s)[1]} r={HOLE_R} />
          {/each}
        </svg>
      {/snippet}
    </OptionGroup>
  {/key}
</section>

<style>
  .folding {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 48rem;
  }

  .stem {
    margin: 0;
    font-size: 1.125rem;
    color: var(--r-fg);
  }

  .panels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .panel {
    margin: 0;
    flex: 0 0 calc(50% - 0.375rem);
    max-width: 10rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  @media (min-width: 40rem) {
    .panel {
      flex-basis: calc(25% - 0.5625rem);
    }
  }

  figcaption {
    font-size: 0.875rem;
    color: var(--r-muted);
  }

  .paper {
    display: block;
    width: 100%;
    height: auto;
  }

  .sheet {
    fill: var(--r-surface);
    stroke: var(--r-fg);
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }

  .outline {
    fill: none;
    stroke: var(--r-border);
    stroke-width: 1.5px;
    stroke-dasharray: 2 3;
    vector-effect: non-scaling-stroke;
  }

  .moving {
    stroke: none;
  }

  .hatch {
    stroke: var(--r-muted);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }

  .fold {
    stroke: var(--r-accent);
    stroke-width: 2.5px;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
  }

  .arrow {
    fill: none;
    stroke: var(--r-fg);
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }

  .head,
  .hole {
    fill: var(--r-fg);
  }

  .grid {
    stroke: var(--r-border);
    stroke-width: 1px;
    stroke-dasharray: 1 3;
    vector-effect: non-scaling-stroke;
  }

  .slot {
    fill: var(--r-border);
  }
</style>
