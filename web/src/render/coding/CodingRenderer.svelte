<!--
  Symbol-digit coding block (ROADMAP M1.11, M1.13, A10; DESIGN §3 row 10, §7.1). The legend (the
  spec's glyph–digit pairs, in its order) stays on view; one glyph at a time is shown and the taker
  types its digit on the keypad or the digit keys, and the next glyph follows at once. The 90 s
  window (`spec.duration_s`) starts in the animation frame that draws the first glyph and is
  measured with `performance.now()`; each press records its digit and its time from that frame (the press time is the input event's own timestamp when valid, else `performance.now()` in the handler; §11.6)
  (`CodingResponse`). The block ends when the window closes or every glyph is answered, and the
  response list goes to `onrespond`. No right/wrong feedback is shown. One polite status line
  stays mounted in every phase; when the block ends it says so and takes focus, so keyboard and
  screen-reader users keep their place (WCAG 2.4.3, 4.1.3; as the span renderers).

  On a phone the whole block (the table of shapes and digits, the target and the keypad) has to be
  on screen when the clock starts, because every scroll costs score (UX-002): the table is a
  one-row reference strip (not a row of keys), the target is smaller below 30rem, the keypad is one
  row of nine keys, and starting scrolls the table to the top of the screen.
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import Keypad from '../common/Keypad.svelte'
  import { digitOfKey, isOwnKey } from '../common/focus'
  import { browserTiming, type RendererProps } from '../common/props'
  import { BlockTimestampPolicy, responseTimestampFromEvent } from '../../tasks/rt/timing'
  import { CODING_DIGITS, type CodingResponse, type CodingResponses, type CodingSpec } from '../../tasks/coding/config'
  import Glyph from './Glyph.svelte'
  import { GLYPHS } from './glyphs'

  let { spec, onrespond, timing }: RendererProps<CodingSpec, CodingResponses> = $props()

  type Phase = 'intro' | 'running' | 'done'

  const uid = $props.id()
  let phase: Phase = $state('intro')
  let index = $state(0)
  let visible = $state(false)
  let secondsLeft = $state(0)
  let endedBy: 'time' | 'all' = $state('time')
  let root: HTMLElement | undefined = $state()
  let legendEl: HTMLElement | undefined = $state()
  let stageEl: HTMLElement | undefined = $state()
  let statusEl: HTMLElement | undefined = $state()
  const responses: CodingResponse[] = []
  // Both candidate clocks of each response, so the block's single source (§11.6) can be applied
  // at the end: there is no practice here, and the decision uses every response's lag.
  const raw: { digit: number; handlerAt: number; eventAt: number | null }[] = []
  const clockPolicy = new BlockTimestampPolicy()
  let t0 = 0
  let handle: number | null = null

  const t = $derived(timing ?? browserTiming())
  const windowMs = $derived(spec.duration_s * 1000)
  const current = $derived(spec.sequence[index])
  const doneText = $derived(`${endedBy === 'time' ? 'Time is up.' : 'You answered every shape.'} Thank you.`)

  function format(s: number): string {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  function loop(): void {
    handle = t.frames.request(() => {
      handle = null
      if (phase !== 'running') return
      const elapsed = t.clock.now() - t0
      if (elapsed >= windowMs) {
        finish('time')
        return
      }
      const left = Math.ceil((windowMs - elapsed) / 1000)
      if (left !== secondsLeft) secondsLeft = left
      loop()
    })
  }

  function start(): void {
    phase = 'running'
    index = 0
    visible = false
    secondsLeft = spec.duration_s
    flushSync()
    // Table, target and keypad in view before the clock starts; focus must not scroll them away again.
    legendEl?.scrollIntoView?.({ block: 'start' })
    stageEl?.focus({ preventScroll: true })
    // The window opens in the frame that draws the first glyph.
    handle = t.frames.request((ts) => {
      handle = null
      t0 = ts
      visible = true
      flushSync()
      loop()
    })
  }

  /** Responses timed with the block's one clock: the handler's if the event clock is offset, else the event's where usable. */
  function finalResponses(): CodingResponse[] {
    const d = clockPolicy.decide()
    let last = 0
    return raw.map((r) => {
      const at = d?.source === 'handler' || r.eventAt === null ? r.handlerAt : r.eventAt
      last = Math.max(at, last, 0)
      return { digit: r.digit, t_ms: last }
    })
  }

  function finish(by: 'time' | 'all'): void {
    if (phase !== 'running') return
    if (handle !== null) t.frames.cancel(handle)
    handle = null
    endedBy = by
    phase = 'done'
    visible = false
    flushSync()
    // The stage and keypad that held focus are gone: move focus to the status line.
    statusEl?.focus()
    onrespond(finalResponses())
  }

  function press(digit: number, event: { readonly timeStamp: number }): void {
    if (phase !== 'running' || !visible) return
    clockPolicy.observe(event, t.clock)
    const handlerAt = t.clock.now() - t0
    const stamp = responseTimestampFromEvent(event, t.clock, t0)
    const at = stamp.ts - t0
    if (at >= windowMs) {
      finish('time')
      return
    }
    const last = responses[responses.length - 1]?.t_ms ?? 0
    responses.push({ digit, t_ms: Math.max(at, last, 0) })
    raw.push({ digit, handlerAt, eventAt: stamp.source === 'event' ? at : null })
    if (responses.length >= spec.sequence.length) {
      finish('all')
      return
    }
    index = responses.length
  }

  function onkey(event: KeyboardEvent): void {
    if (phase !== 'running' || event.repeat || !isOwnKey(root, event)) return
    const d = digitOfKey(event)
    if (d === null) return
    event.preventDefault()
    press(d, event)
  }

  onDestroy(() => {
    if (handle !== null) t.frames.cancel(handle)
  })
</script>

<svelte:window onkeydown={onkey} />

<section class="hb-render coding" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">Shape to digit</p>
  <ul class="legend" aria-label="Shape-to-digit table" bind:this={legendEl}>
    {#each spec.legend as cell (cell.digit)}
      <li class="cell">
        <Glyph symbol={cell.symbol} size="2rem" decorative />
        <span class="hb-sr-only">{GLYPHS[cell.symbol].name}:</span>
        <span class="legend-digit">{cell.digit}</span>
      </li>
    {/each}
  </ul>
  {#if phase === 'intro'}
    <p class="hb-instructions">
      Each shape in the table above has a digit. Shapes will appear one at a time. For each shape, type its digit, with the
      on-screen keypad or the number keys on your keyboard. Be as fast and as accurate as you can. You have {spec.duration_s} seconds.
    </p>
    <button type="button" class="hb-btn hb-primary" onclick={() => start()}>Start</button>
  {:else if phase === 'running'}
    <p class="timer" role="timer" aria-label="Time left" translate="no">{format(secondsLeft)}</p>
    <div class="stage" role="group" aria-label="Shapes: type the digit for each shape" bind:this={stageEl} tabindex="-1">
      {#if visible && current !== undefined}
        <Glyph symbol={current} size="5rem" />
      {/if}
    </div>
    <p class="hb-sr-only" aria-live="assertive" aria-atomic="true">{visible && current !== undefined ? GLYPHS[current].name : ''}</p>
    <Keypad digits={CODING_DIGITS} label="Digit keypad" columns={CODING_DIGITS.length} onpress={press} />
  {/if}
  <p class="hb-status" aria-live="polite" tabindex="-1" bind:this={statusEl}>{phase === 'done' ? doneText : ''}</p>
</section>

<style>
  .coding {
    padding: 0.5rem 0;
  }

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  /* A reference strip, not a row of keys: one bordered band, borderless cells with hairline dividers. */
  .legend {
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr));
    max-width: 32rem;
    margin: 0 0 1rem;
    padding: 0;
    list-style: none;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
  }

  .cell {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0.25rem;
    border-left: 1px solid var(--r-border);
  }

  .cell:first-child {
    border-left: 0;
  }

  .legend-digit {
    font-size: 1.125rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--r-muted);
  }

  .timer {
    margin: 0 0 0.5rem;
    font-variant-numeric: tabular-nums;
    color: var(--r-muted);
  }

  .stage {
    display: grid;
    place-items: center;
    width: 8rem;
    height: 8rem;
    margin: 0 0 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.75rem;
    background: var(--r-bg);
    touch-action: manipulation;
  }

  /* A phone: key, target and keypad together stay under about 310 px of height. */
  @media (max-width: 29.99rem) {
    .title {
      margin-bottom: 0.5rem;
    }

    .legend {
      margin-bottom: 0.5rem;
    }

    .cell {
      gap: 0.125rem;
      padding: 0.25rem 0;
    }

    /* Never wider than its column, whatever the text size (200% text makes rem twice as wide, the columns not). */
    .cell :global(.glyph) {
      width: min(1.25rem, 80%);
      height: auto;
      aspect-ratio: 1;
    }

    .legend-digit {
      font-size: 1rem;
    }

    .timer {
      margin-bottom: 0.25rem;
    }

    .stage {
      width: 6rem;
      height: 6rem;
      margin-bottom: 0.5rem;
    }
  }
</style>
