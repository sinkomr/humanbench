<!--
  The explanation of a skill, shown wherever the skill is named (ROADMAP M6.1; DESIGN R-5.6.2, §13): a
  small button that opens the text as a tooltip. It is a disclosure, so it works for everyone:

  - touch, mouse and keyboard: the button toggles it (`aria-expanded`, `aria-controls`); Enter and
    Space are the button's own;
  - a mouse also opens it by hovering over the button or the text, and closes it again on leaving
    (unless it was opened with a click), and the text stays while the pointer is on it (WCAG 1.4.13:
    hoverable and persistent);
  - Escape closes it (dismissible) wherever focus is: Safari does not focus a button that is clicked, so
    the key is read on the document while the text is open. A press outside closes it too.

  The text is the caller's, word for word (here `EMO_TOOLTIP`, the R-5.6.2 sentence). The button's accessible
  name is the visible label followed by the skill ("About this skill: Emotion Reading (text scenarios)", which
  keeps the visible words in the name, WCAG 2.5.3), so a screen-reader user hears the skill named, then
  "button, collapsed". The text is always in the DOM and hidden while closed, and the button also describes
  itself with it (`aria-describedby`), so it is read once whichever way it is reached. The panel sits over the
  content below it (absolute), so opening it never moves the page. Its frame is the nearest positioned
  ancestor, which the caller makes its header (`position: relative`): the panel then spans that header's
  width, up to 26rem, and can never reach past the edge of the page.
-->
<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    /** The skill's name: part of the button's accessible name. */
    name: string
    /** The words shown, exactly. */
    text: string
    /** The button's visible label. */
    label: string
    /** The hint after the text, for the keyboard. */
    hint?: string
  }

  let { name, text, label, hint }: Props = $props()

  const uid = $props.id()
  let open = $state(false)
  /** Opened by a click or key press: hovering away does not close it. */
  let pinned = $state(false)
  let root: HTMLElement | undefined = $state()
  let button: HTMLButtonElement | undefined = $state()

  function toggle(): void {
    if (open && pinned) {
      open = false
      pinned = false
    } else {
      open = true
      pinned = true
    }
  }

  function hover(event: PointerEvent, entering: boolean): void {
    if (event.pointerType !== 'mouse' || pinned) return
    open = entering
  }

  // Escape closes it wherever focus is; focus goes back to the button only if it was inside.
  $effect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const inside = root?.contains(document.activeElement) ?? false
      open = false
      pinned = false
      if (inside) button?.focus()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  })

  onMount(() => {
    const away = (event: Event): void => {
      if (open && root && event.target instanceof Node && !root.contains(event.target)) {
        open = false
        pinned = false
      }
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  })
</script>

<div bind:this={root} class="skill-tip" role="presentation" onpointerenter={(e) => hover(e, true)} onpointerleave={(e) => hover(e, false)}>
  <button
    bind:this={button}
    type="button"
    class="hb-btn tip-button"
    aria-expanded={open}
    aria-controls="{uid}-text"
    aria-describedby="{uid}-text"
    aria-label="{label}: {name}"
    onclick={toggle}
  >
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
      <rect x="7.25" y="7" width="1.5" height="5" fill="currentColor" />
      <circle cx="8" cy="4.75" r="1" fill="currentColor" />
    </svg>
    <span class="label">{label}</span>
  </button>
  <div id="{uid}-text" class="panel" role="tooltip" hidden={!open}>
    <p class="text">{text}</p>
    {#if hint}<p class="hint">{hint}</p>{/if}
  </div>
</div>

<style>
  .skill-tip {
    display: inline-block;
  }

  .tip-button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem;
    font-size: 0.9375rem;
  }

  .icon {
    flex: none;
  }

  .panel {
    position: absolute;
    z-index: 5;
    top: calc(100% + 0.375rem);
    left: 0;
    right: 0;
    max-width: 26rem;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    color: var(--r-fg);
  }

  .panel[hidden] {
    display: none;
  }

  .text {
    margin: 0;
  }

  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    color: var(--r-muted);
  }
</style>
