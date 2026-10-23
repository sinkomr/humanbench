<!--
  syllogism renderer (DESIGN §3 row 2, §4.2, §11.6, §13; ROADMAP M1.13, A18): a formal-deduction item as text.

  Takes only the item's `spec` (never the key): the line "The words are made up." when the item has one, the
  statements as a numbered list (a real `<ol>`, named "Statements", so a screen reader announces a list of n items),
  then the question as the legend of the shared OptionGroup and the five options as text cards in one column, in
  `spec.options` order. Plain text is its own alternative: each option's radio is named by its letter and its full text
  ("B. …"), every option alike, and nothing says which one is right. Every string is written as text, never as markup.

  The OptionGroup's cards are laid out as a row here (the letter first, then the words), and long words wrap inside the
  column at 320 px, at 200% text and with a wide font. `onrespond(index)` gets the chosen display position (what
  `syllogism.score()` takes). `onshown(t)` reports the rAF timestamp (performance.now() clock) of the first frame
  showing the item, and the options accept a choice only from then on. Text always draws, so `onunavailable` is never
  called. No animation.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { SyllogismResponse, SyllogismSpec } from '../../tasks/syllogism/spec'
  import OptionGroup from '../choice/OptionGroup.svelte'
  import { optionLetter } from '../choice/keys'
  import { STATEMENTS_LABEL, optionName } from './copy'

  interface Props {
    /** The item's render payload (never the key). */
    spec: SyllogismSpec
    /** The chosen option's display position (the syllogism family's response type). */
    onrespond: (response: SyllogismResponse) => void
    /** rAF timestamp (ms, performance.now() clock) of the first frame showing the item. */
    onshown?: (onsetMs: number) => void
    /** Part of the shared renderer props (visual.ts); never called: text always draws. */
    onunavailable?: () => void
    disabled?: boolean
  }

  let { spec, onrespond, onshown, disabled = false }: Props = $props()

  /** The spec whose onset was reported (its options unlock then). */
  let shownFor: SyllogismSpec | null = $state.raw(null)
  const shown = $derived(shownFor === spec)
  $effect(() => {
    const s = spec
    if (untrack(() => shownFor) === s) return
    // The text is in the DOM when effects run; the next frame is the first to show it.
    const frame = requestAnimationFrame((t) => {
      shownFor = s
      onshown?.(t)
    })
    return () => cancelAnimationFrame(frame)
  })
</script>

<div class="syllogism hb-render">
  {#if spec.intro !== undefined}
    <p class="intro">{spec.intro}</p>
  {/if}
  <ol class="premises" aria-label={STATEMENTS_LABEL}>
    {#each spec.premises as premise, i (i)}
      <li>{premise}</li>
    {/each}
  </ol>
  {#key spec}
    <OptionGroup
      count={spec.options.length}
      legend={spec.question}
      optionName={(i) => optionName(optionLetter(i), spec.options[i] ?? '')}
      {onrespond}
      disabled={disabled || !shown}
      columns={{ narrow: 1, wide: 1 }}
      maxWidth="40rem"
    >
      {#snippet option(i: number)}
        <span class="words">{spec.options[i]}</span>
      {/snippet}
    </OptionGroup>
  {/key}
</div>

<style>
  .syllogism {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 42rem;
    min-width: 0;
    font-size: 1.0625rem;
    line-height: 1.5;
  }

  .intro {
    margin: 0;
    font-style: italic;
  }

  .premises {
    margin: 0;
    padding: 0.75rem 1rem 0.75rem 2.75rem;
    border-left: 4px solid var(--r-border);
    background: var(--r-surface);
    color: var(--r-fg);
  }

  .premises li + li {
    margin-top: 0.375rem;
  }

  .premises li,
  .words {
    overflow-wrap: anywhere;
  }

  /* Text options: the OptionGroup card as a row, its letter first and the words beside it, left-aligned. */
  .syllogism :global(.card) {
    flex-direction: row-reverse;
    justify-content: flex-end;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    min-height: 2.75rem;
  }

  .syllogism :global(.figure) {
    flex: 1;
    min-width: 0;
    line-height: 1.5;
    text-align: left;
  }

  .syllogism :global(.letter) {
    flex: none;
  }

  .words {
    display: block;
    color: var(--r-fg);
  }
</style>
