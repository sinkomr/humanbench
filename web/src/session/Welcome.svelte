<!--
  The first screen (ROADMAP M1.15; DESIGN §10, §13). Nothing is read or written here: the 18+ gate comes next.
  On the first load focus stays where the browser put it; when the person comes back here ("Back to the start")
  the heading takes focus like on every other screen (`focus`, UX-006).
-->
<script lang="ts">
  import Screen from './Screen.svelte'
  import { PRIVACY_LINK, WELCOME_HEADING, WELCOME_INTRO, WELCOME_START, WELCOME_TAGLINE } from './copy'

  interface Props {
    readonly onstart: () => void
    /** Move focus to the heading (a return to this screen); default false (the first screen of a page load). */
    readonly focus?: boolean
  }

  let { onstart, focus = false }: Props = $props()
</script>

<Screen title={WELCOME_HEADING} {focus} translate="no">
  <p class="lead">{WELCOME_TAGLINE}</p>
  <p>{WELCOME_INTRO}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={onstart}>{WELCOME_START}</button>
  </div>
  <p class="privacy"><a class="hb-standalone-link" href="#/privacy">{PRIVACY_LINK}</a></p>
</Screen>

<style>
  /* Its own line, clear of Start, and a target of 44 px (UX-016). */
  .privacy {
    margin-top: 1rem;
  }

  .privacy a {
    display: inline-block;
    padding: 0.625rem 0;
  }
</style>
