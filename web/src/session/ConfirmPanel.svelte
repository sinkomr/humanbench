<!--
  An inline confirmation (ROADMAP M1.15): "Skip Spatial?" or "Finish now?". Not a modal: the page
  behind stays as it is, and a block on screen keeps running, so the panel sits where the person's
  eyes are and takes focus on its heading (WCAG 2.4.3); "Keep going" returns focus to what opened it.
-->
<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    readonly heading: string
    readonly text: string
    readonly yes: string
    readonly no: string
    readonly onyes: () => void
    readonly onno: () => void
  }

  let { heading, text, yes, no, onyes, onno }: Props = $props()

  const uid = $props.id()
  let h: HTMLHeadingElement | undefined = $state()

  onMount(() => h?.focus())
</script>

<section class="hb-render confirm" aria-labelledby="{uid}-h">
  <h2 id="{uid}-h" tabindex="-1" bind:this={h}>{heading}</h2>
  <p>{text}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={onyes}>{yes}</button>
    <button type="button" class="hb-btn" onclick={onno}>{no}</button>
  </div>
</section>

<style>
  .confirm {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }

  h2:focus {
    outline: none;
  }

  p {
    margin: 0 0 0.5rem;
  }
</style>
