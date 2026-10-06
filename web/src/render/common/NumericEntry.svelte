<!--
  Typed-entry box of the series and quant renderers (ROADMAP M1.13, A18; DESIGN §4.2, §13). The
  answer format comes from `spec.input_format` (integer | decimal | fraction | letter). A submit is
  checked by the family (`check`, built on its own score() parser), so an entry the renderer lets
  through is one score() can read; anything else gets a neutral note about the format (never about
  right or wrong) and is not submitted: the format's note, or for a number written with thousands
  commas (quant's `1,500`, which score() still reads in saved answers) the thousands note (UX-079). What `onsubmit` receives is the typed text with its digits
  and spacing normalised to the ASCII the parsers read (`normalize-digits.ts`). A number pad in a
  comma-decimal language has no point, so decimal entries get a point key beside the sign key.
-->
<script lang="ts">
  import './render.css'
  import type { EntryFormat } from '../../tasks/family'
  import { flushSync } from 'svelte'
  import { FORMAT_NOTES, EMPTY_NOTE, INPUT_MODES, THOUSANDS_NOTE, type EntryVerdict } from './entry-copy'
  import { normalizeEntry, usesDecimalComma } from './normalize-digits'

  interface Props {
    readonly format: EntryFormat
    /** Format hint shown under the box (e.g. quant's `spec.hint`). */
    readonly hint: string
    /** Accessible name of the box. */
    readonly label: string
    /** The family's verdict on `text`: 'ok' iff its score() parser reads it as a new answer of this format. */
    readonly check: (text: string) => EntryVerdict
    readonly onsubmit: (text: string) => void
    readonly onpaste?: () => void
    /** No typing or submitting (e.g. while the session is paused). */
    readonly disabled?: boolean
  }

  let { format, hint, label, check, onsubmit, onpaste, disabled = false }: Props = $props()

  const uid = $props.id()
  let text = $state('')
  let note = $state('')
  let submitted = $state(false)
  let input: HTMLInputElement | undefined = $state()

  const signed = $derived(format === 'integer' || format === 'decimal')
  // The decimal pad of a comma language (or of a touch screen, whose keyboard region we cannot see) may offer no point.
  const pointKey = $derived(format === 'decimal' && (usesDecimalComma() || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)))

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (submitted || disabled) return
    const entry = normalizeEntry(text, format)
    if (entry.trim() === '') {
      note = EMPTY_NOTE
      return
    }
    const verdict = check(entry)
    if (verdict !== 'ok') {
      note = verdict === 'thousands' ? THOUSANDS_NOTE : FORMAT_NOTES[format]
      return
    }
    note = ''
    submitted = true
    onsubmit(entry)
  }

  function toggleSign(): void {
    const t = text.trimStart()
    text = t.startsWith('-') || t.startsWith('−') ? t.slice(1) : `-${t}`
    input?.focus()
  }

  function insertPoint(): void {
    const el = input
    if (!el) return
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? start
    text = `${text.slice(0, start)}.${text.slice(end)}`
    note = ''
    flushSync()
    el.focus()
    el.setSelectionRange(start + 1, start + 1)
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
      class:fraction={format === 'fraction'}
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
      <button type="button" class="hb-btn" aria-label="Change sign" translate="no" disabled={submitted || disabled} onclick={toggleSign}>±</button>
    {/if}
    {#if pointKey}
      <button type="button" class="hb-btn" aria-label="Decimal point" translate="no" disabled={submitted || disabled} onclick={insertPoint}>.</button>
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
    flex: 0 1 12rem;
    min-width: 0;
    max-width: 12rem;
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

  .box.fraction {
    flex: 1 1 8rem;
    max-width: 16rem;
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
