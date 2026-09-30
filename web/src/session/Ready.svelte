<!--
  The last screen before the session (ROADMAP M1.15, M1.17 UI wiring): what is about to happen,
  the optional practice questions, and where the new session is added to earlier ones: the
  autosaves found on this device (merged by the save library, R-8.1) and/or a save file or code
  the person loads. `onbase` reports the save the session starts from (or null).
-->
<script lang="ts">
  import type { AxisCode } from '../engine/axes'
  import FocusPicker from '../reveal/FocusPicker.svelte'
  import { FOCUS_TEXT } from '../reveal/copy'
  import { focusOptions } from '../reveal/next'
  import { buildResults } from '../reveal/results'
  import { axisEstimates } from '../viz/profile'
  import { parseSaveText, readSaveFile } from '../save/parse'
  import type { RestoreResult } from '../save/autosave'
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
  }

  let { restored, choices, onchoices, onpractice, onbegin, onfocus }: Props = $props()

  const uid = $props.id()
  const found = $derived(restored?.save ?? null)
  // Earlier sessions to build on (the autosaves chosen and a loaded file, merged): a returning person can focus.
  const focus = $derived.by(() => {
    if (onfocus === undefined) return null
    const base = baseOf(restored, choices)
    const results = base === null ? null : buildResults(base)
    return results === null ? null : focusOptions(axisEstimates(results.input))
  })
  let message = $state('')
  let messageIsError = $state(false)
  let code = $state('')
  let fileInput: HTMLInputElement | undefined = $state()

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
  }
</script>

<Screen title={READY_HEADING}>
  <p>{READY_TEXT}</p>
  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" onclick={onbegin}>{READY_BEGIN}</button>
    <button type="button" class="hb-btn" onclick={onpractice}>{READY_PRACTICE}</button>
  </div>
  <p class="muted">{READY_PRACTICE_NOTE}</p>

  {#if focus !== null && onfocus}
    <details class="focus">
      <summary>{READY_FOCUS_SUMMARY}</summary>
      <p>{FOCUS_TEXT}</p>
      <FocusPicker options={focus} onstart={onfocus} />
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
</Screen>
