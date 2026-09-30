<!--
  The end of a session (ROADMAP M1.15; DESIGN §10 "Reveal flow", built out by M1.R): why it ended,
  what it covered, the profile from the profile view of M1.16 (the blob and its table; a skipped or
  unmeasured axis is "not measured"), and the save file, which holds the answers and is the only copy
  besides this browser's autosave: download it, or copy the save code. The reveal's build-up, the
  distinctive peaks, the required download, the share card and worked solutions are M1.R's. The profile
  shown is this session's own; for a returning person the merged, practice-adjusted re-score of all
  their sessions (`save/rescore.ts`, DESIGN §7.8) is M1.Q/M1.R's to show.
-->
<script lang="ts">
  import { copySaveCode, downloadSave } from '../save/io'
  import type { SaveFileV1 } from '../save/types'
  import ProfileView from '../viz/ProfileView.svelte'
  import Screen from './Screen.svelte'
  import {
    FINISHED_AGAIN,
    FINISHED_AUTOSAVE_UNAVAILABLE,
    FINISHED_COPIED,
    FINISHED_COPY,
    FINISHED_COPY_FAILED,
    FINISHED_DOWNLOAD,
    FINISHED_DOWNLOADED,
    FINISHED_EMPTY,
    FINISHED_HEADING,
    FINISHED_REASON,
    FINISHED_SAVE_HEADING,
    FINISHED_SAVE_TEXT,
    summaryLine,
  } from './copy'
  import type { AutosaveStatus } from './persist'
  import type { RunResult } from './run'

  interface Props {
    readonly result: RunResult
    /** The save file to hand over (base ∪ this session), made when asked so it is current. */
    readonly makeSave: () => SaveFileV1
    readonly autosave: AutosaveStatus
    readonly onrestart: () => void
    /** Injectable for tests. */
    readonly download?: (save: SaveFileV1) => string
    readonly copyCode?: (save: SaveFileV1) => Promise<{ code: string; copied: boolean }>
  }

  let { result, makeSave, autosave, onrestart, download = downloadSave, copyCode = (s) => copySaveCode(s) }: Props = $props()

  let message = $state('')
  let manualCode = $state('')

  const items = $derived(Object.values(result.itemsByAxis).reduce<number>((n, c) => n + (c ?? 0), 0))
  const minutes = $derived(Math.max(1, Math.round(result.durationS / 60)))
  const input = $derived(result.score === null ? null : { score: result.score, skipped: result.skipped })

  function doDownload(): void {
    manualCode = ''
    download(makeSave())
    message = FINISHED_DOWNLOADED
  }

  async function doCopy(): Promise<void> {
    const r = await copyCode(makeSave())
    if (r.copied) {
      manualCode = ''
      message = FINISHED_COPIED
    } else {
      manualCode = r.code
      message = FINISHED_COPY_FAILED
    }
  }
</script>

<Screen title={FINISHED_HEADING} wide>
  <p class="lead">{result.reason === null ? '' : FINISHED_REASON[result.reason]}</p>
  <p>{summaryLine(items, result.blocks.length, minutes)}</p>

  {#if input === null}
    <p>{FINISHED_EMPTY}</p>
  {:else}
    <ProfileView {input} />
  {/if}

  <h2>{FINISHED_SAVE_HEADING}</h2>
  <p>{FINISHED_SAVE_TEXT}</p>
  {#if autosave !== 'ok'}
    <p class="error">{FINISHED_AUTOSAVE_UNAVAILABLE}</p>
  {/if}
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={doDownload}>{FINISHED_DOWNLOAD}</button>
    <button type="button" class="hb-btn" onclick={() => void doCopy()}>{FINISHED_COPY}</button>
  </div>
  <p role="status">{message}</p>
  {#if manualCode !== ''}
    <label class="muted" for="finished-code">Save code</label>
    <textarea id="finished-code" rows="4" readonly>{manualCode}</textarea>
  {/if}
  <div class="hb-actions">
    <button type="button" class="hb-btn" onclick={onrestart}>{FINISHED_AGAIN}</button>
  </div>
</Screen>
