<!--
  Fermi renderer (ROADMAP M5.1; DESIGN §3 rows 11–12, §4.2, §13): the question, then the magnitude + unit
  entry with an 80% range. Three typed numbers (best guess, low end, high end) share one unit box. Each
  number is read the way people write one (3200000, 3.2e6, 3.2 × 10^6; `tasks/fermi/magnitude.ts`) and
  shown back under the box ("Reads as 3.2 × 10⁶ s"), so a slipped zero or a wrong unit is seen before
  the submit. The unit has no default when several are offered, so no answer carries a unit nobody
  chose. A submit is checked with `checkEntry` (`tasks/fermi/spec.ts`); a note is about the format of
  what was typed, never about right or wrong (§10), and the response that reaches `onrespond` is exactly
  one `parseFermiResponse` accepts. The spec has no truth: nothing in the DOM depends on the key
  (`fermi.dom.test.ts`).
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../common/render.css'
  import { browserTiming, type EntryRendererProps } from '../common/props'
  import { ENTRY_COPY } from '../../tasks/fermi/copy'
  import { formatMagnitude, parseMagnitude, spokenMagnitude } from '../../tasks/fermi/magnitude'
  import type { FermiResponse } from '../../tasks/fermi/scoring'
  import { checkEntry, type EntryField, type FermiSpec } from '../../tasks/fermi/spec'
  import { unitOf } from '../../tasks/fermi/units'

  let { spec, onrespond, onshown, onpaste, timing, disabled = false }: EntryRendererProps<FermiSpec, FermiResponse> = $props()

  const uid = $props.id()
  const clock = $derived((timing ?? browserTiming()).clock)

  const FIELDS = [
    { name: 'value', label: ENTRY_COPY.value },
    { name: 'low', label: ENTRY_COPY.low },
    { name: 'high', label: ENTRY_COPY.high },
  ] as const

  const text = $state({ value: '', low: '', high: '' })
  let unit = $state('')
  let errors = $state<Partial<Record<EntryField, string>>>({})
  let submitted = $state(false)
  let root: HTMLElement | undefined = $state()

  // One unit on offer: it is the choice (nothing to slip on); several: the person chooses.
  $effect.pre(() => {
    if (unit === '' && spec.units.length === 1) unit = spec.units[0] as string
  })

  const unitLabel = (symbol: string): string => {
    const u = unitOf(symbol)
    return u.label.startsWith('(') ? u.label : `${u.label} (${u.symbol})`
  }

  /** The preview of a typed number: how it was read, in the chosen unit. */
  function reads(raw: string): { visible: string; spoken: string } | null {
    const r = parseMagnitude(raw)
    if (!r.ok) return null
    const symbol = unit === '' ? '' : unitOf(unit).symbol
    const suffix = symbol === '' || symbol === 'count' ? '' : ` ${symbol}`
    const spokenUnit = unit === '' || symbol === 'count' ? '' : ` ${unitOf(unit).label}`
    return { visible: `${formatMagnitude(r.value)}${suffix}`, spoken: `${spokenMagnitude(r.value)}${spokenUnit}` }
  }

  /** Typing into a box takes back the notes that were about it (its own and the range's). */
  function clear(name: EntryField): void {
    if (errors[name] === undefined && errors.range === undefined) return
    const rest = { ...errors }
    delete rest[name]
    delete rest.range
    errors = rest
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (submitted || disabled) return
    const check = checkEntry(spec, { value: text.value, low: text.low, high: text.high, unit })
    if (!check.ok) {
      errors = { ...check.errors }
      const first = (['value', 'low', 'high', 'unit', 'range'] as const).find((n) => check.errors[n] !== undefined)
      root?.querySelector<HTMLElement>(`#${uid}-${first === 'range' ? 'value' : (first ?? 'value')}`)?.focus()
      return
    }
    errors = {}
    submitted = true
    onrespond(check.response)
  }

  onMount(() => {
    if (!onshown) return
    const frames = (timing ?? browserTiming()).frames
    const h = frames.request((ts) => onshown(ts))
    return () => frames.cancel(h)
  })
</script>

<section bind:this={root} class="hb-render fermi" aria-label={ENTRY_COPY.region}>
  <p class="stem">{spec.stem}</p>
  <form class="entry" onsubmit={submit} novalidate>
    <p class="hb-instructions" id="{uid}-how">{ENTRY_COPY.instructions}</p>
    <div class="numbers">
      {#each FIELDS as f (f.name)}
        {@const preview = reads(text[f.name])}
        <div class="field">
          <label class="label" for="{uid}-{f.name}">{f.label}</label>
          <input
            bind:value={text[f.name]}
            id="{uid}-{f.name}"
            class="box"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="next"
            readonly={submitted}
            {disabled}
            aria-invalid={errors[f.name] !== undefined || errors.range !== undefined ? 'true' : undefined}
            aria-describedby="{uid}-how {uid}-{f.name}-reads {uid}-{f.name}-note"
            oninput={() => clear(f.name)}
            onpaste={() => onpaste?.({ t_ms: clock.now() })}
          />
          <p class="reads" id="{uid}-{f.name}-reads">
            {#if preview}
              <span class="hb-sr-only">{ENTRY_COPY.readsAs} {preview.spoken}</span>
              <span aria-hidden="true">{ENTRY_COPY.readsAs} {preview.visible}</span>
            {/if}
          </p>
          <p class="hb-note" id="{uid}-{f.name}-note" aria-live="polite">{errors[f.name] ?? ''}</p>
        </div>
      {/each}
    </div>

    <div class="field unit">
      <label class="label" for="{uid}-unit">{ENTRY_COPY.unit}</label>
      <select
        bind:value={unit}
        id="{uid}-unit"
        class="box"
        disabled={submitted || disabled}
        aria-invalid={errors.unit !== undefined ? 'true' : undefined}
        aria-describedby="{uid}-unit-hint {uid}-unit-note"
      >
        {#if spec.units.length > 1}
          <option value="" disabled>{ENTRY_COPY.unitPlaceholder}</option>
        {/if}
        {#each spec.units as symbol (symbol)}
          <option value={symbol}>{unitLabel(symbol)}</option>
        {/each}
      </select>
      <p class="hint" id="{uid}-unit-hint">{ENTRY_COPY.unitHint}</p>
      <p class="hb-note" id="{uid}-unit-note" aria-live="polite">{errors.unit ?? ''}</p>
    </div>

    <p class="hint">{ENTRY_COPY.rangeHint}</p>
    <p class="hb-note" role="alert">{errors.range ?? ''}</p>

    <div class="hb-actions">
      <button type="submit" class="hb-btn hb-primary" disabled={submitted || disabled}>{ENTRY_COPY.submit}</button>
    </div>
    <p class="hb-status" aria-live="polite">{submitted ? ENTRY_COPY.recorded : ''}</p>
  </form>
</section>

<style>
  .fermi {
    padding: 0.5rem 0;
  }

  .stem {
    max-width: 38rem;
    margin: 0 0 1rem;
    font-size: 1.125rem;
    overflow-wrap: anywhere;
  }

  .numbers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: 0.75rem 1rem;
    max-width: 42rem;
  }

  .field {
    min-width: 0;
  }

  .field.unit {
    margin-top: 0.75rem;
    max-width: 22rem;
  }

  .label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .box {
    width: 100%;
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

  /* WebKit draws a native select at its own height whatever min-height and padding say, so the menu
     button is drawn here (appearance none) with a chevron made of two gradients in the text colour. */
  select.box {
    appearance: none;
    padding-right: 2.5rem;
    background-image: linear-gradient(45deg, transparent 50%, currentcolor 50%), linear-gradient(135deg, currentcolor 50%, transparent 50%);
    background-position:
      calc(100% - 1.25rem) 50%,
      calc(100% - 0.85rem) 50%;
    background-size: 0.4rem 0.4rem;
    background-repeat: no-repeat;
  }

  .reads {
    min-height: 1.5em;
    margin: 0.25rem 0 0;
    color: var(--r-muted);
    overflow-wrap: anywhere;
  }

  .hint {
    max-width: 38rem;
    margin: 0.5rem 0 0;
    color: var(--r-muted);
  }

  /* A note takes no room until it has something to say (its live region stays in the page). */
  .field > .hb-note {
    margin: 0;
  }

  .field > .hb-note:not(:empty) {
    margin-top: 0.25rem;
  }
</style>
