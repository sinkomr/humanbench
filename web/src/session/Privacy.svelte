<!--
  Privacy and terms (ROADMAP M1.15; DESIGN §13 "GDPR/CCPA basics"). The controller's name and contact
  are placeholders marked TODO(user) until the user fills them in; the text describes exactly what
  this static version does (everything stays in the browser). The button removes what this site keeps
  in this browser (the stored consent and every autosave).
-->
<script lang="ts">
  import { browserStorage, type StorageLike } from '../save/autosave'
  import Screen from './Screen.svelte'
  import { PRIVACY_BACK, PRIVACY_FORGET, PRIVACY_FORGET_DONE, PRIVACY_FORGET_NONE, PRIVACY_HEADING, PRIVACY_SECTIONS } from './copy'
  import { forgetLocalData } from './gate'

  interface Props {
    /** localStorage, or a fake; read only when the person presses the delete button. */
    readonly storage?: () => StorageLike | null
  }

  let { storage = browserStorage }: Props = $props()

  let message = $state('')

  function forget(): void {
    message = forgetLocalData(storage()).length > 0 ? PRIVACY_FORGET_DONE : PRIVACY_FORGET_NONE
  }
</script>

<Screen title={PRIVACY_HEADING}>
  {#each PRIVACY_SECTIONS as section (section.heading)}
    <h2>{section.heading}</h2>
    {#each section.paragraphs as p (p)}
      <p>{p}</p>
    {/each}
  {/each}
  <div class="hb-actions">
    <button type="button" class="hb-btn" onclick={forget}>{PRIVACY_FORGET}</button>
  </div>
  <p role="status">{message}</p>
  <p><a class="hb-standalone-link" href="#/">{PRIVACY_BACK}</a></p>
</Screen>
