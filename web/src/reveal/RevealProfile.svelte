<!--
  The profile with its build-up (DESIGN §10 "animated blob build-up, axis by axis"; ROADMAP M1.R).
  The blob is drawn skill by skill (`frames.ts`), the table always holds the final data (the
  screen-reader default, §9.5 c), and the animation is optional: `prefers-reduced-motion` skips it,
  and "Skip animation" ends it at any time (WCAG 2.2.2). The last frame is the static profile.
  Announcements: one line when it starts and one when it is ready; the skill being drawn is shown
  but not announced (the table has the data), so a screen reader is not read 17 updates. The status
  line is visually hidden (UX-REVIEW D16: a sighted person sees the chart, not a sentence about it) and
  stays a live region in the page.

  The top is compact (D16): the practice note is one line, and under it a row with the small "Replay
  animation" / "Skip animation" button (only while there is one), so the chart starts as high up as it
  can. The row is the same height while the profile builds and when it is done, so nothing moves when
  the build-up ends.

  `between` is drawn under the chart and above the cluster drill-down: the distinctive peaks go
  there, so the order is build-up, peaks, drill-down (§10).
-->
<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte'
  import { browserFrameSource, type FrameSource } from '../tasks/rt/timing'
  import ProfileView from '../viz/ProfileView.svelte'
  import { axisEstimates, type ProfileInput } from '../viz/profile'
  import type { FacetObservation, FacetOptions } from '../viz/facets'
  import { PRACTICE_ADJUSTED_FIRST, PRACTICE_ADJUSTED_LABEL, PRACTICE_ADJUSTED_LATER, REVEAL_BUILDING, REVEAL_READY, REVEAL_REPLAY, REVEAL_SKIP, revealNow } from './copy'
  import { frameEstimates, revealCount, revealingNow, startReveal, type RevealHandle } from './frames'

  interface Props {
    readonly input: ProfileInput
    readonly facetObservations: readonly FacetObservation[]
    /** Facet estimates the server computed (M2.7). */
    readonly facetPrecomputed?: FacetOptions['precomputed']
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

  let { input, facetObservations, facetPrecomputed, practiceAdjusted, frames = browserFrameSource(), motion = 'auto', onbuilt, between }: Props = $props()

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
  // The status line is mounted with its ready text when nothing is built up. When something is, it is mounted EMPTY
  // and the build-up is announced a moment later: a live region that appears with its text is not announced by most
  // screen readers (UX-036), and the start of the build-up is the sentence that matters.
  let announced = $state(untrack(() => (!reduced && count > 0 ? '' : REVEAL_READY)))
  /** How long after mount the build-up is announced (the region has to be in the page, empty, first). */
  const ANNOUNCE_AFTER_MS = 100

  /** `announce`: say that the build-up has started now (false at mount, where the region is still empty and the announcement waits). */
  function run(announce = true): void {
    // "Replay animation" is replaced by "Skip animation": keep keyboard focus on the button in its place.
    const replayHadFocus = replayButton !== undefined && document.activeElement === replayButton
    handle?.stop()
    building = true
    progress = 0
    if (announce) announced = REVEAL_BUILDING
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
    if (building) run(false)
    else onbuilt()
    const timer = setTimeout(() => {
      if (building && announced === '') announced = REVEAL_BUILDING
    }, ANNOUNCE_AFTER_MS)
    return () => {
      clearTimeout(timer)
      handle?.stop()
    }
  })

  const now = $derived(building ? revealingNow(estimates, progress) : null)
</script>

<div class="reveal" data-building={building}>
  <div class="controls">
    <p class="badge" data-practice-adjusted>
      <strong>{PRACTICE_ADJUSTED_LABEL}.</strong>
      <span class="muted">{practiceAdjusted ? PRACTICE_ADJUSTED_LATER : PRACTICE_ADJUSTED_FIRST}</span>
    </p>
    {#if building || (!reduced && count > 0)}
      <!-- Only while there is a button to show: with the motion off there is nothing to skip or replay, and no empty row. -->
      <div class="anim">
        {#if building}
          <button type="button" class="text-button" bind:this={skipButton} onclick={() => handle?.skip()}>{REVEAL_SKIP}</button>
        {:else}
          <button type="button" class="text-button" bind:this={replayButton} onclick={() => run()}>{REVEAL_REPLAY}</button>
        {/if}
        {#if now !== null}
          <p class="now" aria-hidden="true">{revealNow(now.name, now.index, now.count)}</p>
        {/if}
      </div>
    {/if}
    <!-- Visually hidden, in the accessibility tree: the live region of the build-up (WCAG 4.1.3). -->
    <p class="hb-status hb-sr-only" role="status">{announced}</p>
  </div>

  <ProfileView {input} {facetObservations} {facetPrecomputed} display={(est) => (building ? frameEstimates(est, progress) : est)} {between} />
</div>

<style>
  .reveal {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  /*
   * Two rows, whatever the width: the note, then the button (and the caption of the skill being drawn). Side by side they
   * would break into one row or two depending on the width, the text size and the length of the caption, and the chart
   * under them would move up and down while it builds.
   */
  .controls {
    display: flex;
    flex-direction: column;
    max-width: 52rem;
    width: 100%;
    margin: 0 auto;
    /* So the caption below can ask how much room the row has, in the page's own rem (a media query counts the browser's default size, not the page's). */
    container-type: inline-size;
  }
  /* `.hb-screen p` (session.css) caps a paragraph at 38rem and gives it a margin: the note is the row's own, as wide as the column. */
  .badge {
    max-width: none;
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.5;
  }
  .badge strong {
    color: var(--r-fg);
  }
  .muted {
    color: var(--r-muted);
  }
  /* The same height building and done (a 44 px button; the caption of the skill being drawn wraps beside it, two lines at most at phone widths). */
  .anim {
    display: flex;
    align-items: center;
    gap: 0 0.75rem;
    min-width: 0;
    min-height: 2.75rem;
  }
  .now {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--r-muted);
  }
  /* In a row too narrow for the caption beside the button (a 320 px phone, or large text) it is left out: it only repeats what the chart is drawing, and the row must not grow while it builds. */
  @container (max-width: 20rem) {
    .now {
      display: none;
    }
  }
  /* A quiet control: the text of a button in the link colour, with a 44 px target (WCAG 2.5.8). */
  .text-button {
    flex: none;
    min-width: 2.75rem;
    min-height: 2.75rem;
    /* The 0.5rem of padding is target, not text: the words stand on the column's left edge. */
    margin: 0 0 0 -0.5rem;
    padding: 0 0.5rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--r-accent);
    font: inherit;
    font-size: 0.9375rem;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
    touch-action: manipulation;
  }
  /* On paper there is nothing to replay. */
  @media print {
    .anim {
      display: none;
    }
  }
  /* The status line is for assistive technology only; the chart and the table show the same. Out of the layout, so it takes no room. */
  .hb-status.hb-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    min-height: 0;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
