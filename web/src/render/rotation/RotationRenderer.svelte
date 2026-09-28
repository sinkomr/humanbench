<!--
  Mental-rotation renderer (ROADMAP M1.13, A3, A11, A18; DESIGN §4.2 "Rendering", §11.6, §12, §13).

  Takes only the item's `spec` (never the key) and calls `onrespond(index)` with the chosen display
  position, the response `rotation.score()` takes. The target and the four options are drawn by
  Three.js with the fixed `iso_v1` camera from `scene.ts`; Three.js itself (`three-view.ts`) is
  loaded lazily on mount and shares one WebGL context across every figure and every mounted
  renderer (see there for the iOS context budget).

  - Locked until drawn: the options accept no choice until every figure of the current spec has
    been painted, so no response (and no response time) exists for a stimulus nobody saw.
  - Onset (§11.6): the figures are painted in a rAF callback, and they are on screen in the frame
    that callback belongs to, so `onshown(t)` is called once per spec with that callback's
    timestamp (rAF clock = performance.now()), the same convention as the matrices renderer (the
    first frame showing the stimulus). A failed paint (lost context, zero-size canvas) reports
    nothing; the next successful pass (resize, context restore) does. The lazy load is never in
    the response time.
  - Without WebGL the figures stay blank, the text alternatives remain, a notice says the question
    cannot be answered here, the options stay locked, `onshown` is never called and
    `onunavailable()` is called once per spec instead, so the session can offer skipping (§13
    "skip any axis", M1.15).
  - The figures are static (no animation), so prefers-reduced-motion has nothing to reduce.
  - Canvases are sized from their CSS box × devicePixelRatio (capped at 2) and redrawn on resize.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { RotationResponse, RotationSpec } from '../../tasks/rotation/spec'
  import OptionGroup from '../choice/OptionGroup.svelte'
  import { optionLetter } from '../choice/keys'
  import { ROTATION_OPTIONS_LEGEND, ROTATION_STEM, ROTATION_UNAVAILABLE, optionAlt, targetAlt } from './copy'
  import { rotationScene, type RotationScene } from './scene'
  import type { FigurePainter } from './three-view'

  interface Props {
    /** The item's render payload (never the key). */
    spec: RotationSpec
    /** The chosen option's display position (the rotation family's response type). */
    onrespond: (response: RotationResponse) => void
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the figures. */
    onshown?: (onsetMs: number) => void
    /** The figures cannot be drawn in this browser (no WebGL): the item cannot be answered. */
    onunavailable?: () => void
    disabled?: boolean
  }

  let { spec, onrespond, onshown, onunavailable, disabled = false }: Props = $props()

  const scene = $derived(rotationScene(spec))
  const nCubes = $derived(spec.target.cubes.length)
  let status: 'loading' | 'ready' | 'unavailable' = $state('loading')
  let painter: FigurePainter | null = $state.raw(null)
  let root: HTMLElement | undefined = $state()
  let targetCanvas: HTMLCanvasElement | undefined = $state()
  const optionCanvases: (HTMLCanvasElement | undefined)[] = $state([])
  /** Bumped on resize and on WebGL context restore, to redraw. */
  let redraws = $state(0)

  /** The spec whose figures were all painted (its onset reported; its options unlocked). */
  let drawnFor: RotationSpec | null = $state.raw(null)
  const drawn = $derived(drawnFor === spec)
  /** The spec whose unavailability was reported. */
  let unavailableFor: RotationSpec | null = null

  /** Called from the rAF callback that painted `forSpec`; `t` is that frame's timestamp (§11.6). */
  function markDrawn(forSpec: RotationSpec, t: number): void {
    if (drawnFor === forSpec) return
    drawnFor = forSpec
    onshown?.(t)
  }

  function sizeCanvas(canvas: HTMLCanvasElement): void {
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const px = Math.round(canvas.clientWidth * dpr)
    if (canvas.width !== px) canvas.width = px
    if (canvas.height !== px) canvas.height = px
  }

  function drawAll(p: FigurePainter, sc: RotationScene, target: HTMLCanvasElement, options: readonly HTMLCanvasElement[]): boolean {
    let ok = true
    const jobs = [[target, sc.target] as const, ...options.map((c, i) => [c, sc.options[i]] as const)]
    for (const [canvas, figure] of jobs) {
      if (figure === undefined) continue
      sizeCanvas(canvas)
      ok = p.paint(canvas, figure, sc.camera) && ok
    }
    return ok
  }

  onMount(() => {
    let alive = true
    let mine: FigurePainter | null = null
    import('./three-view')
      .then((m) => {
        if (!alive) return
        mine = m.acquirePainter()
        mine.onRestored(() => redraws++)
        painter = mine
        status = 'ready'
      })
      .catch(() => {
        if (alive) status = 'unavailable'
      })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => redraws++)
    if (resize && root) resize.observe(root)
    return () => {
      alive = false
      resize?.disconnect()
      mine?.release()
      painter = null
    }
  })

  $effect(() => {
    void redraws
    const p = painter
    const sc = scene
    const forSpec = spec
    const target = targetCanvas
    const options = optionCanvases.slice(0, sc.options.length)
    if (!p || !target || options.length !== sc.options.length || options.some((c) => !c)) return
    const frame = requestAnimationFrame((t) => {
      if (drawAll(p, sc, target, options as HTMLCanvasElement[])) markDrawn(forSpec, t)
    })
    return () => cancelAnimationFrame(frame)
  })

  $effect(() => {
    if (status !== 'unavailable') return
    const forSpec = spec
    if (unavailableFor === forSpec) return
    unavailableFor = forSpec
    // The caller's handler runs untracked: whatever state it reads must not re-run this effect.
    untrack(() => onunavailable?.())
  })
</script>

<div class="rotation" bind:this={root}>
  <p class="stem">{ROTATION_STEM}</p>
  <div class="target">
    <span class="caption" aria-hidden="true">Target</span>
    <div class="frame" role="img" aria-label={targetAlt(nCubes)}>
      <canvas bind:this={targetCanvas} class="view" aria-hidden="true">{targetAlt(nCubes)}</canvas>
    </div>
  </div>
  {#if status === 'unavailable'}
    <p class="notice" role="status">{ROTATION_UNAVAILABLE}</p>
  {/if}
  {#key spec}
    <OptionGroup
      count={spec.options.length}
      legend={ROTATION_OPTIONS_LEGEND}
      optionName={(i) => optionAlt(optionLetter(i), nCubes)}
      {onrespond}
      disabled={disabled || !drawn}
      columns={{ narrow: 2, wide: 4 }}
    >
      {#snippet option(i: number)}
        <canvas bind:this={optionCanvases[i]} class="view" aria-hidden="true">{optionAlt(optionLetter(i), nCubes)}</canvas>
      {/snippet}
    </OptionGroup>
  {/key}
</div>

<style>
  .rotation {
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

  .target {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .caption {
    font-weight: 700;
    color: var(--text-strong, #0b0a0f);
  }

  .target .frame {
    width: min(100%, 14rem);
    border: 2px solid #767676;
    border-radius: 0.375rem;
  }

  /* The paper-white stimulus looks the same in both themes (scene.ts LIGHTING.background). */
  .view {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 0.25rem;
    background: #ffffff;
  }

  .notice {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--text, #3d3a44);
    border-radius: 0.5rem;
    color: var(--text-strong, #0b0a0f);
  }
</style>
