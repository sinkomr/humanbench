<!--
  A page of the session flow (ROADMAP M1.15; DESIGN §13 keyboard and screen-reader use): the main
  landmark with the screen's one <h1>. Each new screen moves focus to its heading (tabindex -1, a
  programmatic target that is not in the tab order), so a keyboard or screen-reader user starts at
  the top of what changed; the first screen of a page load leaves focus alone (`focus={false}`).
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import '../render/common/render.css'
  import './session.css'

  interface Props {
    readonly title: string
    /** Move focus to the heading when the screen appears (default true). */
    readonly focus?: boolean
    /** A wider column (the running session with its checklist). */
    readonly wide?: boolean
    readonly children: Snippet
  }

  let { title, focus = true, wide = false, children }: Props = $props()

  const uid = $props.id()
  let heading: HTMLHeadingElement | undefined = $state()

  onMount(() => {
    if (focus) heading?.focus()
  })
</script>

<main class="hb-render hb-screen" class:wide aria-labelledby="{uid}-h">
  <h1 id="{uid}-h" tabindex="-1" bind:this={heading}>{title}</h1>
  {@render children()}
</main>
