<!--
  Symbol-digit coding block (ROADMAP M1.11, M1.13, A10; DESIGN §3 row 10, §7.1). The legend (the
  spec's glyph–digit pairs, in its order) stays on view; one glyph at a time is shown and the taker
  types its digit on the keypad or the digit keys, and the next glyph follows at once. The 90 s
  window (`spec.duration_s`) starts in the animation frame that draws the first glyph and is
  measured with `performance.now()`; each press records its digit and its time from that frame
  (`CodingResponse`). The block ends when the window closes or every glyph is answered, and the
  response list goes to `onrespond`. No right/wrong feedback is shown.
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import Keypad from '../common/Keypad.svelte'
  import { digitOfKey, isOwnKey } from '../common/focus'
  import { browserTiming, type RendererProps } from '../common/props'
  import { responseTimestamp } from '../../tasks/rt/timing'
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
  let stageEl: HTMLElement | undefined = $state()
  const responses: CodingResponse[] = []
  let t0 = 0
  let handle: number | null = null

  const t = $derived(timing ?? browserTiming())
  const windowMs = $derived(spec.duration_s * 1000)
  const current = $derived(spec.sequence[index])

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
    stageEl?.focus()
    // The window opens in the frame that draws the first glyph.
    handle = t.frames.request((ts) => {
      handle = null
      t0 = ts
      visible = true
      flushSync()
      loop()
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
    onrespond(responses.map((r) => ({ ...r })))
  }

  function press(digit: number): void {
    if (phase !== 'running' || !visible) return
    const at = responseTimestamp(t.clock) - t0
    if (at >= windowMs) {
      finish('time')
      return
    }
    const last = responses[responses.length - 1]?.t_ms ?? 0
    responses.push({ digit, t_ms: Math.max(at, last, 0) })
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
    press(d)
  }

  onDestroy(() => {
    if (handle !== null) t.frames.cancel(handle)
  })
</script>

<svelte:window onkeydown={onkey} />

<section class="hb-render coding" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">Symbol to digit</p>
  <ul class="legend" aria-label="Key: each shape and its digit">
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
      Each shape in the key above has a digit. Shapes will appear one at a time: type the digit that goes with each shape, using
      the keypad or the number keys, as quickly and accurately as you can. You have {spec.duration_s} seconds.
    </p>
    <button type="button" class="hb-btn hb-primary" onclick={() => start()}>Start</button>
  {:else if phase === 'running'}
    <p class="timer" role="timer" aria-label="Time left">{format(secondsLeft)}</p>
    <div class="stage" bind:this={stageEl} tabindex="-1">
      {#if visible && current !== undefined}
        <Glyph symbol={current} size="5rem" />
      {/if}
    </div>
    <p class="hb-sr-only" aria-live="assertive" aria-atomic="true">{visible && current !== undefined ? GLYPHS[current].name : ''}</p>
    <Keypad digits={CODING_DIGITS} label="Digit keypad" onpress={press} />
  {:else}
    <p class="hb-status">{endedBy === 'time' ? 'Time is up.' : 'You answered every shape.'} Thank you.</p>
  {/if}
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

  .legend {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(2.75rem, 1fr));
    gap: 0.375rem;
    max-width: 32rem;
    margin: 0 0 1rem;
    padding: 0;
    list-style: none;
  }

  .cell {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0.25rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  .legend-digit {
    font-size: 1.25rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
  }
</style>
