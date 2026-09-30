<!--
  The save file, prominent and required before leaving (DESIGN §10; ROADMAP M1.R, M1.17 wiring):
  download it (the primary action), share or save it through the device's share sheet where there is
  one (best on iOS, DESIGN §8), or copy the save code. Downloading or sharing counts as saved:
  `onsaved` is called, the leave-guard comes off and the cards that follow the save appear. Copying
  the code does not (the clipboard is not a place to keep results), and says so.
  The buttons hand over the CURRENT save (`makeSave`), which includes the worked examples' families.
-->
<script lang="ts">
  import { copySaveCode, downloadSave, shareSave, type ShareOutcome } from '../save/io'
  import type { SaveFileV1 } from '../save/types'
  import { FINISHED_AUTOSAVE_UNAVAILABLE, FINISHED_COPIED, FINISHED_COPY, FINISHED_COPY_FAILED, FINISHED_DOWNLOAD, FINISHED_DOWNLOADED } from '../session/copy'
  import type { AutosaveStatus } from '../session/persist'
  import { SAVE_COPIED_NOT_SAVED, SAVE_DONE, SAVE_PANEL_HEADING, SAVE_PANEL_REQUIRED, SAVE_SHARE, SAVE_SHARE_CANCELLED, SAVE_SHARED } from './copy'
  import './reveal.css'

  interface Props {
    /** The save file to hand over, made when asked so it is current. */
    readonly makeSave: () => SaveFileV1
    readonly autosave: AutosaveStatus
    /** The save has been downloaded or shared. */
    readonly saved: boolean
    readonly onsaved: () => void
    /** Injectable for tests. */
    readonly download?: (save: SaveFileV1) => string
    readonly copyCode?: (save: SaveFileV1) => Promise<{ code: string; copied: boolean }>
    readonly share?: (save: SaveFileV1) => Promise<ShareOutcome>
    /** Whether to offer the share sheet (default: where the browser can share files). */
    readonly canShare?: boolean
  }

  let {
    makeSave,
    autosave,
    saved,
    onsaved,
    download = downloadSave,
    copyCode = (s) => copySaveCode(s),
    share = (s) => shareSave(s),
    canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function',
  }: Props = $props()

  const uid = $props.id()
  let message = $state('')
  let manualCode = $state('')

  function doDownload(): void {
    manualCode = ''
    download(makeSave())
    message = FINISHED_DOWNLOADED
    onsaved()
  }

  async function doShare(): Promise<void> {
    manualCode = ''
    const outcome = await share(makeSave())
    if (outcome === 'cancelled') {
      message = SAVE_SHARE_CANCELLED
      return
    }
    message = outcome === 'shared' ? SAVE_SHARED : FINISHED_DOWNLOADED
    onsaved()
  }

  async function doCopy(): Promise<void> {
    const r = await copyCode(makeSave())
    if (r.copied) {
      manualCode = ''
      message = saved ? FINISHED_COPIED : `${FINISHED_COPIED} ${SAVE_COPIED_NOT_SAVED}`
    } else {
      manualCode = r.code
      message = FINISHED_COPY_FAILED
    }
  }
</script>

<section class="hb-reveal-panel save" aria-labelledby="{uid}-h" data-section="save" data-saved={saved}>
  <h2 id="{uid}-h">{SAVE_PANEL_HEADING}</h2>
  <p>{SAVE_PANEL_REQUIRED}</p>
  {#if autosave !== 'ok'}
    <p class="error">{FINISHED_AUTOSAVE_UNAVAILABLE}</p>
  {/if}
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={doDownload}>{FINISHED_DOWNLOAD}</button>
    {#if canShare}
      <button type="button" class="hb-btn" onclick={() => void doShare()}>{SAVE_SHARE}</button>
    {/if}
    <button type="button" class="hb-btn" onclick={() => void doCopy()}>{FINISHED_COPY}</button>
  </div>
  <p class="hb-status" role="status">{message}</p>
  {#if saved}
    <p class="done">{SAVE_DONE}</p>
  {/if}
  {#if manualCode !== ''}
    <label class="muted" for="{uid}-code">Save code</label>
    <textarea id="{uid}-code" rows="4" readonly>{manualCode}</textarea>
  {/if}
</section>
