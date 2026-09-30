<script lang="ts">
  /**
   * Keeping the settings between visits (AI.7; proposal §3.3 "Age gate and storage", §5.5; requirements
   * R-17.1, R-17.12). Until the person says they are 18 or older and presses the button, the page keeps
   * nothing at all (the under-18 path writes nothing). After that only the settings are kept: enums, ids,
   * versions and months, never the interests or own lines that were typed, never the notes. They can be
   * downloaded as a save file (a prefs-only save when no test was taken), and a save file, or a pasted
   * save code, can be loaded to bring the settings back.
   *
   * Props:
   * - `keep`: the settings are being kept on this device.
   * - `available`: this browser lets the page keep anything at all. When it does not, the settings can still
   *   be downloaded as a save file (after the same 18+ question), if `canDownload`.
   * - `canDownload`: the page has a store to build the save file with (default true).
   * - `status`: `ok`, `unavailable` or `error`, from the store's last write.
   * - `adultKnown`: the person already confirmed they are 18 or older elsewhere (the session's consent
   *   gate, M1.15), so the question is not asked again.
   * - `message`, `loadMessage`: the last thing done, announced politely.
   * - `onkeep`, `ondownload`, `onload(input)`: the actions; the page does the work.
   */
  import { COPY } from '../copy'
  import type { StoreStatus } from '../store-types'

  interface Props {
    keep: boolean
    available: boolean
    canDownload?: boolean
    status: StoreStatus
    adultKnown?: boolean
    message: string
    loadMessage: string
    onkeep: () => void
    ondownload: () => void
    onload: (input: Blob | string) => void
  }
  let { keep, available, canDownload = true, status, adultKnown = false, message, loadMessage, onkeep, ondownload, onload }: Props = $props()

  const uid = $props.id()
  let adult = $state(false)
  let showError = $state(false)
  // The answer is asked for again whenever the page is about to keep something (after "Remove my notes settings" too).
  $effect(() => {
    if (keep) {
      adult = false
      showError = false
    }
  })
  let pasted = $state('')
  let file = $state<File | null>(null)
  let empty = $state(false)

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (!adultKnown && !adult) {
      showError = true
      return
    }
    showError = false
    onkeep()
  }
  /** A download without a place to keep anything: still only after the 18+ answer (the under-18 path writes no file either). */
  function submitDownload(event: SubmitEvent): void {
    event.preventDefault()
    if (!adultKnown && !adult) {
      showError = true
      return
    }
    showError = false
    ondownload()
  }
  function load(event: SubmitEvent): void {
    event.preventDefault()
    if (file === null && pasted.trim() === '') {
      empty = true
      return
    }
    empty = false
    onload(file ?? pasted)
  }
</script>

{#snippet adultBox()}
  {#if !adultKnown}
    <label class="choice">
      <input type="checkbox" bind:checked={adult} aria-describedby={showError && !adult ? `${uid}-err` : undefined} data-testid="adult" />
      <span>{COPY.keepAdult}</span>
    </label>
  {/if}
  {#if showError && !adult && !adultKnown}
    <p class="warn" id="{uid}-err" role="alert" data-testid="adult-error">{COPY.keepNeedAdult}</p>
  {/if}
{/snippet}

<section aria-labelledby="{uid}-heading" data-testid="keep-settings">
  <h2 id="{uid}-heading">{COPY.keepHeading}</h2>
  <p>{COPY.keepIntro}</p>

  {#if keep}
    <p data-testid="keep-state">{status === 'unavailable' ? COPY.keepUnavailable : status === 'error' ? COPY.keepFailed : COPY.keepDone}</p>
    <div class="row actions">
      <button type="button" data-testid="download-settings" onclick={ondownload}>{COPY.keepDownload}</button>
    </div>
  {:else if !available}
    <p class="warn" data-testid="keep-state">{canDownload ? COPY.keepUnavailable : COPY.keepNowhere}</p>
    {#if canDownload}
      <form onsubmit={submitDownload} novalidate>
        {@render adultBox()}
        <div class="row actions">
          <button type="submit" data-testid="download-settings">{COPY.keepDownload}</button>
        </div>
      </form>
    {/if}
  {:else}
    <form onsubmit={submit} novalidate>
      {@render adultBox()}
      <div class="row actions">
        <button type="submit" class="primary" data-testid="keep-button">{COPY.keepButton}</button>
      </div>
    </form>
  {/if}
  <p class="status" role="status" aria-live="polite" data-testid="keep-status">{message}</p>

  <h3>{COPY.loadHeading}</h3>
  <p class="hint">{COPY.loadHint}</p>
  <form onsubmit={load} novalidate>
    <label for="{uid}-file" class="field">{COPY.loadFile}</label>
    <input id="{uid}-file" type="file" data-testid="load-file" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
    <label for="{uid}-paste" class="field">{COPY.loadPaste}</label>
    <textarea id="{uid}-paste" rows="3" bind:value={pasted} autocomplete="off" spellcheck="false" data-testid="load-paste"></textarea>
    <div class="row actions">
      <button type="submit" data-testid="load-button">{COPY.loadButton}</button>
    </div>
  </form>
  {#if empty}<p class="hint" role="status">{COPY.loadEmpty}</p>{/if}
  <p class="status" role="status" aria-live="polite" data-testid="load-status">{loadMessage}</p>
</section>

<style>
  .actions {
    margin: 0.75rem 0;
  }
  .status {
    min-height: 1.5rem;
    margin: 0.25rem 0;
    font-weight: 600;
    color: var(--text-strong);
  }
  .field {
    display: block;
    font-weight: 600;
    color: var(--text-strong);
    margin: 0.75rem 0 0.25rem;
  }
  input[type='file'] {
    max-width: 100%;
    min-height: 2.75rem;
  }
</style>
