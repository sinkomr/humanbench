<script lang="ts">
  /**
   * Step 5: where the notes will live (proposal §3.3 step 5; R-17.10). HumanBench picks the format
   * and shows the steps, a copy button and a download button. The provider warning, the anti-
   * coercion notice, the placement advice and "What to look for" (§3.7, "shown before copying")
   * sit above the copy button, always. For coding agents the file is downloaded under a unique name
   * and the command that installs it refuses to overwrite an existing file; removal steps,
   * including a memory review, are one click away. The steps carry the date they were last checked,
   * and a warning once that date is more than 120 days old (R-17.10).
   */
  import { setDestination, setForm, type BuilderState } from '../builder'
  import { COPY, COPY_TARGET_ID, STEPS } from '../copy'
  import { DESTINATIONS, SURFACES, commandBlocks, surfacesStaleness, type Destination, type DestinationGroup, type Os } from '../surfaces'
  import { whatToLookFor } from '../look'
  import type { Form } from '../types'

  interface Props {
    model: BuilderState
    dest: Destination
    form: Form
    lineIds: readonly string[]
    /** Unique file name of the download. */
    fileName: string
    /** Today, `YYYY-MM-DD`, to tell whether the install steps are out of date. */
    today: string
    /** The last thing done with the buttons, announced politely ("Copied to the clipboard."). */
    status: string
    onchange: (next: BuilderState) => void
    oncopy: () => void
    ondownload: () => void
    oncopycommands: (text: string) => void
  }
  let { model, dest, form, lineIds, fileName, today, status, onchange, oncopy, ondownload, oncopycommands }: Props = $props()

  const prefs = $derived(model.contexts[model.active])
  const GROUPS: { id: DestinationGroup; label: string }[] = [
    { id: 'assistant', label: 'Chat assistants' },
    { id: 'agent', label: 'Coding agents' },
    { id: 'other', label: 'Other' },
  ]
  const FORM_LABEL: Record<Form, string> = {
    short: 'Short notes (up to 1,500 characters, fit any box)',
    long: 'Long notes (up to 5,000 characters)',
    skill: 'Skill file',
  }
  let os = $state<Os>('posix')
  const blocks = $derived(commandBlocks(dest, fileName))
  const block = $derived(blocks?.find((b) => b.os === os) ?? blocks?.[0])
  const looks = $derived(whatToLookFor(lineIds))
  const stale = $derived(surfacesStaleness(today))
  // For agents that read a file, download is the default (proposal §3.3 step 5); copy stays available.
  const downloadFirst = $derived(dest.file?.kind === 'new_file')
</script>

<section aria-labelledby="step-paste">
  <h2 id="step-paste">5. {STEPS.paste.heading}</h2>
  <p>{STEPS.paste.hint}</p>

  {#each GROUPS as g (g.id)}
    <fieldset>
      <legend>{g.label}</legend>
      {#each DESTINATIONS.filter((d) => d.group === g.id) as d (d.id)}
        <label class="choice">
          <input type="radio" name="destination" value={d.id} checked={prefs?.destination === d.id} onchange={() => onchange(setDestination(model, d.id))} />
          <span>{d.label}</span>
        </label>
      {/each}
    </fieldset>
  {/each}

  <p class="hint">{dest.limit_note}</p>

  {#if dest.forms.length > 1}
    <fieldset>
      <legend>Length of the notes</legend>
      {#each dest.forms as f (f)}
        <label class="choice">
          <input type="radio" name="form" value={f} checked={form === f} onchange={() => onchange(setForm(model, f))} />
          <span>{FORM_LABEL[f]}</span>
        </label>
      {/each}
    </fieldset>
  {/if}

  <!-- The page's skip link moves focus here: the warnings that come before copying, then the copy and download buttons (the next Tab stops). -->
  <div id={COPY_TARGET_ID} class="copy-target" role="group" aria-label={COPY.copyGroup} tabindex="-1">
    <div class="warn" data-testid="provider-warning">{COPY.providerWarning}</div>
    <p class="note" data-testid="anti-coercion">{COPY.antiCoercion}</p>
    <p class="note" data-testid="placement">{COPY.placement}</p>

    <div data-testid="look-for">
      <h3>What to look for</h3>
      {#if looks.length > 0}
        <ul>
          {#each looks as l (l)}
            <li>{l}</li>
          {/each}
        </ul>
      {/if}
      <p>If none of this appears: {COPY.troubleshooting}</p>
    </div>

    <div class="row actions">
      {#if downloadFirst}
        <button type="button" class="primary" onclick={ondownload}>Download {fileName}</button>
        <button type="button" onclick={oncopy}>Copy the notes</button>
      {:else}
        <button type="button" class="primary" onclick={oncopy}>Copy the notes</button>
        <button type="button" onclick={ondownload}>Download {fileName}</button>
      {/if}
    </div>
    <p class="status" role="status" aria-live="polite" data-testid="status">{status}</p>
  </div>
  <p class="hint">File name: <code data-testid="file-name">{fileName}</code>. {COPY.fileHint}</p>

  <h3>Steps for {dest.label}</h3>
  <p class="hint" data-testid="steps-checked">Steps last checked {SURFACES.checked}.</p>
  {#if stale.stale}
    <p class="warn" data-testid="steps-stale">{stale.warning}</p>
  {/if}
  <ol>
    {#each dest.install as step (step)}
      <li>{step}</li>
    {/each}
  </ol>

  {#if blocks !== null && block !== undefined}
    <fieldset>
      <legend>Your computer</legend>
      {#each blocks as b (b.os)}
        <label class="choice">
          <input type="radio" name="os" value={b.os} checked={block.os === b.os} onchange={() => (os = b.os)} />
          <span>{b.label}</span>
        </label>
      {/each}
    </fieldset>
    <p>Run this in a terminal. If a file is already there, nothing is changed.</p>
    <pre data-testid="install-commands">{block.install}</pre>
    <div class="row actions">
      <button type="button" onclick={() => oncopycommands(block.install)}>Copy the commands</button>
    </div>
  {/if}

  <details>
    <summary>How to remove these notes later</summary>
    {#if dest.remove.length === 0}
      <p>Nothing is installed, so there is nothing to remove.</p>
    {:else}
      <ol>
        {#each dest.remove as step (step)}
          <li>{step}</li>
        {/each}
      </ol>
      {#if block !== undefined}
        <pre data-testid="remove-commands">{block.remove}</pre>
      {/if}
      <p>{COPY.memoryNote}</p>
    {/if}
  </details>
</section>

<style>
  .copy-target:focus {
    outline: none;
  }
  .copy-target:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 4px;
  }
  .actions {
    margin: 1rem 0 0.5rem;
  }
  .status {
    min-height: 1.5rem;
    margin: 0.25rem 0;
    font-weight: 600;
    color: var(--text-strong);
  }
</style>
