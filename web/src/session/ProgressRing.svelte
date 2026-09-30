<!--
  The time-based progress ring (ROADMAP M1.15; DESIGN §10 "A progress ring shows *time*, not items,
  because adaptive item counts vary"). Elapsed active time over the session target, in whole minutes.
  It is a progressbar with a text value ("12 of about 28 min"), so the meaning is never in the ring's
  colour alone; the ring itself is decorative. It fills up and stays full when the person is past the
  target.
-->
<script lang="ts">
  import { OVER_TARGET, PROGRESS_LABEL, progressText } from './copy'

  interface Props {
    readonly elapsedS: number
    readonly targetS: number
  }

  let { elapsedS, targetS }: Props = $props()

  const R = 21
  const C = 2 * Math.PI * R

  const targetMin = $derived(Math.max(1, Math.round(targetS / 60)))
  const elapsedMin = $derived(Math.min(targetMin, Math.floor(elapsedS / 60)))
  const fraction = $derived(Math.max(0, Math.min(1, elapsedS / targetS)))
  const over = $derived(elapsedS >= targetS)
  const text = $derived(over ? OVER_TARGET : progressText(elapsedMin, targetMin))
</script>

<div class="ring" role="progressbar" aria-label={PROGRESS_LABEL} aria-valuemin={0} aria-valuemax={targetMin} aria-valuenow={elapsedMin} aria-valuetext={text} data-fraction={fraction.toFixed(3)}>
  <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
    <circle class="track" cx="24" cy="24" r={R} fill="none" stroke-width="5" />
    {#if fraction > 0}
      <circle class="bar" cx="24" cy="24" r={R} fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - fraction)} transform="rotate(-90 24 24)" />
    {/if}
  </svg>
  <span class="text">{text}</span>
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

  .track {
    stroke: var(--r-border);
    opacity: 0.45;
  }

  .bar {
    stroke: var(--r-accent);
  }

  .text {
    font-variant-numeric: tabular-nums;
    color: var(--r-fg);
  }
</style>
