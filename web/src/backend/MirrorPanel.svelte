<!--
  The optional server backup (ROADMAP M2.7, AI.26; DESIGN §8 "Optional server mirror", §13): the save
  file stored on the server under the person's save identifier, with a 12-word recovery phrase that is
  shown once. There are no accounts and no email, and the server keeps only a one-way fingerprint of
  the phrase, so it cannot give it back: the screen says so, and asks the person to confirm they have
  kept it before it goes away. A later backup of the same save needs the phrase. The notes settings
  are not in the backup (`MIRROR_NOTE`, DESIGN §17.7 `mirror`): `BackendApi.mirrorPut` removes them
  before the call and the server refuses a file that holds them.
  The phrase is held in this component's memory only, while it is on screen. It is never written to
  storage, a URL or the save file.
  Getting a backup back (the "I already have a backup" form on the ready screen and the data page) takes
  the save identifier as well as the phrase, so the identifier is shown with the phrase and stays on
  screen after it: someone who has lost the device and the file has nothing else to read it from. It is
  a label that is also in every copy of the file, not a secret (the phrase is the secret).
-->
<script lang="ts">
  import { MIRROR_NOTE } from '../brief/reveal'
  import { isBackendError } from './errors'
  import type { MirrorPutReply } from './replies'
  import {
    MIRROR_BUTTON,
    MIRROR_EXISTS,
    MIRROR_FAILED,
    MIRROR_FULL,
    MIRROR_HAVE,
    MIRROR_HEADING,
    MIRROR_ID_LABEL,
    MIRROR_ID_NOTE,
    MIRROR_PHRASE_COPIED,
    MIRROR_PHRASE_COPY,
    MIRROR_PHRASE_COPY_FAILED,
    MIRROR_PHRASE_DONE,
    MIRROR_PHRASE_HEADING,
    MIRROR_PHRASE_LABEL,
    MIRROR_PHRASE_SAFE,
    MIRROR_PHRASE_WARNING,
    MIRROR_STORED,
    MIRROR_TEXT,
    MIRROR_TOO_LARGE,
    MIRROR_UPDATED,
    MIRROR_UPDATE_BUTTON,
    MIRROR_WORKING,
    MIRROR_WRONG_PHRASE,
  } from './copy'
  import '../reveal/reveal.css'

  interface Props {
    /** Stores the save (the first time with no phrase, later with the one the person was given). */
    readonly put: (phrase?: string) => Promise<MirrorPutReply>
    /** Injectable for tests: put text on the clipboard, true when it worked. */
    readonly copyText?: (text: string) => Promise<boolean>
    /** The save identifier the backup is stored under, until the server's reply names it. */
    readonly anonId?: string
  }

  async function clipboardCopy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  let { put, copyText = clipboardCopy, anonId = '' }: Props = $props()

  const uid = $props.id()
  let busy = $state(false)
  let message = $state('')
  let isError = $state(false)
  /** The recovery phrase while it is on screen; cleared when the person confirms. */
  let phrase = $state('')
  let kept = $state(false)
  let typed = $state('')
  let copyMessage = $state('')
  let hasBackup = $state(false)
  /** The identifier the server stored the backup under (its reply), once it has one. */
  let storedId = $state('')
  const shownId = $derived(storedId !== '' ? storedId : anonId)

  async function run(): Promise<void> {
    if (busy) return
    busy = true
    isError = false
    message = MIRROR_WORKING
    try {
      const r = await put(typed.trim() === '' ? undefined : typed.trim())
      if (!r.stored) {
        isError = true
        message = MIRROR_WRONG_PHRASE
        hasBackup = true
        return
      }
      hasBackup = true
      storedId = r.anonId
      if (r.recoveryPhrase !== null) {
        phrase = r.recoveryPhrase
        kept = false
        copyMessage = ''
        message = MIRROR_STORED
      } else {
        message = MIRROR_UPDATED
      }
      typed = ''
    } catch (e) {
      isError = true
      message = MIRROR_FAILED
      if (isBackendError(e)) {
        if (e.code === 'mirror_exists') {
          message = MIRROR_EXISTS
          hasBackup = true
        } else if (e.code === 'mirror_full') message = MIRROR_FULL
        else if (e.code === 'save_too_large') message = MIRROR_TOO_LARGE
      }
    } finally {
      busy = false
    }
  }

  async function copy(): Promise<void> {
    copyMessage = (await copyText(phrase)) ? MIRROR_PHRASE_COPIED : MIRROR_PHRASE_COPY_FAILED
  }

  function done(): void {
    phrase = ''
    copyMessage = ''
  }
</script>

{#snippet identifier()}
  {#if shownId !== ''}
    <p class="ident"><strong>{MIRROR_ID_LABEL}:</strong> <code data-anon-id>{shownId}</code></p>
    <p class="note">{MIRROR_ID_NOTE}</p>
  {/if}
{/snippet}

<section class="hb-reveal-panel mirror" aria-labelledby="{uid}-h" data-section="mirror">
  <h2 id="{uid}-h">{MIRROR_HEADING}</h2>
  <p>{MIRROR_TEXT}</p>
  <p class="note" data-mirror-note>{MIRROR_NOTE}</p>

  {#if phrase !== ''}
    <div class="hb-reveal-card" data-phrase>
      <h3>{MIRROR_PHRASE_HEADING}</h3>
      <p class="phrase" data-recovery-phrase>{phrase}</p>
      <p class="warn">{MIRROR_PHRASE_WARNING}</p>
      {@render identifier()}
      <div class="hb-actions">
        <button type="button" class="hb-btn" onclick={() => void copy()}>{MIRROR_PHRASE_COPY}</button>
      </div>
      <p class="hb-status" role="status">{copyMessage}</p>
      <div class="check">
        <input id="{uid}-kept" type="checkbox" bind:checked={kept} />
        <label for="{uid}-kept">{MIRROR_PHRASE_SAFE}</label>
      </div>
      <div class="hb-actions">
        <button type="button" class="hb-btn hb-primary" disabled={!kept} onclick={done}>{MIRROR_PHRASE_DONE}</button>
      </div>
    </div>
  {:else}
    {#if hasBackup}
      {@render identifier()}
    {/if}
    <details open={hasBackup}>
      <summary>{MIRROR_HAVE}</summary>
      <label for="{uid}-phrase">{MIRROR_PHRASE_LABEL}</label>
      <input id="{uid}-phrase" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" bind:value={typed} />
    </details>
    <div class="hb-actions">
      <button type="button" class="hb-btn hb-primary" disabled={busy} onclick={() => void run()}>{typed.trim() === '' && !hasBackup ? MIRROR_BUTTON : MIRROR_UPDATE_BUTTON}</button>
    </div>
  {/if}
  <p class={['hb-status', isError && 'error']} role="status">{phrase === '' || isError ? message : ''}</p>
</section>

<style>
  .phrase {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 1.125rem;
    line-height: 1.8;
    word-spacing: 0.35em;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    user-select: all;
    overflow-wrap: anywhere;
  }

  .warn {
    font-weight: 600;
  }

  code[data-anon-id] {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    user-select: all;
    overflow-wrap: anywhere;
  }

  input[type='text'] {
    box-sizing: border-box;
    width: 100%;
    max-width: 38rem;
    font: inherit;
    color: var(--r-fg);
    background: var(--r-bg);
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    padding: 0.5rem;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin: 1rem 0;
    min-height: 2.75rem;
  }

  .check input {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    margin: 0.125rem 0 0;
  }

  .error {
    color: var(--r-note);
  }
</style>
