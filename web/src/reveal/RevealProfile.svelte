<!--
  The profile with its build-up (DESIGN §10 "animated blob build-up, axis by axis"; ROADMAP M1.R).
  The blob is drawn skill by skill (`frames.ts`), the table always holds the final data (the
  screen-reader default, §9.5 c), and the animation is optional: `prefers-reduced-motion` skips it,
  and "Skip animation" ends it at any time (WCAG 2.2.2). The last frame is the static profile.
  Announcements: one line when it starts and one when it is ready; the skill being drawn is shown
  but not announced (the table has the data), so a screen reader is not read 17 updates.

  `between` is drawn under the chart and above the cluster drill-down: the distinctive peaks go
  there, so the order is build-up, peaks, drill-down (§10).
-->
<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte'
  import { browserFrameSource, type FrameSource } from '../tasks/rt/timing'
  import ProfileView from '../viz/ProfileView.svelte'
  import { axisEstimates, type ProfileInput } from '../viz/profile'
  import type { FacetObservation } from '../viz/facets'
  import { PRACTICE_ADJUSTED_FIRST, PRACTICE_ADJUSTED_LABEL, PRACTICE_ADJUSTED_LATER, REVEAL_BUILDING, REVEAL_READY, REVEAL_REPLAY, REVEAL_SKIP, revealNow } from './copy'
  import { frameEstimates, revealCount, revealingNow, startReveal, type RevealHandle } from './frames'

  interface Props {
    readonly input: ProfileInput
    readonly facetObservations: readonly FacetObservation[]
    /** More than one session, or a session credited for earlier practice (`ResultsModel.practiceAdjusted`). */
    readonly practiceAdjusted: boolean
    /** rAF source of the build-up (default the browser's; the flow passes its scaled one, `?fast=1`). */
    readonly frames?: FrameSource
    /** 'auto' follows prefers-reduced-motion (and skips without matchMedia); 'full' always animates; 'reduce' never. */
    readonly motion?: 'auto' | 'reduce' | 'full'
    /** Called once when the profile is complete (the build-up ended, was skipped, or never ran). */
    readonly onbuilt: () => void
    readonly between?: Snippet
  }

  let { input, facetObservations, practiceAdjusted, frames = browserFrameSource(), motion = 'auto', onbuilt, between }: Props = $props()

  const estimates = $derived(axisEstimates(input))
  const count = $derived(revealCount(estimates))

  function reduceMotion(): boolean {
    if (motion === 'reduce') return true
    if (motion === 'full') return false
    return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // Decided before the first paint, so the finished blob never flashes before the build-up.
  const reduced = untrack(reduceMotion)
  let building = $state(!reduced && untrack(() => count) > 0)
  let progress = $state(0)
  let handle: RevealHandle | null = null
  let skipButton: HTMLButtonElement | undefined = $state()
  let replayButton: HTMLButtonElement | undefined = $state()
  let announced = $state(untrack(() => (!reduced && count > 0 ? REVEAL_BUILDING : REVEAL_READY)))

  function run(): void {
    // "Replay animation" is replaced by "Skip animation": keep keyboard focus on the button in its place.
    const replayHadFocus = replayButton !== undefined && document.activeElement === replayButton
    handle?.stop()
    building = true
    progress = 0
    announced = REVEAL_BUILDING
    if (replayHadFocus) void tick().then(() => skipButton?.focus())
    handle = startReveal({
      count,
      frames,
      onProgress: (p) => (progress = p),
      onDone: () => {
        // "Skip animation" goes away when the build-up ends: keyboard focus moves to "Replay" (WCAG 2.4.3).
        const skipHadFocus = skipButton !== undefined && document.activeElement === skipButton
        building = false
        announced = REVEAL_READY
        handle = null
        onbuilt()
        if (skipHadFocus) void tick().then(() => replayButton?.focus())
      },
    })
  }

  onMount(() => {
    if (building) run()
    else onbuilt()
    return () => handle?.stop()
  })

  const now = $derived(building ? revealingNow(estimates, progress) : null)
</script>

<div class="reveal" data-building={building}>
  <div class="controls">
    <p class="badge" data-practice-adjusted>
      <strong>{PRACTICE_ADJUSTED_LABEL}</strong>
      <span class="muted">{practiceAdjusted ? PRACTICE_ADJUSTED_LATER : PRACTICE_ADJUSTED_FIRST}</span>
    </p>
    <div class="anim">
      {#if building}
        <button type="button" class="hb-btn" bind:this={skipButton} onclick={() => handle?.skip()}>{REVEAL_SKIP}</button>
      {:else if !reduced && count > 0}
        <button type="button" class="hb-btn" bind:this={replayButton} onclick={run}>{REVEAL_REPLAY}</button>
      {/if}
      <p class="now" aria-hidden="true">{now === null ? '' : revealNow(now.name, now.index, now.count)}</p>
    </div>
    <p class="hb-status" role="status">{announced}</p>
  </div>

  <ProfileView {input} {facetObservations} display={(est) => (building ? frameEstimates(est, progress) : est)} {between} />
</div>

<style>
  .reveal {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 52rem;
    width: 100%;
    margin: 0 auto;
  }
  .badge {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: baseline;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
    max-width: 52rem;
  }
  .muted {
    color: var(--r-muted);
  }
  .anim {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    min-height: 2.75rem;
  }
  .now {
    margin: 0;
    color: var(--r-muted);
  }
  .hb-status {
    margin: 0;
    min-height: 1.5em;
  }
</style>
