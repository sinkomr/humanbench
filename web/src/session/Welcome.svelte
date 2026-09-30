<!-- The first screen (ROADMAP M1.15; DESIGN §10, §13). Nothing is read or written here: the 18+ gate comes next. -->
<script lang="ts">
  import Screen from './Screen.svelte'
  import { PRIVACY_LINK, WELCOME_HEADING, WELCOME_INTRO, WELCOME_START, WELCOME_TAGLINE } from './copy'

  interface Props {
    readonly onstart: () => void
  }

  let { onstart }: Props = $props()
</script>

<Screen title={WELCOME_HEADING} focus={false}>
  <p class="lead">{WELCOME_TAGLINE}</p>
  <p>{WELCOME_INTRO}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={onstart}>{WELCOME_START}</button>
  </div>
  <p><a href="#/privacy">{PRIVACY_LINK}</a></p>
</Screen>
