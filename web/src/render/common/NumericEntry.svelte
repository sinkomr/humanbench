<!--
  Typed-entry box of the series and quant renderers (ROADMAP M1.13, A18; DESIGN §4.2, §13). The
  answer format comes from `spec.input_format` (integer | decimal | fraction | letter). A submit is
  checked with the family's own score() parser (`accepts`), so an entry the renderer lets through
  is exactly one score() can read; anything else gets a neutral note about the format (never about
  right or wrong) and is not submitted. The typed text is what `onsubmit` receives.
-->
<script lang="ts">
  import './render.css'
  import type { EntryFormat } from '../../tasks/family'
  import { FORMAT_NOTES, EMPTY_NOTE, INPUT_MODES } from './entry-copy'

  interface Props {
    readonly format: EntryFormat
    /** Format hint shown under the box (e.g. quant's `spec.hint`). */
    readonly hint: string
    /** Accessible name of the box. */
    readonly label: string
    /** True iff the family's score() parser reads `text` as an answer of this format. */
    readonly accepts: (text: string) => boolean
    readonly onsubmit: (text: string) => void
    readonly onpaste?: () => void
    /** No typing or submitting (e.g. while the session is paused). */
    readonly disabled?: boolean
  }

  let { format, hint, label, accepts, onsubmit, onpaste, disabled = false }: Props = $props()

  const uid = $props.id()
  let text = $state('')
  let note = $state('')
  let submitted = $state(false)
  let input: HTMLInputElement | undefined = $state()

  const signed = $derived(format === 'integer' || format === 'decimal')

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (submitted || disabled) return
    if (text.trim() === '') {
      note = EMPTY_NOTE
      return
    }
    if (!accepts(text)) {
      note = FORMAT_NOTES[format]
      return
    }
    note = ''
    submitted = true
    onsubmit(text)
  }

  function toggleSign(): void {
    const t = text.trimStart()
    text = t.startsWith('-') || t.startsWith('−') ? t.slice(1) : `-${t}`
    input?.focus()
  }
</script>

<form class="entry" onsubmit={submit} novalidate>
  <label class="label" for="{uid}-in">{label}</label>
  <div class="row">
    <input
      bind:this={input}
      bind:value={text}
      id="{uid}-in"
      class="box"
      class:letter={format === 'letter'}
      type="text"
      inputmode={INPUT_MODES[format]}
      autocomplete="off"
      autocapitalize={format === 'letter' ? 'characters' : 'off'}
      spellcheck="false"
      enterkeyhint="done"
      readonly={submitted}
      {disabled}
      aria-invalid={note !== '' && note !== EMPTY_NOTE ? 'true' : undefined}
      aria-describedby="{uid}-hint {uid}-note"
      oninput={() => (note = '')}
      onpaste={() => onpaste?.()}
    />
    {#if signed}
      <button type="button" class="hb-btn" aria-label="Change sign" disabled={submitted || disabled} onclick={toggleSign}>±</button>
    {/if}
    <button type="submit" class="hb-btn hb-primary" disabled={submitted || disabled}>Submit</button>
  </div>
  <p class="hint" id="{uid}-hint">{hint}</p>
  <p class="hb-note" id="{uid}-note" aria-live="polite">{note}</p>
  <p class="hb-status" aria-live="polite">{submitted ? 'Answer recorded.' : ''}</p>
</form>

<style>
  .entry {
    margin: 1rem 0 0;
  }

  .label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: stretch;
  }

  .box {
    flex: 1 1 8rem;
    min-width: 0;
    max-width: 16rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    color: var(--r-fg);
    font: inherit;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }

  .box.letter {
    flex: 0 1 5rem;
    text-transform: uppercase;
    text-align: center;
  }

  .hint {
    margin: 0.5rem 0 0;
    color: var(--r-muted);
  }
</style>
