<!--
  The time-based progress ring (ROADMAP M1.15; DESIGN §10 "A progress ring shows *time*, not items,
  because adaptive item counts vary"). Elapsed active time over the session target, in whole minutes.
  It is a progressbar with a text value ("12 of about 30 min"), so the meaning is never in the ring's
  colour alone; the ring itself is decorative. It fills up and stays full when the person is past the
  target. The target is shown to the nearest five minutes ("about 30"), the same figure as the welcome
  and ready screens, while the fill follows the exact target (UX-008). Past the target, "Almost there" is
  only said on the last part; earlier it says "Over the planned time", which is true wherever they are.
-->
<script lang="ts">
  import { OVER_PLANNED, OVER_TARGET, PROGRESS_LABEL, progressText } from './copy'

  interface Props {
    readonly elapsedS: number
    readonly targetS: number
    /** The part on screen (or about to start) is the last one of the session. */
    readonly lastPart?: boolean
  }

  let { elapsedS, targetS, lastPart = false }: Props = $props()

  const R = 21
  const C = 2 * Math.PI * R

  const targetMin = $derived(Math.max(1, Math.round(targetS / 60)))
  /** The figure the text and the progressbar's maximum show: to the nearest 5 minutes, so 28 reads as 30 and a 20-minute focus session stays 20. */
  const aboutMin = $derived(targetMin < 3 ? targetMin : Math.round(targetMin / 5) * 5)
  const elapsedMin = $derived(Math.min(aboutMin, Math.floor(elapsedS / 60)))
  const fraction = $derived(Math.max(0, Math.min(1, elapsedS / targetS)))
  const over = $derived(elapsedS >= targetS)
  const text = $derived(over ? (lastPart ? OVER_TARGET : OVER_PLANNED) : progressText(elapsedMin, aboutMin))
</script>

<div class="ring" role="progressbar" aria-label={PROGRESS_LABEL} aria-valuemin={0} aria-valuemax={aboutMin} aria-valuenow={elapsedMin} aria-valuetext={text} data-fraction={fraction.toFixed(3)}>
  <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
    <circle class="track" cx="24" cy="24" r={R} fill="none" stroke-width="5" />
    {#if fraction > 0}
      <circle class="bar" cx="24" cy="24" r={R} fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - fraction)} transform="rotate(-90 24 24)" />
    {/if}
  </svg>
  <span class="text" translate="no">{text}</span>
</div>

<style>
  .ring {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  svg {
    flex: none;
  }

  /* The track is a line of its own: 3:1 against the page (WCAG 1.4.11), not a faint copy of the bar. */
  .track {
    stroke: var(--r-border);
    stroke-width: 3;
  }

  .bar {
    stroke: var(--r-accent);
  }

  .text {
    font-variant-numeric: tabular-nums;
    color: var(--r-fg);
  }

  /* A phone: a small ring and smaller text, so the header leaves room for the question (UX-003). */
  @media (max-width: 30rem) {
    .ring {
      gap: 0.5rem;
    }

    svg {
      width: 2rem;
      height: 2rem;
    }

    .text {
      font-size: 0.875rem;
    }
  }
</style>
