<!--
  figure2d renderer (DESIGN §3 row 7, §4.2, §11.6, §13; ROADMAP M1.13, A18): 2D figures turned in the plane or mirrored
  in a dashed line.

  Takes only the item's `spec` (never the key). The target is drawn upright in a framed box (task 'mirror': with the
  dashed mirror line across the whole box, edge to edge); the four options are drawn in `spec.options` order through the
  shared OptionGroup (2 × 2 on narrow screens, 4 in a row on wide ones), each figure centred in its box and turned about
  its centre by its `angle` (task 'rotate'; every box fits any figure at any angle). Every square is a filled square
  with an outline, all alike: no square carries a mark. The target has a complete text alternative (its squares row by
  row, and where the line is), and every option's radio is named the same way ("Option B: 7 squares, drawn turned 30°
  clockwise. In its own grid before the turn: Row 1: …"), never saying which option is right.

  `onrespond(index)` gets the chosen display position (what `figure2d.score()` takes). `onshown(t)` reports the rAF
  timestamp (performance.now() clock) of the first frame showing the item, and the options accept a choice only from
  then on. Plain SVG always draws, so `onunavailable` is never called. No animation.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { Figure2dResponse, Figure2dSpec } from '../../tasks/figure2d/spec'
  import OptionGroup from '../choice/OptionGroup.svelte'
  import { optionLetter } from '../choice/keys'
  import { FIGURE2D_OPTIONS_LEGEND, optionLabel, stemOf, targetLabel } from './copy'
  import {
    BOX_BORDER,
    FILL,
    LINE_DASH,
    LINE_WIDTH,
    OUTLINE,
    OUTLINE_WIDTH,
    PAPER,
    UNIT,
    centred,
    mirrorOptionSide,
    mirrorTarget,
    rotateBoxSide,
    squaresOf,
  } from './draw'

  interface Props {
    /** The item's render payload (never the key). */
    spec: Figure2dSpec
    /** The chosen option's display position (the figure2d family's response type). */
    onrespond: (response: Figure2dResponse) => void
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    onshown?: (onsetMs: number) => void
    /** Part of the shared renderer props (visual.ts); never called: plain SVG always draws. */
    onunavailable?: () => void
    disabled?: boolean
  }

  let { spec, onrespond, onshown, disabled = false }: Props = $props()

  const isMirror = $derived(spec.task === 'mirror')
  const rotateSide = $derived(isMirror ? 0 : rotateBoxSide(spec))
  const target = $derived(
    isMirror && spec.mirror_line !== undefined
      ? mirrorTarget(spec.figure.cells, spec.mirror_line)
      : { ...centred(spec.figure.cells, rotateSide, 0), line: null },
  )
  const optionSide = $derived(isMirror ? mirrorOptionSide(spec) : rotateSide)

  function optionAt(i: number): Figure2dSpec['options'][number] {
    const o = spec.options[i]
    if (o === undefined) throw new RangeError(`figure2d renderer: no option ${i}`)
    return o
  }

  /** The spec whose onset was reported (its options unlock then). */
  let shownFor: Figure2dSpec | null = $state.raw(null)
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

<div class="figure2d">
  <p class="stem">{stemOf(spec)}</p>
  <div class="target" class:mirror={isMirror}>
    <svg class="box" viewBox="0 0 {target.side} {target.side}" role="img" aria-label={targetLabel(spec)} focusable="false">
      <rect x="1" y="1" width={target.side - 2} height={target.side - 2} fill={PAPER} stroke={BOX_BORDER} stroke-width="2" />
      <g transform={target.transform}>
        {#each squaresOf(spec.figure.cells) as sq, k (k)}
          <rect class="square" x={sq.x} y={sq.y} width={UNIT} height={UNIT} fill={FILL} stroke={OUTLINE} stroke-width={OUTLINE_WIDTH} />
        {/each}
      </g>
      {#if target.line !== null}
        <line
          class="mirror-line"
          x1={target.line.x1}
          y1={target.line.y1}
          x2={target.line.x2}
          y2={target.line.y2}
          stroke={OUTLINE}
          stroke-width={LINE_WIDTH}
          stroke-dasharray={LINE_DASH}
        />
      {/if}
    </svg>
  </div>
  {#key spec}
    <OptionGroup
      count={spec.options.length}
      legend={FIGURE2D_OPTIONS_LEGEND}
      optionName={(i) => optionLabel(optionLetter(i), optionAt(i), spec.task)}
      {onrespond}
      disabled={disabled || !shown}
      columns={{ narrow: 2, wide: 4 }}
      maxWidth="40rem"
    >
      {#snippet option(i: number)}
        {@const o = optionAt(i)}
        {@const placed = centred(o.cells, optionSide, o.angle)}
        <svg class="box" viewBox="0 0 {optionSide} {optionSide}" aria-hidden="true" focusable="false">
          <rect x="1" y="1" width={optionSide - 2} height={optionSide - 2} fill={PAPER} stroke={BOX_BORDER} stroke-width="1" />
          <g transform={placed.transform}>
            {#each squaresOf(o.cells) as sq, k (k)}
              <rect class="square" x={sq.x} y={sq.y} width={UNIT} height={UNIT} fill={FILL} stroke={OUTLINE} stroke-width={OUTLINE_WIDTH} />
            {/each}
          </g>
        </svg>
      {/snippet}
    </OptionGroup>
  {/key}
</div>

<style>
  .figure2d {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 48rem;
    min-width: 0;
  }

  .stem {
    margin: 0;
    font-size: 1.125rem;
    color: var(--text-strong, #0b0a0f);
  }

  .target {
    width: min(100%, 12rem);
    align-self: center;
  }

  .target.mirror {
    width: min(100%, 18rem);
  }

  .box {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
