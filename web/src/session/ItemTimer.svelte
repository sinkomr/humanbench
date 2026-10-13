<!--
  The timer of the question on screen (owner feedback 2026-10-13; DESIGN §10, §13; `item-timer.ts`): how long
  is left before the question runs out of time, shown for the whole time a question waits for its answer.
  - Unobtrusive: one small line above the question, tabular digits, no animation at any time (so there is
    nothing for `prefers-reduced-motion` to switch off).
  - Always available: `role="timer"` with a spoken label, so a screen-reader user can read it whenever they
    want; a timer is not a live region, so it is not read out as it counts.
  - The warning (the last 30 seconds, `ITEM_TIME_WARN_S`): the line gains the words "Time is nearly up", a
    mark and a frame, not only a colour, and a separate status line says it ONCE (it is empty until the
    warning starts and does not change after).
  - A typed-answer question also says, in the warning, that an answer counts only once it is entered: the
    person the owner describes had the right answer worked out and had not entered it.
-->
<script lang="ts">
  import { ITEM_TIMER_ENTRY_HINT, ITEM_TIMER_LABEL, ITEM_TIMER_WARN, itemTimerAnnounce, itemTimerSpoken } from './copy'
  import { timerSpoken, timerText, timerWarns, warnAtS } from './item-timer'

  interface Props {
    /** Seconds left before the question runs out of time. */
    readonly leftS: number
    /** The question's time limit in seconds. */
    readonly limitS: number
    /** The answer is typed (numeric or text entry), not chosen: the warning adds what entering means. */
    readonly typed?: boolean
  }

  let { leftS, limitS, typed = false }: Props = $props()

  const warn = $derived(timerWarns(leftS, limitS))
  const text = $derived(timerText(leftS))
</script>

<div class="item-timer" class:warn data-item-timer data-warn={warn ? 'true' : 'false'}>
  <p class="line">
    <span class="label" aria-hidden="true">{ITEM_TIMER_LABEL}</span>
    <span class="value" role="timer" aria-label={itemTimerSpoken(timerSpoken(leftS))} translate="no">{text}</span>
    {#if warn}
      <strong class="flag" aria-hidden="true"><span class="mark">!</span> {ITEM_TIMER_WARN}</strong>
    {/if}
  </p>
  {#if warn && typed}
    <p class="hint" data-item-timer-hint>{ITEM_TIMER_ENTRY_HINT}</p>
  {/if}
  <!-- Mounted from the start and empty until the warning: its one change is the one announcement. -->
  <p class="hb-sr-only" role="status" data-item-timer-status>{warn ? `${itemTimerAnnounce(warnAtS(limitS))}${typed ? ` ${ITEM_TIMER_ENTRY_HINT}` : ''}` : ''}</p>
</div>

<style>
  .item-timer {
    margin: 0 0 0.5rem;
    font-size: 0.875rem;
    color: var(--r-muted);
  }

  .line {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin: 0;
    padding: 0.125rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
  }

  .value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--r-fg);
  }

  /* The warning: a frame, heavier digits and words; the colour only adds to them. */
  .warn .line {
    border-color: var(--r-fg);
    border-width: 2px;
    color: var(--r-fg);
    background: var(--r-surface);
  }

  .warn .value {
    font-weight: 700;
  }

  .flag {
    font-weight: 700;
  }

  .mark {
    display: inline-grid;
    place-items: center;
    width: 1.125rem;
    height: 1.125rem;
    border: 2px solid currentColor;
    border-radius: 50%;
    font-size: 0.75rem;
    line-height: 1;
  }

  .hint {
    margin: 0.25rem 0 0;
    color: var(--r-fg);
  }
</style>
