<!--
  The save file, prominent and required before leaving (DESIGN §10; ROADMAP M1.R, M1.17 wiring):
  download it (the primary action until it is saved), share or save it through the device's share
  sheet where there is one (best on iOS, DESIGN §8), or copy the save code. Downloading or sharing
  counts as saved: `onsaved` is called, the leave-guard comes off and the cards that follow the save
  appear. Copying the code does not (the clipboard is not a place to keep results), and says so.
  The buttons hand over the CURRENT save (`makeSave`), which includes the worked examples' families.
  While it is not saved the panel has a surface of its own (reveal.css), so it does not read as one
  more optional section; the pointer at the top of the results (`Reveal.svelte`) leads to its
  heading (`focusHeading`), and "Stay and save" lands on the download button (`focusDownload`).
-->
<script lang="ts">
  import { ANTI_COERCION } from '../brief/reveal'
  import { copySaveCode, downloadSave, saveFileName, shareSave, type ShareOutcome } from '../save/io'
  import type { SaveFileV1 } from '../save/types'
  import { FINISHED_AUTOSAVE_UNAVAILABLE, FINISHED_COPIED, FINISHED_COPY, FINISHED_COPY_FAILED, FINISHED_DOWNLOAD, FINISHED_DOWNLOADED } from '../session/copy'
  import type { AutosaveStatus } from '../session/persist'
  import { SAVE_COPIED_NOT_SAVED, SAVE_DONE, SAVE_PANEL_HEADING, SAVE_PANEL_REQUIRED, SAVE_SHARE, SAVE_SHARE_CANCELLED, SAVE_SHARED, savedAs } from './copy'
  import { SAVE_HEADING_ID } from './slots'
  import './reveal.css'

  interface Props {
    /** The save file to hand over, made when asked so it is current. */
    readonly makeSave: () => SaveFileV1
    readonly autosave: AutosaveStatus
    /** The save has been downloaded or shared. */
    readonly saved: boolean
    readonly onsaved: () => void
    /** Injectable for tests. Returns the file's name. */
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
  /** The name of the file that was downloaded, for the line that says where to look for it. */
  let fileName = $state('')
  let manualCode = $state('')
  let heading: HTMLHeadingElement | undefined = $state()
  let downloadButton: HTMLButtonElement | undefined = $state()

  /** Move focus (and the view) to the download button; false when the panel has none. */
  export function focusDownload(): boolean {
    if (downloadButton === undefined) return false
    downloadButton.focus()
    return document.activeElement === downloadButton
  }

  /** Move focus (and the view) to the panel's heading: the target of "Go to the save file". */
  export function focusHeading(): boolean {
    if (heading === undefined) return false
    heading.focus()
    return document.activeElement === heading
  }

  function doDownload(): void {
    manualCode = ''
    const name = download(makeSave())
    fileName = typeof name === 'string' ? name : ''
    message = FINISHED_DOWNLOADED
    onsaved()
  }

  async function doShare(): Promise<void> {
    manualCode = ''
    const save = makeSave()
    const outcome = await share(save)
    if (outcome === 'cancelled') {
      message = SAVE_SHARE_CANCELLED
      return
    }
    // A share that fell back to a download saved the file under the usual name.
    fileName = outcome === 'downloaded' ? saveFileName(save) : ''
    message = outcome === 'shared' ? SAVE_SHARED : FINISHED_DOWNLOADED
    onsaved()
  }

  async function doCopy(): Promise<void> {
    const r = await copyCode(makeSave())
    if (r.copied) {
      manualCode = ''
      // One confirmation per copy: the extra advice is for a person who has not saved the file yet.
      message = saved ? FINISHED_COPIED : SAVE_COPIED_NOT_SAVED
    } else {
      manualCode = r.code
      message = FINISHED_COPY_FAILED
    }
  }
</script>

<section class="hb-reveal-panel save" aria-labelledby={SAVE_HEADING_ID} data-section="save" data-saved={saved}>
  <h2 id={SAVE_HEADING_ID} tabindex="-1" bind:this={heading}>{SAVE_PANEL_HEADING}</h2>
  <p>{SAVE_PANEL_REQUIRED}</p>
  <p class="note" data-anti-coercion>{ANTI_COERCION}</p>
  {#if autosave !== 'ok'}
    <p class="error">{FINISHED_AUTOSAVE_UNAVAILABLE}</p>
  {/if}
  <div class="hb-actions">
    <button type="button" class="hb-btn" class:hb-primary={!saved} bind:this={downloadButton} onclick={doDownload}>{FINISHED_DOWNLOAD}</button>
    {#if canShare}
      <button type="button" class="hb-btn" onclick={() => void doShare()}>{SAVE_SHARE}</button>
    {/if}
    <button type="button" class="hb-btn" onclick={() => void doCopy()}>{FINISHED_COPY}</button>
  </div>
  <p class="hb-status" role="status">{message}</p>
  {#if saved && fileName !== ''}
    <p class="note" data-saved-as>{savedAs(fileName)}</p>
  {/if}
  {#if saved}
    <p class="done">{SAVE_DONE}</p>
  {/if}
  {#if manualCode !== ''}
    <label class="muted" for="{uid}-code">Save code</label>
    <textarea id="{uid}-code" rows="4" readonly translate="no">{manualCode}</textarea>
  {/if}
</section>
