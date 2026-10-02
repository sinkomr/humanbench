<!--
  "Your data on the server" (ROADMAP M2.7; DESIGN §8 "Optional server mirror", §13 "GDPR/CCPA basics"):
  get a backup back on a new device (save identifier + recovery phrase), and delete everything stored
  for an identifier (the recovery phrase, or a save file the server issued, is the proof). There are no
  accounts. The server answers a wrong proof and an unknown identifier the same way, and so does this
  page: "nothing matched". A deletion asks first and says what it does not touch (the person's own files
  and this browser). In the static fallback there is nothing on a server, and the page says so.
-->
<script lang="ts">
  import { downloadSave } from '../save/io'
  import { parseSaveText, readSaveFile } from '../save/parse'
  import type { SaveFileV1 } from '../save/types'
  import ConfirmPanel from '../session/ConfirmPanel.svelte'
  import Screen from '../session/Screen.svelte'
  import type { BackendApi } from './api'
  import { isBackendError } from './errors'
  import {
    DATA_BACK,
    DATA_CODE_LABEL,
    DATA_DELETE_BUTTON,
    DATA_DELETE_CONFIRM_HEADING,
    DATA_DELETE_CONFIRM_NO,
    DATA_DELETE_CONFIRM_YES,
    DATA_DELETE_HEADING,
    DATA_DELETE_NEED,
    DATA_DELETE_NONE,
    DATA_DELETE_TEXT,
    DATA_DELETE_WITH_FILE,
    DATA_DELETE_WITH_PHRASE,
    DATA_FAILED,
    DATA_FILE_LABEL,
    DATA_HEADING,
    DATA_ID_LABEL,
    DATA_INTRO,
    DATA_LIMITED,
    DATA_PHRASE_LABEL,
    DATA_RESTORE_BUTTON,
    DATA_RESTORE_DOWNLOAD,
    DATA_RESTORE_FOUND,
    DATA_RESTORE_HEADING,
    DATA_RESTORE_NONE,
    DATA_STATIC,
    dataDeleted,
  } from './copy'

  interface Props {
    /** The server's API, or null in the static fallback (then the page only explains). */
    readonly api: BackendApi | null
    /** Injectable for tests: hand a restored save to the person (default: download it). */
    readonly download?: (save: SaveFileV1) => string
  }

  let { api, download = (s) => downloadSave(s) }: Props = $props()

  const uid = $props.id()

  // --- get my backup back
  let rid = $state('')
  let rphrase = $state('')
  let restored: SaveFileV1 | null = $state.raw(null)
  let restoreMessage = $state('')
  let restoreError = $state(false)
  let restoring = $state(false)

  // --- delete
  let how: 'phrase' | 'file' = $state('phrase')
  let did = $state('')
  let dphrase = $state('')
  let fileInput: HTMLInputElement | undefined = $state()
  let code = $state('')
  let asking = $state(false)
  let deleting = $state(false)
  let deleteMessage = $state('')
  let deleteError = $state(false)

  const say = (e: unknown): string => (isBackendError(e) && e.kind === 'limited' ? DATA_LIMITED : DATA_FAILED)

  async function restore(): Promise<void> {
    if (api === null || restoring) return
    restoring = true
    restored = null
    restoreError = false
    restoreMessage = ''
    try {
      const r = await api.mirrorGet(rid.trim(), rphrase.trim())
      if (r.found) {
        restored = r.save
        restoreMessage = DATA_RESTORE_FOUND
        rphrase = ''
      } else {
        restoreError = true
        restoreMessage = DATA_RESTORE_NONE
      }
    } catch (e) {
      restoreError = true
      restoreMessage = say(e)
    } finally {
      restoring = false
    }
  }

  function ready(): boolean {
    if (how === 'phrase') return did.trim() !== '' && dphrase.trim() !== ''
    return (fileInput?.files?.length ?? 0) > 0 || code.trim() !== ''
  }

  function ask(event: SubmitEvent): void {
    event.preventDefault()
    deleteMessage = ''
    deleteError = false
    if (!ready()) {
      deleteError = true
      deleteMessage = DATA_DELETE_NEED
      return
    }
    asking = true
  }

  /** The save identifiers a file proves: those its signed sessions were issued to (the server decides which proofs hold). */
  function idsOf(save: SaveFileV1): string[] {
    return [...new Set(save.sessions.flatMap((s) => (s.sig === undefined ? [] : [s.sig.anon_id])))]
  }

  async function remove(): Promise<void> {
    asking = false
    if (api === null || deleting) return
    deleting = true
    deleteError = false
    deleteMessage = ''
    try {
      let sessions = 0
      let mirror = false
      let any = false
      if (how === 'phrase') {
        const r = await api.deleteMyData(did.trim(), { phrase: dphrase.trim() })
        if (r.deleted) {
          any = true
          sessions += r.sessions
          mirror = mirror || r.mirror
        }
      } else {
        const file = fileInput?.files?.[0]
        const parsed = file !== undefined ? await readSaveFile(file) : await parseSaveText(code)
        if (!parsed.ok) {
          deleteError = true
          deleteMessage = parsed.message
          return
        }
        for (const id of idsOf(parsed.save)) {
          const r = await api.deleteMyData(id, { save: parsed.save })
          if (r.deleted) {
            any = true
            sessions += r.sessions
            mirror = mirror || r.mirror
          }
        }
      }
      if (any) {
        deleteMessage = dataDeleted(sessions, mirror)
        dphrase = ''
        code = ''
      } else {
        deleteError = true
        deleteMessage = DATA_DELETE_NONE
      }
    } catch (e) {
      deleteError = true
      deleteMessage = say(e)
    } finally {
      deleting = false
    }
  }
</script>

<Screen title={DATA_HEADING}>
  {#if api === null}
    <p>{DATA_STATIC}</p>
  {:else}
    <p>{DATA_INTRO}</p>

    <h2>{DATA_RESTORE_HEADING}</h2>
    <form
      onsubmit={(e) => {
        e.preventDefault()
        void restore()
      }}
    >
      <div>
        <label for="{uid}-rid">{DATA_ID_LABEL}</label>
        <input id="{uid}-rid" type="text" autocomplete="off" spellcheck="false" bind:value={rid} />
      </div>
      <div>
        <label for="{uid}-rphrase">{DATA_PHRASE_LABEL}</label>
        <input id="{uid}-rphrase" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" bind:value={rphrase} />
      </div>
      <div class="hb-actions">
        <button type="submit" class="hb-btn" disabled={restoring || rid.trim() === '' || rphrase.trim() === ''}>{DATA_RESTORE_BUTTON}</button>
        {#if restored !== null}
          <button type="button" class="hb-btn hb-primary" onclick={() => download(restored!)}>{DATA_RESTORE_DOWNLOAD}</button>
        {/if}
      </div>
    </form>
    <p role="status" class:error={restoreError}>{restoreMessage}</p>

    <h2>{DATA_DELETE_HEADING}</h2>
    <p>{DATA_DELETE_TEXT}</p>
    <form onsubmit={ask}>
      <fieldset>
        <legend>{DATA_DELETE_HEADING}</legend>
        <div class="radio">
          <input id="{uid}-how-phrase" type="radio" name="{uid}-how" value="phrase" bind:group={how} />
          <label for="{uid}-how-phrase">{DATA_DELETE_WITH_PHRASE}</label>
        </div>
        <div class="radio">
          <input id="{uid}-how-file" type="radio" name="{uid}-how" value="file" bind:group={how} />
          <label for="{uid}-how-file">{DATA_DELETE_WITH_FILE}</label>
        </div>
      </fieldset>
      {#if how === 'phrase'}
        <div>
          <label for="{uid}-did">{DATA_ID_LABEL}</label>
          <input id="{uid}-did" type="text" autocomplete="off" spellcheck="false" bind:value={did} />
        </div>
        <div>
          <label for="{uid}-dphrase">{DATA_PHRASE_LABEL}</label>
          <input id="{uid}-dphrase" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" bind:value={dphrase} />
        </div>
      {:else}
        <div>
          <label for="{uid}-dfile">{DATA_FILE_LABEL}</label>
          <input id="{uid}-dfile" type="file" bind:this={fileInput} />
        </div>
        <div>
          <label for="{uid}-dcode">{DATA_CODE_LABEL}</label>
          <textarea id="{uid}-dcode" rows="3" bind:value={code} spellcheck="false" autocomplete="off"></textarea>
        </div>
      {/if}
      {#if !asking}
        <div class="hb-actions">
          <button type="submit" class="hb-btn" disabled={deleting}>{DATA_DELETE_BUTTON}</button>
        </div>
      {/if}
    </form>
    {#if asking}
      <ConfirmPanel
        heading={DATA_DELETE_CONFIRM_HEADING}
        text={DATA_DELETE_TEXT}
        yes={DATA_DELETE_CONFIRM_YES}
        no={DATA_DELETE_CONFIRM_NO}
        onyes={() => void remove()}
        onno={() => (asking = false)}
      />
    {/if}
    <p role="status" class:error={deleteError}>{deleteMessage}</p>
  {/if}
  <p><a class="hb-standalone-link" href="#/">{DATA_BACK}</a></p>
</Screen>
