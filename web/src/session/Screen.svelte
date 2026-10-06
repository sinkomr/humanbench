<!--
  A page of the session flow (ROADMAP M1.15; DESIGN §13 keyboard and screen-reader use): the main
  landmark with the screen's one <h1>. Each new screen moves focus to its heading (tabindex -1, a
  programmatic target that is not in the tab order), so a keyboard or screen-reader user starts at
  the top of what changed; the first screen of a page load leaves focus alone (`focus={false}`).
  A later question of a part names a labelled region of its own with `focusId`: focus goes there
  instead, so the part's name is not read again for every question (UX-REVIEW D21, a provisional
  default; WCAG 2.4.3). If that element is not there or cannot take focus (it is hidden), the heading
  takes it as usual.
  Mobile WebKit keeps the old scroll offset when a screen is replaced and `focus()` does not scroll
  it back reliably, so a screen that takes focus also scrolls to the top once it is laid out
  (UX-001): a question must never open scrolled past its heading. The tab title names the screen
  (WCAG 2.4.2, UX-006).
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import '../render/common/render.css'
  import './session.css'
  import { pageTitle } from './title'

  interface Props {
    readonly title: string
    /** Move focus to the heading (and the scroll to the top) when the screen appears (default true). */
    readonly focus?: boolean
    /** The id of an element inside this screen (a region with a name, `tabindex="-1"`) that takes focus in place of the heading. */
    readonly focusId?: string
    /** A wider column (the running session with its checklist). */
    readonly wide?: boolean
    /** `'no'` keeps page translators away from a heading that is a name (the product name on the welcome screen). */
    readonly translate?: 'yes' | 'no'
    readonly children: Snippet
  }

  let { title, focus = true, focusId, wide = false, translate, children }: Props = $props()

  const uid = $props.id()
  let main: HTMLElement | undefined = $state()
  let heading: HTMLHeadingElement | undefined = $state()

  onMount(() => {
    document.title = pageTitle(title)
    if (!focus) return
    const found = focusId === undefined ? null : document.getElementById(focusId)
    const region = found !== null && main?.contains(found) === true ? found : null
    region?.focus({ preventScroll: true })
    if (region === null || document.activeElement !== region) heading?.focus({ preventScroll: true })
    // After the frame in which the new screen is laid out, so the scroll offset is not clamped to the old, longer page.
    const frame = requestAnimationFrame(() => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  })
</script>

<main class="hb-render hb-screen" class:wide aria-labelledby="{uid}-h" bind:this={main}>
  <h1 id="{uid}-h" tabindex="-1" bind:this={heading} {translate}>{title}</h1>
  {@render children()}
</main>
