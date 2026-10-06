<!--
  The last screen before the session (ROADMAP M1.15, M1.17 UI wiring): what is about to happen,
  the optional practice questions, and where the new session is added to earlier ones: the
  autosaves found on this device (merged by the save library, R-8.1) and/or a save file or code
  the person loads. `onbase` reports the save the session starts from (or null). The loaded file's notes
  settings win over the device's, set by set (`ready-state.ts`), and the screen says so when they differ.
  With a server (ROADMAP M2.7) a loaded save is also shown to the server, which says which of its sessions it
  issued and finds unchanged (`verify`, `SaveCheck`), and a backup kept on the server can be fetched back
  (`restore`). Both are absent in the static fallback.
  A file the person chooses is read at once (UX-012a): it can never be silently left unread. Begin does not
  start a session while a file is chosen or a code is pasted but not loaded; it says so. A file that is not a
  save falls back to the pasted code. What went well or what is now so ("Loaded 1 earlier session") is said in
  a role=status line that is always on the page; a failure is a role=alert line of its own that appears when
  there is one and that the field it belongs to points at with `aria-describedby` and `aria-invalid`
  (UX-012a: no element changes its role while the page is open). The same goes for the backup fetched from the
  server. With earlier results loaded "See my results" shows them without a new session (UX-010).
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
  import { wallClockMs } from '../save/clock'
  import { parseSaveText, readSaveFile, type ParseResult } from '../save/parse'
  import type { RestoreResult } from '../save/autosave'
  import type { SaveFileV1 } from '../save/types'
  import Screen from './Screen.svelte'
  import { questionsAnswered } from './coverage'
  import { baseOf, replacesDeviceSettings, type ReadyState } from './ready-state'
  import { savedAt } from './saved-at'
  import {
    READY_BEGIN,
    READY_FOCUS_SUMMARY,
    READY_HEADING,
    READY_LOAD_BUTTON,
    READY_LOAD_CODE,
    READY_LOAD_FILE,
    READY_LOAD_HEADING,
    READY_LOAD_HELP,
    READY_LOAD_PREFS_NOTICE,
    READY_NOT_LOADED,
    READY_PRACTICE,
    READY_PRACTICE_NOTE,
    READY_RESTORE_HEADING,
    READY_SHOW_RESULTS,
    READY_TEXT,
    addedToLine,
    savedAtLine,
  } from './copy'

  interface Props {
    /** Autosaves found on this device (read after the gate), or null. */
    readonly restored: RestoreResult | null
    /** The choices made so far (kept by the flow, so practice and back does not lose them). */
    readonly choices: ReadyState
    readonly onchoices: (choices: ReadyState) => void
    readonly onpractice: () => void
    readonly onbegin: () => void
    /** Look at the earlier results without a new session; offered when there are some to look at (UX-010). */
    readonly onresults?: () => void
    /** Start a 20-minute focus session on these skills (M1.R); offered when there are earlier results. */
    readonly onfocus?: (axes: AxisCode[]) => void
    /** The sentence under the heading; default the static version's (progress is kept in this browser). */
    readonly text?: string
    /** With a server: ask it about the sessions of a loaded save (`verify_save`). */
    readonly verify?: (save: SaveFileV1) => Promise<VerifyReply>
    /** With a server: fetch the backup kept under a save identifier and recovery phrase (`mirror_get`). */
    readonly restore?: (anonId: string, phrase: string) => Promise<MirrorGetReply>
    /** The current time in epoch ms, for "last saved": display only, the wall clock of the save library (tests inject). */
    readonly now?: () => number
  }

  let { restored, choices, onchoices, onpractice, onbegin, onresults, onfocus, text = READY_TEXT, verify, restore, now = wallClockMs }: Props = $props()

  const uid = $props.id()
  const found = $derived(restored?.save ?? null)
  /** The save the new session would be added to (the autosaves chosen and a loaded file, merged), or null. */
  const base = $derived(baseOf(restored, choices))
  // Earlier sessions to build on: a returning person can look at them, or focus.
  const earlier = $derived.by(() => {
    // With a server, the sessions it signed are scored there, not here (R-11.1).
    return base === null ? null : buildResults(base, verify === undefined ? undefined : { sessionIds: servedSessionIds(base), estimates: null })
  })
  const focus = $derived(onfocus === undefined || earlier === null ? null : focusOptions(axisEstimates(earlier.input)))
  /** When the newest autosave was written and what its newest session holds. */
  const savedLine = $derived.by(() => {
    if (found === null || found.sessions.length === 0) return ''
    const when = savedAt(found.created_utc, now())
    if (when === '') return ''
    const newest = found.sessions.reduce((a, b) => (b.started_utc > a.started_utc ? b : a))
    return savedAtLine(when, questionsAnswered(newest))
  })
  /** What was loaded (the status line). */
  let message = $state('')
  /** Why nothing was loaded (the alert); '' when there is no failure. */
  let problem = $state('')
  /** Which field a failure belongs to, so the field can point at the message. */
  let errorField: 'file' | 'code' | 'both' | null = $state(null)
  /** Begin was pressed with something chosen that is not loaded. */
  let notLoaded = $state(false)
  let code = $state('')
  let fileInput: HTMLInputElement | undefined = $state()
  /** What the last good load came from (the File, or the code text), so the same thing is not read twice. */
  let loadedFrom: File | string | null = null
  let pending: Promise<void> | null = null
  let standings: SessionStanding[] = $state([])
  let restoreId = $state('')
  let restorePhrase = $state('')
  let restoreMessage = $state('')
  let restoreProblem = $state('')
  let restoring = $state(false)

  /** Read what is chosen. A load that is already under way is not started again (the change of the file started it). */
  function load(): Promise<void> {
    if (pending !== null) return pending
    pending = read().finally(() => {
      pending = null
    })
    return pending
  }

  async function read(): Promise<void> {
    const file = fileInput?.files?.[0]
    const typed = code.trim()
    if (file === undefined && typed === '') {
      // A failure that was just shown stays: it is about the file that was just cleared away, and it is the better message.
      if (problem !== '') return
      fail('Choose a save file or paste a save code first.', 'both')
      return
    }
    const source = file ?? typed
    if (loadedFrom === source && choices.loaded !== null) return
    message = ''
    problem = ''
    errorField = null
    // The file first; when there is none, or it is not a save, the pasted code.
    let r: ParseResult | null = file !== undefined ? await readSaveFile(file) : null
    let from: File | string = source
    let failedOn: 'file' | 'code' = 'file'
    if ((r === null || !r.ok) && typed !== '') {
      r = await parseSaveText(code)
      from = typed
      failedOn = 'code'
    }
    if (r === null) return
    if (!r.ok) {
      fail(r.message, failedOn)
      // A file that is not a save is dropped from the field, so Begin is not held up by it; the message says why.
      if (failedOn === 'file' && fileInput !== undefined) fileInput.value = ''
      return
    }
    loadedFrom = from
    onchoices({ ...choices, loaded: r.save })
    const n = r.save.sessions.length
    message = `Loaded ${n} earlier ${n === 1 ? 'session' : 'sessions'}. Your new session will be added to ${n === 1 ? 'it' : 'them'}.`
    // The file's notes settings win over the ones on this device (owner decision 2026-10-01): say so when they differ.
    if (replacesDeviceSettings(restored, r.save)) message += ` ${READY_LOAD_PREFS_NOTICE}`
    void check(r.save)
  }

  function fail(why: string, field: 'file' | 'code' | 'both'): void {
    message = ''
    problem = why
    errorField = field
  }

  /** A file was chosen: read it now. A cleared field only drops a failure that was about its old content. */
  function fileChanged(): void {
    notLoaded = false
    if ((fileInput?.files?.length ?? 0) > 0) void load()
    else dropStaleError()
  }

  function codeTyped(): void {
    notLoaded = false
    dropStaleError()
  }

  function dropStaleError(): void {
    if (problem === '') return
    problem = ''
    errorField = null
  }

  /** Begin: not while a file or a code is chosen and left unloaded (the new session would not be added to it). */
  async function begin(): Promise<void> {
    if (pending !== null) await pending
    if (choices.loaded === null && ((fileInput?.files?.length ?? 0) > 0 || code.trim() !== '')) {
      notLoaded = true
      return
    }
    notLoaded = false
    onbegin()
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
    restoreProblem = ''
    restoring = true
    try {
      const r = await restore(restoreId.trim(), restorePhrase.trim())
      if (!r.found) {
        restoreProblem = DATA_RESTORE_NONE
        return
      }
      onchoices({ ...choices, loaded: r.save })
      const n = r.save.sessions.length
      restoreMessage = `Loaded your backup with ${n} earlier ${n === 1 ? 'session' : 'sessions'}. Your new session will be added to ${n === 1 ? 'it' : 'them'}.`
      restorePhrase = ''
      void check(r.save)
    } catch {
      restoreProblem = 'The server could not be reached. Please try again.'
    } finally {
      restoring = false
    }
  }
</script>

<Screen title={READY_HEADING}>
  <p>{text}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={() => void begin()}>{READY_BEGIN}</button>
    {#if onresults !== undefined && earlier !== null}
      <button type="button" class="hb-btn" onclick={onresults}>{READY_SHOW_RESULTS}</button>
    {/if}
    <button type="button" class="hb-btn" onclick={onpractice}>{READY_PRACTICE}</button>
  </div>
  {#if notLoaded && choices.loaded === null}
    <p class="error" role="alert">{READY_NOT_LOADED}</p>
  {/if}
  {#if choices.loaded !== null && base !== null}
    <p class="muted">{addedToLine(base.sessions.length)}</p>
  {/if}
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
      <input id="{uid}-found" type="checkbox" checked={choices.includeFound} aria-describedby={savedLine === '' ? undefined : `${uid}-found-note`} onchange={(e) => onchoices({ ...choices, includeFound: e.currentTarget.checked })} />
      <label for="{uid}-found">
        Add my new session to the {found.sessions.length} earlier {found.sessions.length === 1 ? 'session' : 'sessions'} saved on this device{restored !== null && restored.anonIds.length > 1
          ? ' (they come from more than one save identifier)'
          : ''}.
      </label>
    </div>
    {#if savedLine !== ''}
      <p class="muted" id="{uid}-found-note">{savedLine}</p>
    {/if}
  {/if}

  <h2>{READY_LOAD_HEADING}</h2>
  <p class="muted">{READY_LOAD_HELP}</p>
  <div>
    <label for="{uid}-file">{READY_LOAD_FILE}</label>
    <input
      id="{uid}-file"
      type="file"
      bind:this={fileInput}
      onchange={fileChanged}
      aria-describedby={problem !== '' && (errorField === 'file' || errorField === 'both') ? `${uid}-problem` : undefined}
      aria-invalid={problem !== '' && errorField === 'file' ? 'true' : undefined}
    />
  </div>
  <div>
    <label for="{uid}-code">{READY_LOAD_CODE}</label>
    <textarea
      id="{uid}-code"
      rows="3"
      bind:value={code}
      oninput={codeTyped}
      spellcheck="false"
      autocomplete="off"
      translate="no"
      aria-describedby={problem !== '' && (errorField === 'code' || errorField === 'both') ? `${uid}-problem` : undefined}
      aria-invalid={problem !== '' && errorField === 'code' ? 'true' : undefined}
    ></textarea>
  </div>
  <div class="hb-actions">
    <button type="button" class="hb-btn" onclick={() => void load()}>{READY_LOAD_BUTTON}</button>
  </div>
  <p role="status" id="{uid}-message">{message}</p>
  {#if problem !== ''}
    <p role="alert" id="{uid}-problem" class="error">{problem}</p>
  {/if}
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
      <p role="status">{restoreMessage}</p>
      {#if restoreProblem !== ''}
        <p role="alert" class="error">{restoreProblem}</p>
      {/if}
    </details>
  {/if}
</Screen>
