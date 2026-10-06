<!--
  An inline confirmation (ROADMAP M1.15): "Skip Spatial?" or "Finish now?". Not a modal: the page
  behind stays as it is, and a block on screen keeps running, so the panel sits where the person's
  eyes are and takes focus on its heading (WCAG 2.4.3); "Keep going" returns focus to what opened it.
  Escape does what "Keep going" does (WCAG 2.1.1). On a phone the panel opens under the finger and scrolls
  into view, so the second tap of a double tap on the button that opened it lands on one of the panel's
  buttons: a tap on the panel that comes within a third of a second of another tap on the same spot is
  ignored (WCAG 2.5.2, UX-005a). A click from a mouse or the keyboard, and a tap somewhere else, never is.
  `primary="no"` puts the safe answer first and in the primary style, for a panel whose "yes" throws
  something away.
-->
<script module lang="ts">
  /** A press of a finger, a pen or a mouse anywhere on the page. */
  interface Press {
    readonly at: number
    readonly x: number
    readonly y: number
    readonly touch: boolean
  }

  /** Two taps this close in time and place are one double tap. */
  const DOUBLE_TAP_MS = 350
  const SAME_SPOT_PX = 32
  /** How soon after its press a tap's click arrives. */
  const CLICK_AFTER_TAP_MS = 800

  // The panel appears after the first tap, so the page keeps the last two presses for it (capture phase: before any handler).
  let current: Press | null = null
  let previous: Press | null = null
  if (typeof window !== 'undefined') {
    window.addEventListener(
      'pointerdown',
      (event) => {
        previous = current
        current = { at: performance.now(), x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' }
      },
      true,
    )
  }

  /** The press that is being handled is the second tap of a double tap. */
  function isSecondTap(): boolean {
    const now = current
    const before = previous
    if (now === null || before === null || !now.touch || !before.touch) return false
    return now.at - before.at < DOUBLE_TAP_MS && Math.hypot(now.x - before.x, now.y - before.y) < SAME_SPOT_PX
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    readonly heading: string
    readonly text: string
    readonly yes: string
    readonly no: string
    readonly onyes: () => void
    readonly onno: () => void
    /** Which answer is the primary one, and comes first: default 'yes'. */
    readonly primary?: 'yes' | 'no'
  }

  let { heading, text, yes, no, onyes, onno, primary = 'yes' }: Props = $props()

  const uid = $props.id()
  let h: HTMLHeadingElement | undefined = $state()
  /** A repeat tap went down on the panel: the click that follows it, until this time, is dropped. */
  let dropClickUntil = 0

  onMount(() => h?.focus())

  function pointerdown(): void {
    dropClickUntil = isSecondTap() ? performance.now() + CLICK_AFTER_TAP_MS : 0
  }

  /** Run `fn` unless this click is the tail of a repeat tap. */
  function answer(fn: () => void): void {
    if (performance.now() < dropClickUntil) {
      dropClickUntil = 0
      return
    }
    fn()
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    onno()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="hb-render confirm" aria-labelledby="{uid}-h" onkeydown={keydown} onpointerdown={pointerdown}>
  <h2 id="{uid}-h" tabindex="-1" bind:this={h}>{heading}</h2>
  <p>{text}</p>
  <div class="hb-actions">
    {#if primary === 'no'}
      <button type="button" class="hb-btn hb-primary" onclick={() => answer(onno)}>{no}</button>
      <button type="button" class="hb-btn" onclick={() => answer(onyes)}>{yes}</button>
    {:else}
      <button type="button" class="hb-btn hb-primary" onclick={() => answer(onyes)}>{yes}</button>
      <button type="button" class="hb-btn" onclick={() => answer(onno)}>{no}</button>
    {/if}
  </div>
</section>

<style>
  .confirm {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
    max-width: 38rem;
  }

  /* More specific than the screen's own heading and paragraph rules (session.css), which would add their margins. */
  .confirm h2 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }

  .confirm h2:focus {
    outline: none;
  }

  .confirm p {
    margin: 0 0 0.5rem;
  }
</style>
