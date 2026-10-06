<!--
  "About these numbers" (DESIGN §7.3 tooltips, §7.1 (3); ROADMAP M1.R): rough external comparisons
  for the parts the person did, and the separate Pace note. Nothing here changes the profile.
  - External norms, worded as rough context: reading speed against Brysbaert (2019), digit span,
    and a reaction time against web-relative figures only (`norms.ts`).
  - Pace: how long the person took per question against the typical time (a disclosure, so it is
    reachable by keyboard and touch; a hover-only tooltip would not be, WCAG 1.4.13).
  - "vs other HumanBench takers (a self-selected, likely above-average group)" is HIDDEN until A12
    allows percentiles (after M4 linking, N >= 500): it renders only if `takerComparison` is true.
-->
<script lang="ts">
  import { hasNorms, TAKER_COMPARISON, WEB_SIMPLE_RT_MEDIAN_MS, type NormFacts, type PaceRow } from './norms'
  import {
    NORMS_LATEST,
    NORMS_NONE,
    NUMBERS_HEADING,
    NUMBERS_INTRO,
    PACE_BASIS,
    PACE_HEADING,
    PACE_LABEL,
    PACE_NONE,
    PACE_TEXT,
    TAKER_COMPARISON_TEXT,
    paceLine,
    readingNorm,
    rtNorm,
    spanNorm,
  } from './copy'
  import './reveal.css'

  interface Props {
    readonly facts: NormFacts
    readonly pace: readonly PaceRow[]
    /** Show the "vs other HumanBench takers" wording (A12: only after M4 linking with N >= 500). */
    readonly takerComparison?: boolean
  }

  let { facts, pace, takerComparison = TAKER_COMPARISON.enabled }: Props = $props()

  const uid = $props.id()
</script>

<section class="hb-reveal-panel numbers" aria-labelledby="{uid}-h" data-section="numbers">
  <h2 id="{uid}-h">{NUMBERS_HEADING}</h2>
  <p>{NUMBERS_INTRO}</p>

  {#if hasNorms(facts)}
    <p class="norms-from">{NORMS_LATEST}</p>
    <ul class="norms">
      {#if facts.readingWpm !== null}<li data-norm="reading">{readingNorm(facts.readingWpm)}</li>{/if}
      {#if facts.digitsForward !== null || facts.digitsBackward !== null}
        <li data-norm="span">{spanNorm(facts.digitsForward, facts.digitsBackward)}</li>
      {/if}
      {#if facts.simpleRtMs !== null}<li data-norm="rt">{rtNorm(facts.simpleRtMs, WEB_SIMPLE_RT_MEDIAN_MS)}</li>{/if}
    </ul>
  {:else}
    <p>{NORMS_NONE}</p>
  {/if}

  {#if takerComparison}
    <p data-taker-comparison>{TAKER_COMPARISON_TEXT}</p>
  {/if}

  <details class="pace" data-section="pace">
    <summary>{PACE_HEADING}</summary>
    <p>{PACE_TEXT}</p>
    {#if pace.length === 0}
      <p>{PACE_NONE}</p>
    {:else}
      <ul>
        {#each pace as row (row.code)}
          <li data-pace={row.code}>{paceLine(row.name, Math.round(row.medianS), PACE_LABEL[row.label])}</li>
        {/each}
      </ul>
    {/if}
    <p class="note">{PACE_BASIS}</p>
  </details>
</section>
