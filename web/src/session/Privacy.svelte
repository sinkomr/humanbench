<!--
  Privacy and terms (ROADMAP M1.15; DESIGN §13 "GDPR/CCPA basics"). The controller's name and contact
  are placeholders marked TODO(user) until the user fills them in; the text describes exactly what
  this static version does (everything stays in the browser). The button removes what this site keeps
  in this browser (the stored consent and every autosave).
-->
<script lang="ts">
  import { browserStorage, type StorageLike } from '../save/autosave'
  import Screen from './Screen.svelte'
  import { DATA_LINK } from '../backend/copy'
  import { PRIVACY_BACK, PRIVACY_FORGET, PRIVACY_FORGET_DONE, PRIVACY_FORGET_NONE, PRIVACY_HEADING, PRIVACY_SECTIONS, type PrivacySection } from './copy'
  import { forgetLocalData } from './gate'

  interface Props {
    /** localStorage, or a fake; read only when the person presses the delete button. */
    readonly storage?: () => StorageLike | null
    /** The sections; default the static version's. The online version passes its own (ROADMAP M2.7). */
    readonly sections?: readonly PrivacySection[]
    /** Link to the page where data on the server can be fetched or deleted (the online version). */
    readonly dataLink?: boolean
    /**
     * "Back" goes by the browser's history when the notice was opened from a link inside the app (so the screen
     * it was opened from is where the person lands again); absent, "Back" is a plain link to the start (UX-011).
     */
    readonly onback?: () => void
  }

  let { storage = browserStorage, sections = PRIVACY_SECTIONS, dataLink = false, onback }: Props = $props()

  let message = $state('')

  function forget(): void {
    message = forgetLocalData(storage()).length > 0 ? PRIVACY_FORGET_DONE : PRIVACY_FORGET_NONE
  }
</script>

<Screen title={PRIVACY_HEADING}>
  {#each sections as section (section.heading)}
    <h2>{section.heading}</h2>
    {#each section.paragraphs as p (p)}
      <p>{p}</p>
    {/each}
  {/each}
  <div class="hb-actions">
    <button type="button" class="hb-btn" onclick={forget}>{PRIVACY_FORGET}</button>
  </div>
  <p role="status">{message}</p>
  {#if dataLink}
    <p><a class="hb-standalone-link" href="#/data">{DATA_LINK}</a></p>
  {/if}
  <p>
    <a
      class="hb-standalone-link"
      href="#/"
      onclick={(e) => {
        if (onback === undefined) return
        e.preventDefault()
        onback()
      }}>{PRIVACY_BACK}</a
    >
  </p>
</Screen>
