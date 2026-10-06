<!--
  The save file, prominent and required before leaving (DESIGN §10; ROADMAP M1.R, M1.17 wiring):
  download it (the primary action until it is saved), share or save it through the device's share
  sheet where there is one (best on iOS, DESIGN §8), or copy the save code. Downloading or sharing
  counts as saved: `onsaved` is called, the leave-guard comes off and the cards that follow the save
  appear. Copying the code does not (the clipboard is not a place to keep results), and says so.
  The buttons hand over the CURRENT save (`makeSave`), which includes the worked examples' families,
  and the notes settings kept on this device, read at the click (D17: one file per person, so a second
  device that loads the file gets them back; choices and ids only, never typed text, R-17.12). The file's
  name carries the person's local date (D19).
  While it is not saved the panel has a surface of its own (reveal.css), so it does not read as one
  more optional section; the pointer at the top of the results (`Reveal.svelte`) leads to its
  heading (`focusHeading`), and "Stay and save" lands on the download button (`focusDownload`).
-->
<script lang="ts">
  import { ANTI_COERCION } from '../brief/reveal'
  import { isRemovedContext } from '../save/brief-prefs'
  import { copySaveCode, deviceBriefPrefs, downloadSave, saveFileName, shareSave, withDeviceBriefPrefs, type ShareOutcome } from '../save/io'
  import type { BriefPrefsV1, SaveFileV1 } from '../save/types'
  import { FINISHED_AUTOSAVE_UNAVAILABLE, FINISHED_COPIED, FINISHED_COPY, FINISHED_COPY_FAILED, FINISHED_DOWNLOAD, FINISHED_DOWNLOADED } from '../session/copy'
  import type { AutosaveStatus } from '../session/persist'
  import { SAVE_COPIED_NOT_SAVED, SAVE_DONE, SAVE_HOLDS_NOTES, SAVE_PANEL_HEADING, SAVE_PANEL_REQUIRED, SAVE_SHARE, SAVE_SHARE_CANCELLED, SAVE_SHARED, savedAs } from './copy'
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
    /** Injectable for tests: the notes settings kept on this device, read when a button is pressed (default: the autosaves in `localStorage`, `deviceBriefPrefs`). */
    readonly deviceNotes?: () => BriefPrefsV1 | undefined
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
    deviceNotes = () => deviceBriefPrefs(),
  }: Props = $props()

  const uid = $props.id()
  let message = $state('')
  /** The name of the file that was downloaded, for the line that says where to look for it. */
  let fileName = $state('')
  /** The file just downloaded or shared holds notes settings (the line that says so). */
  let holdsNotes = $state(false)
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

  /** The save as it is now, with the notes settings the device holds at this moment joined in (D17). */
  function currentSave(): SaveFileV1 {
    return withDeviceBriefPrefs(makeSave(), deviceNotes())
  }

  /** Whether `save` holds a set of notes or a fit note (not only removals): what the "also holds" line is about. */
  const hasNotes = (save: SaveFileV1): boolean => save.brief_prefs !== undefined && (save.brief_prefs.contexts.some((c) => !isRemovedContext(c)) || save.brief_prefs.fit_log.length > 0)

  function doDownload(): void {
    manualCode = ''
    const save = currentSave()
    const name = download(save)
    fileName = typeof name === 'string' ? name : ''
    holdsNotes = hasNotes(save)
    message = FINISHED_DOWNLOADED
    onsaved()
  }

  async function doShare(): Promise<void> {
    manualCode = ''
    const save = currentSave()
    const outcome = await share(save)
    if (outcome === 'cancelled') {
      message = SAVE_SHARE_CANCELLED
      return
    }
    // A share that fell back to a download saved the file under the usual name.
    fileName = outcome === 'downloaded' ? saveFileName(save) : ''
    holdsNotes = hasNotes(save)
    message = outcome === 'shared' ? SAVE_SHARED : FINISHED_DOWNLOADED
    onsaved()
  }

  async function doCopy(): Promise<void> {
    const r = await copyCode(currentSave())
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
  {#if saved && holdsNotes}
    <p class="note" data-notes-included>{SAVE_HOLDS_NOTES}</p>
  {/if}
  {#if saved}
    <p class="done">{SAVE_DONE}</p>
  {/if}
  {#if manualCode !== ''}
    <label class="muted" for="{uid}-code">Save code</label>
    <textarea id="{uid}-code" rows="4" readonly translate="no">{manualCode}</textarea>
  {/if}
</section>
