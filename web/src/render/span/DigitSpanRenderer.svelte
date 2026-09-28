<!--
  Digit span board, forward and backward (ROADMAP M1.9, M1.13, A10; DESIGN §3 row 8, §14.6 ex. 10).
  Each trial presents its digits one at a time at the spec's rate (800 ms on, 200 ms off), locked to
  animation frames, then takes the entry on an on-screen keypad or the digit keys. The family's
  state machine (`advanceSpan`, via `run.ts`) picks the next trial and ends the block; the response
  is the list of entered sequences, one per trial given (`SpanResponse`), which is what score()
  takes. No correctness is shown (§10).
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import Keypad from '../common/Keypad.svelte'
  import { digitOfKey, isControlTarget, isOwnKey } from '../common/focus'
  import { browserTiming, type RendererProps } from '../common/props'
  import { afterFrames, presentSequence } from '../common/sequence'
  import { DIGITS, type SpanResponse, type SpanSpec } from '../../tasks/span/config'
  import { SPAN_LEAD_MS, SPAN_PAUSE_MS, spanNext } from './run'

  let { spec, onrespond, timing }: RendererProps<SpanSpec, SpanResponse> = $props()

  type Phase = 'intro' | 'present' | 'entry' | 'pause' | 'done'

  const uid = $props.id()
  let phase: Phase = $state('intro')
  let trial = $state(0)
  let shown: number | null = $state(null)
  let entered: number[] = $state([])
  let root: HTMLElement | undefined = $state()
  let stage: HTMLElement | undefined = $state()
  const responses: number[][] = []
  let cancel: (() => void) | null = null

  const frames = $derived((timing ?? browserTiming()).frames)
  const length = $derived(spec.trials[trial]?.length ?? 0)
  const backward = $derived(spec.recall === 'backward')
  const slots = $derived(Array.from({ length }, (_, i) => i))

  function runTrial(index: number): void {
    const seq = spec.trials[index]
    if (!seq) return
    trial = index
    entered = []
    shown = null
    phase = 'present'
    flushSync()
    stage?.focus()
    cancel = presentSequence(
      frames,
      seq.length,
      spec.timing,
      {
        show: (k) => {
          shown = seq[k] ?? null
          flushSync()
        },
        hide: () => {
          shown = null
          flushSync()
        },
        done: () => {
          phase = 'entry'
          flushSync()
          // Focus stays on the display, so Enter means Done (not a press of a focused key).
          stage?.focus()
        },
      },
      SPAN_LEAD_MS,
    ).cancel
  }

  function start(): void {
    const status = spanNext(spec, responses)
    if (!status.finished) runTrial(status.trial)
  }

  function add(d: number): void {
    if (phase !== 'entry' || entered.length >= length) return
    entered = [...entered, d]
  }

  function erase(): void {
    if (phase === 'entry') entered = entered.slice(0, -1)
  }

  function finishTrial(): void {
    if (phase !== 'entry') return
    responses.push([...entered])
    const status = spanNext(spec, responses)
    if (status.finished) {
      phase = 'done'
      flushSync()
      stage?.focus()
      onrespond(responses.map((r) => [...r]))
      return
    }
    phase = 'pause'
    flushSync()
    stage?.focus()
    cancel = afterFrames(frames, SPAN_PAUSE_MS, () => runTrial(status.trial))
  }

  function onkey(event: KeyboardEvent): void {
    if (phase !== 'entry' || !isOwnKey(root, event)) return
    const d = digitOfKey(event)
    if (event.repeat) {
      // A held key enters, erases or finishes once, as the coding and RT renderers do.
      if (d !== null || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') event.preventDefault()
      return
    }
    if (d !== null && d >= 1) {
      event.preventDefault()
      add(d)
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      erase()
    } else if (event.key === 'Enter' && !isControlTarget(event)) {
      event.preventDefault()
      finishTrial()
    }
  }

  onDestroy(() => cancel?.())
</script>

<svelte:window onkeydown={onkey} />

<section class="hb-render span" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">{backward ? 'Digits, reverse order' : 'Digits, same order'}</p>
  {#if phase === 'intro'}
    <p class="hb-instructions">
      You will see digits one at a time. When the sequence ends, enter them
      {backward ? 'in reverse order, starting with the last digit you saw' : 'in the same order you saw them'},
      using the keypad or the number keys, then choose Done. Sequences get longer as you go.
    </p>
    <button type="button" class="hb-btn hb-primary" onclick={start}>Start</button>
  {:else}
    <div class="stage" bind:this={stage} tabindex="-1">
      <p class="digit" aria-live="assertive" aria-atomic="true">{phase === 'present' && shown !== null ? shown : ''}</p>
    </div>
    <p class="hb-status" aria-live="polite">
      {#if phase === 'present'}Watch the digits.{:else if phase === 'entry'}Enter {length} digits{backward ? ', last one first' : ''}.{:else if phase === 'pause'}Next sequence coming up.{:else}Block complete. Thank you.{/if}
    </p>
    {#if phase === 'entry'}
      <ol class="slots" aria-label="Your entry, {entered.length} of {length} digits">
        {#each slots as i (i)}
          <li class="slot">{entered[i] ?? ''}</li>
        {/each}
      </ol>
      <Keypad digits={DIGITS} label="Digit keypad" onpress={add} />
      <div class="hb-actions">
        <button type="button" class="hb-btn" onclick={erase} disabled={entered.length === 0}>Delete</button>
        <button type="button" class="hb-btn hb-primary" onclick={() => finishTrial()}>Done</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .span {
    padding: 0.5rem 0;
  }

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  .stage {
    display: grid;
    place-items: center;
    min-height: 7rem;
    max-width: 20rem;
    border: 2px solid var(--r-border);
    border-radius: 0.75rem;
    background: var(--r-surface);
  }

  .digit {
    margin: 0;
    font-size: 4rem;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    min-height: 1em;
  }

  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0.5rem 0 0.75rem;
    padding: 0;
    list-style: none;
  }

  .slot {
    width: 2.25rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    border-bottom: 3px solid var(--r-border);
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }
</style>
