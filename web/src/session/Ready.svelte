<!--
  The last screen before the session (ROADMAP M1.15, M1.17 UI wiring): what is about to happen,
  the optional practice questions, and where the new session is added to earlier ones: the
  autosaves found on this device (merged by the save library, R-8.1) and/or a save file or code
  the person loads. `onbase` reports the save the session starts from (or null).
  With a server (ROADMAP M2.7) a loaded save is also shown to the server, which says which of its sessions it
  issued and finds unchanged (`verify`, `SaveCheck`), and a backup kept on the server can be fetched back
  (`restore`). Both are absent in the static fallback.
-->
<script lang="ts">
  import type { AxisCode } from '../engine/axes'
  import FocusPicker from '../reveal/FocusPicker.svelte'
  import { FOCUS_TEXT } from '../reveal/copy'
  import { focusOptions, focusOptionsKey } from '../reveal/next'
  import { buildResults } from '../reveal/results'
  import { servedSessionIds } from '../backend/flow'
  import SaveCheck from '../backend/SaveCheck.svelte'
  import { standingFromVerify, type SessionStanding } from '../backend/standing'
  import type { MirrorGetReply, VerifyReply } from '../backend/replies'
  import { DATA_ID_LABEL, DATA_RESTORE_BUTTON, DATA_RESTORE_NONE, MIRROR_PHRASE_LABEL } from '../backend/copy'
  import { axisEstimates } from '../viz/profile'
  import { parseSaveText, readSaveFile } from '../save/parse'
  import type { RestoreResult } from '../save/autosave'
  import type { SaveFileV1 } from '../save/types'
  import Screen from './Screen.svelte'
  import { baseOf, type ReadyState } from './ready-state'
  import {
    READY_BEGIN,
    READY_FOCUS_SUMMARY,
    READY_HEADING,
    READY_LOAD_BUTTON,
    READY_LOAD_CODE,
    READY_LOAD_FILE,
    READY_LOAD_HEADING,
    READY_LOAD_HELP,
    READY_PRACTICE,
    READY_PRACTICE_NOTE,
    READY_RESTORE_HEADING,
    READY_TEXT,
  } from './copy'

  interface Props {
    /** Autosaves found on this device (read after the gate), or null. */
    readonly restored: RestoreResult | null
    /** The choices made so far (kept by the flow, so practice and back does not lose them). */
    readonly choices: ReadyState
    readonly onchoices: (choices: ReadyState) => void
    readonly onpractice: () => void
    readonly onbegin: () => void
    /** Start a 20-minute focus session on these skills (M1.R); offered when there are earlier results. */
    readonly onfocus?: (axes: AxisCode[]) => void
    /** The sentence under the heading; default the static version's (progress is kept in this browser). */
    readonly text?: string
    /** With a server: ask it about the sessions of a loaded save (`verify_save`). */
    readonly verify?: (save: SaveFileV1) => Promise<VerifyReply>
    /** With a server: fetch the backup kept under a save identifier and recovery phrase (`mirror_get`). */
    readonly restore?: (anonId: string, phrase: string) => Promise<MirrorGetReply>
  }

  let { restored, choices, onchoices, onpractice, onbegin, onfocus, text = READY_TEXT, verify, restore }: Props = $props()

  const uid = $props.id()
  const found = $derived(restored?.save ?? null)
  // Earlier sessions to build on (the autosaves chosen and a loaded file, merged): a returning person can focus.
  const focus = $derived.by(() => {
    if (onfocus === undefined) return null
    const base = baseOf(restored, choices)
    // With a server, the sessions it signed are scored there, not here (R-11.1).
    const results = base === null ? null : buildResults(base, verify === undefined ? undefined : { sessionIds: servedSessionIds(base), estimates: null })
    return results === null ? null : focusOptions(axisEstimates(results.input))
  })
  let message = $state('')
  let messageIsError = $state(false)
  let code = $state('')
  let fileInput: HTMLInputElement | undefined = $state()
  let standings: SessionStanding[] = $state([])
  let restoreId = $state('')
  let restorePhrase = $state('')
  let restoreMessage = $state('')
  let restoreError = $state(false)
  let restoring = $state(false)

  async function load(): Promise<void> {
    message = ''
    messageIsError = false
    const file = fileInput?.files?.[0]
    const r = file !== undefined ? await readSaveFile(file) : code.trim() !== '' ? await parseSaveText(code) : null
    if (r === null) {
      message = 'Choose a save file or paste a save code first.'
      messageIsError = true
      return
    }
    if (!r.ok) {
      message = r.message
      messageIsError = true
      return
    }
    onchoices({ ...choices, loaded: r.save })
    const n = r.save.sessions.length
    message = `Loaded ${n} earlier ${n === 1 ? 'session' : 'sessions'}. Your new session will be added to ${n === 1 ? 'it' : 'them'}.`
    void check(r.save)
  }

  /** Ask the server which sessions of the file it issued and finds unchanged. Never fails the load. */
  async function check(save: SaveFileV1): Promise<void> {
    standings = []
    if (verify === undefined || save.sessions.length === 0) return
    const signed = save.sessions.some((s) => s.sig !== undefined)
    let reply: VerifyReply | null = null
    if (signed) {
      try {
        reply = await verify(save)
      } catch {
        reply = null
      }
    }
    standings = standingFromVerify(save, reply)
  }

  async function getBackup(): Promise<void> {
    if (restore === undefined || restoring) return
    restoreMessage = ''
    restoreError = false
    restoring = true
    try {
      const r = await restore(restoreId.trim(), restorePhrase.trim())
      if (!r.found) {
        restoreError = true
        restoreMessage = DATA_RESTORE_NONE
        return
      }
      onchoices({ ...choices, loaded: r.save })
      const n = r.save.sessions.length
      restoreMessage = `Loaded your backup with ${n} earlier ${n === 1 ? 'session' : 'sessions'}. Your new session will be added to ${n === 1 ? 'it' : 'them'}.`
      restorePhrase = ''
      void check(r.save)
    } catch {
      restoreError = true
      restoreMessage = 'The server could not be reached. Please try again.'
    } finally {
      restoring = false
    }
  }
</script>

<Screen title={READY_HEADING}>
  <p>{text}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={onbegin}>{READY_BEGIN}</button>
    <button type="button" class="hb-btn" onclick={onpractice}>{READY_PRACTICE}</button>
  </div>
  <p class="muted">{READY_PRACTICE_NOTE}</p>

  {#if focus !== null && onfocus}
    <details class="focus">
      <summary>{READY_FOCUS_SUMMARY}</summary>
      <p>{FOCUS_TEXT}</p>
      {#key focusOptionsKey(focus)}
        <FocusPicker options={focus} onstart={onfocus} />
      {/key}
    </details>
  {/if}

  {#if found !== null}
    <h2>{READY_RESTORE_HEADING}</h2>
    <div class="check">
      <input id="{uid}-found" type="checkbox" checked={choices.includeFound} onchange={(e) => onchoices({ ...choices, includeFound: e.currentTarget.checked })} />
      <label for="{uid}-found">
        Add my new session to the {found.sessions.length} earlier {found.sessions.length === 1 ? 'session' : 'sessions'} saved on this device{restored !== null && restored.anonIds.length > 1
          ? ' (they come from more than one save identifier)'
          : ''}.
      </label>
    </div>
  {/if}

  <h2>{READY_LOAD_HEADING}</h2>
  <p class="muted">{READY_LOAD_HELP}</p>
  <div>
    <label for="{uid}-file">{READY_LOAD_FILE}</label>
    <input id="{uid}-file" type="file" bind:this={fileInput} />
  </div>
  <div>
    <label for="{uid}-code">{READY_LOAD_CODE}</label>
    <textarea id="{uid}-code" rows="3" bind:value={code} spellcheck="false" autocomplete="off"></textarea>
  </div>
  <div class="hb-actions">
    <button type="button" class="hb-btn" onclick={() => void load()}>{READY_LOAD_BUTTON}</button>
  </div>
  <p role="status" class:error={messageIsError}>{message}</p>
  {#if standings.length > 0}
    <SaveCheck sessions={standings} panel={false} level={3} />
  {/if}

  {#if restore !== undefined}
    <details class="focus">
      <summary>Get a backup from the server</summary>
      <p class="muted">Use the save identifier and the 12-word recovery phrase you were given when you kept the backup.</p>
      <div>
        <label for="{uid}-rid">{DATA_ID_LABEL}</label>
        <input id="{uid}-rid" type="text" autocomplete="off" spellcheck="false" bind:value={restoreId} />
      </div>
      <div>
        <label for="{uid}-rphrase">{MIRROR_PHRASE_LABEL}</label>
        <input id="{uid}-rphrase" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" bind:value={restorePhrase} />
      </div>
      <div class="hb-actions">
        <button type="button" class="hb-btn" disabled={restoring || restoreId.trim() === '' || restorePhrase.trim() === ''} onclick={() => void getBackup()}>{DATA_RESTORE_BUTTON}</button>
      </div>
      <p role="status" class:error={restoreError}>{restoreMessage}</p>
    </details>
  {/if}
</Screen>
