<!--
  Cube-net renderer (DESIGN §3 row 7, §4.2, §11.6, §13; ROADMAP A18).

  Takes only the item's `spec` (never the key): the flat pattern (net) as one SVG image whose text
  alternative describes every square row by row, then the four cube options in `spec.options`
  order (2 × 2 on narrow screens, one row of four on wide ones), each an isometric cube whose radio
  is named by its three faces in the same words for every option. `onrespond(index)` gets the
  chosen display position, the response `cubenet.score()` takes. `onshown(t)` reports the rAF
  timestamp of the first frame showing the item (performance.now() clock, §11.6), and the options
  accept a choice only from then on. No animation. All figures scale with their viewBox.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { CubeView, CubenetResponse, CubenetSpec } from '../../tasks/cubenet/spec'
  import OptionGroup from '../choice/OptionGroup.svelte'
  import { optionLetter } from '../choice/keys'
  import { CUBENET_OPTIONS_LEGEND, CUBENET_STEM, CUBENET_VIEW_NOTE, cubenetOptionName, netAlt } from './copy'
  import CubeSvg from './CubeSvg.svelte'
  import NetSvg from './NetSvg.svelte'

  interface Props {
    /** The item's render payload (never the key). */
    spec: CubenetSpec
    /** The chosen option's display position (the cubenet family's response type). */
    onrespond: (response: CubenetResponse) => void
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    onshown?: (onsetMs: number) => void
    /** Part of the shared renderer props (visual.ts); never called: plain SVG always draws. */
    onunavailable?: () => void
    disabled?: boolean
  }

  let { spec, onrespond, onshown, disabled = false }: Props = $props()

  function optionView(i: number): CubeView {
    const v = spec.options[i]
    if (v === undefined) throw new RangeError(`cubenet renderer: no option ${i}`)
    return v
  }

  /** The spec whose onset was reported (its options unlock then). */
  let shownFor: CubenetSpec | null = $state.raw(null)
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

<div class="cubenet">
  <p class="stem">{CUBENET_STEM}</p>
  <div class="net-box">
    <NetSvg net={spec.net} label={netAlt(spec.net)} />
  </div>
  <p class="note">{CUBENET_VIEW_NOTE}</p>
  {#key spec}
    <OptionGroup
      count={spec.options.length}
      legend={CUBENET_OPTIONS_LEGEND}
      optionName={(i) => cubenetOptionName(optionLetter(i), optionView(i))}
      {onrespond}
      disabled={disabled || !shown}
      columns={{ narrow: 2, wide: 4 }}
      maxWidth="40rem"
    >
      {#snippet option(i: number)}
        <CubeSvg view={optionView(i)} />
      {/snippet}
    </OptionGroup>
  {/key}
</div>

<style>
  .cubenet {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    min-width: 0;
    max-width: 48rem;
    box-sizing: border-box;
  }

  .stem {
    margin: 0;
    font-size: 1.125rem;
    color: var(--text-strong, #0b0a0f);
  }

  .note {
    margin: 0;
    color: var(--text, #3d3a44);
  }

  /* White paper in both themes (contrast.test.ts LITERALS); the marks on it are black. */
  .net-box {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 0.5rem;
    background: #ffffff;
    border-radius: 0.5rem;
  }
</style>
