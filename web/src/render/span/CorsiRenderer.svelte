<!--
  Corsi block board (ROADMAP M1.9, M1.13, A10; DESIGN §3 row 8, §14.6 ex. 11). The 9 blocks sit at
  the fixed board coordinates of the spec (`CORSI_BOARD`), the same for every item. Each trial
  lights blocks one at a time at the spec's rate, locked to animation frames, then the taker
  repeats the order by clicking or tapping blocks, or from the keyboard (arrow keys move between
  blocks, Enter or Space picks one, 1–9 pick a block by its number, Backspace undoes; held keys do
  not repeat a pick). The numbers are the blocks' accessible names only: they are not drawn, so a
  sighted taker cannot recode the positions as a digit string (the task stays visuospatial). The family's
  state machine (`advanceSpan`, via `run.ts`) picks the next trial and ends the block; the response
  is the list of picked block indices per trial given (`SpanResponse`). Blocks carry only their
  fixed number, and nothing marks the target order in the DOM.
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import { digitOfKey, isControlTarget, isOwnKey } from '../common/focus'
  import { browserTiming, type RendererProps } from '../common/props'
  import { afterFrames, presentSequence } from '../common/sequence'
  import { CORSI_BOARD, type SpanResponse, type SpanSpec } from '../../tasks/span/config'
  import { SPAN_LEAD_MS, SPAN_PAUSE_MS, directionOfKey, nearestInDirection, spanNext } from './run'

  let { spec, onrespond, timing }: RendererProps<SpanSpec, SpanResponse> = $props()

  type Phase = 'intro' | 'present' | 'entry' | 'pause' | 'done'

  const uid = $props.id()
  let phase: Phase = $state('intro')
  let trial = $state(0)
  let lit: number | null = $state(null)
  let picked: number[] = $state([])
  let focusIndex = $state(0)
  let root: HTMLElement | undefined = $state()
  let boardEl: HTMLElement | undefined = $state()
  const responses: number[][] = []
  let cancel: (() => void) | null = null

  const frames = $derived((timing ?? browserTiming()).frames)
  const board = $derived(spec.board ?? CORSI_BOARD)
  const length = $derived(spec.trials[trial]?.length ?? 0)

  /** A board fraction as a CSS percentage, rounded (no 4.000000000000001%). */
  const pct = (v: number): string => `${Math.round(v * 1e6) / 1e4}%`

  function blockButtons(): HTMLButtonElement[] {
    return [...(boardEl?.querySelectorAll<HTMLButtonElement>('button.block') ?? [])]
  }

  function runTrial(index: number): void {
    const seq = spec.trials[index]
    if (!seq) return
    trial = index
    picked = []
    lit = null
    phase = 'present'
    flushSync()
    boardEl?.focus()
    cancel = presentSequence(
      frames,
      seq.length,
      spec.timing,
      {
        show: (k) => {
          lit = seq[k] ?? null
          flushSync()
        },
        hide: () => {
          lit = null
          flushSync()
        },
        done: () => {
          phase = 'entry'
          focusIndex = 0
          flushSync()
          blockButtons()[0]?.focus()
        },
      },
      SPAN_LEAD_MS,
    ).cancel
  }

  function start(): void {
    const status = spanNext(spec, responses)
    if (!status.finished) runTrial(status.trial)
  }

  function pick(i: number): void {
    if (phase !== 'entry' || picked.length >= length) return
    picked = [...picked, i]
    focusIndex = i
  }

  function undo(): void {
    if (phase === 'entry') picked = picked.slice(0, -1)
  }

  function finishTrial(): void {
    if (phase !== 'entry') return
    responses.push([...picked])
    const status = spanNext(spec, responses)
    if (status.finished) {
      phase = 'done'
      flushSync()
      boardEl?.focus()
      onrespond(responses.map((r) => [...r]))
      return
    }
    phase = 'pause'
    flushSync()
    boardEl?.focus()
    cancel = afterFrames(frames, SPAN_PAUSE_MS, () => runTrial(status.trial))
  }

  function onkey(event: KeyboardEvent): void {
    if (phase !== 'entry' || !isOwnKey(root, event)) return
    const dir = directionOfKey(event.key)
    const d = digitOfKey(event)
    if (dir !== null) {
      event.preventDefault()
      focusIndex = nearestInDirection(board.blocks, focusIndex, dir)
      blockButtons()[focusIndex]?.focus()
    } else if (event.repeat) {
      // A held key picks, undoes or finishes once, as the coding and RT renderers do.
      if (d !== null || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') event.preventDefault()
    } else if (d !== null && d >= 1 && d <= board.blocks.length) {
      event.preventDefault()
      pick(d - 1)
      blockButtons()[d - 1]?.focus()
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      undo()
    } else if (event.key === 'Enter' && !isControlTarget(event)) {
      event.preventDefault()
      finishTrial()
    }
  }

  onDestroy(() => cancel?.())
</script>

<svelte:window onkeydown={onkey} />

<section class="hb-render corsi" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">Block sequence</p>
  {#if phase === 'intro'}
    <p class="hb-instructions">
      Blocks on the board will light up one at a time. When the sequence ends, select the blocks in the same order: click or tap
      them, or use the arrow keys and Enter. Then choose Done. Sequences get longer as you go. With a screen reader, the blocks are
      named Block 1 to Block 9, and the number keys 1 to 9 select the block of that name.
    </p>
    <button type="button" class="hb-btn hb-primary" onclick={start}>Start</button>
  {:else}
    <div class="board" role="group" aria-label="Board of {board.blocks.length} blocks" bind:this={boardEl} tabindex="-1">
      {#each board.blocks as [x, y], i (i)}
        <button
          type="button"
          class="block"
          class:lit={phase === 'present' && lit === i}
          style:left={pct(x - board.size / 2)}
          style:top={pct(y - board.size / 2)}
          style:width={pct(board.size)}
          style:height={pct(board.size)}
          tabindex={phase === 'entry' && focusIndex === i ? 0 : -1}
          disabled={phase !== 'entry'}
          aria-label="Block {i + 1}"
          onclick={() => pick(i)}
        ></button>
      {/each}
    </div>
    <p class="hb-sr-only" aria-live="assertive" aria-atomic="true">{phase === 'present' && lit !== null ? `Block ${lit + 1}` : ''}</p>
    <p class="hb-status" aria-live="polite">
      {#if phase === 'present'}Watch the blocks.{:else if phase === 'entry'}Selected {picked.length} of {length}.{:else if phase === 'pause'}Next sequence coming up.{:else}Block complete. Thank you.{/if}
    </p>
    {#if phase === 'entry'}
      <div class="hb-actions">
        <button type="button" class="hb-btn" onclick={undo} disabled={picked.length === 0}>Undo</button>
        <button type="button" class="hb-btn hb-primary" onclick={() => finishTrial()}>Done</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .corsi {
    padding: 0.5rem 0;
  }

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  .board {
    position: relative;
    width: min(100%, 26rem);
    aspect-ratio: 1;
    border: 2px solid var(--r-border);
    border-radius: 0.75rem;
    background: var(--r-surface);
  }

  .block {
    position: absolute;
    min-width: 1.5rem;
    min-height: 1.5rem;
    padding: 0;
    border: 3px solid var(--r-block);
    border-radius: 0.375rem;
    background: var(--r-block);
    cursor: pointer;
    touch-action: manipulation;
  }

  .block:disabled {
    cursor: default;
  }

  .block.lit {
    background: var(--r-lit);
    border-color: var(--r-lit-ring);
    box-shadow: 0 0 0 3px var(--r-lit-ring);
  }

  .block:active:not(:disabled) {
    background: var(--r-lit);
  }
</style>
