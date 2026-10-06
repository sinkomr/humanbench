<!--
  Word links renderer (ROADMAP M6.3; DESIGN §3 row 17, §5.4, §10, §13): three cue words and one typed word that goes
  with each of them, before or after it, to make a common word or phrase (cottage / swiss / cake: cheese).

  Takes only the item's `spec` (the three cues in display order; never the solution or the accepted spellings, which
  stay with the server, `tasks/rat/spec.ts`). The cues are a list; the answer is one labelled text box (no
  autocomplete, autocorrect, autocapitalisation or spell check, at most `MAX_ANSWER_CHARS` characters) and Confirm.
  Enter or Confirm answers: `onrespond(text)` is called once, with the typed text trimmed, and the box is read-only
  from then on. An empty (or all-space) entry is not an answer: a note says so, in a polite live region that the box
  names as its description, and focus goes back to the box. `onshown(t)` reports the timestamp of the first animation
  frame showing the item (rAF clock = performance.now(), §11.6) and the box accepts nothing before it, so no response
  exists without an onset (the contract of `visual.ts`). Each paste is reported through `onpaste` (§13 anomaly
  heuristics). Nothing but the cues and the fixed copy is written to the DOM: no data attribute, no class or id that
  depends on the item (`rat.dom.test.ts`). No animation. The wording never says whether an answer is right.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../common/render.css'
  import { browserTiming, type EntryRendererProps } from '../common/props'
  import { ENTRY_COPY } from '../../tasks/rat/copy'
  import { MAX_ANSWER_CHARS, isRatResponse, type RatResponse, type RatSpec } from '../../tasks/rat/spec'

  let { spec, onrespond, onshown, onpaste, timing, disabled = false }: EntryRendererProps<RatSpec, RatResponse> = $props()

  const uid = $props.id()
  const clock = $derived((timing ?? browserTiming()).clock)
  let text = $state('')
  let note = $state('')
  let submitted = $state(false)
  let shown = $state(false)
  let input: HTMLInputElement | undefined = $state()
  const locked = $derived(disabled || !shown)

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (submitted || locked) return
    const answer = text.trim()
    if (answer === '' || !isRatResponse(answer)) {
      note = answer === '' ? ENTRY_COPY.emptyNote : ENTRY_COPY.longNote
      input?.focus()
      return
    }
    note = ''
    submitted = true
    onrespond(answer)
  }

  // The Enter that ends an IME composition (Safari reports it as keyCode 229) picks a candidate; it is not a submit.
  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault()
  }

  onMount(() => {
    // The DOM is drawn when this runs; the next frame is the first to show it (§11.6: rAF-locked onset).
    const frames = (timing ?? browserTiming()).frames
    const h = frames.request((ts) => {
      shown = true
      onshown?.(ts)
    })
    return () => frames.cancel(h)
  })
</script>

<section class="hb-render rat" aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">{ENTRY_COPY.name}</p>
  <p class="hb-instructions">{ENTRY_COPY.instructions}</p>
  <!-- list-style: none drops the list semantics in Safari, so the role is written out. -->
  <ul class="cues" role="list" aria-label={ENTRY_COPY.cuesLabel}>
    {#each spec.cues as cue, i (i)}
      <li class="cue">{cue}</li>
    {/each}
  </ul>
  <form class="entry" onsubmit={submit} novalidate>
    <label class="label" for="{uid}-in">{ENTRY_COPY.inputLabel}</label>
    <div class="row">
      <input
        bind:this={input}
        bind:value={text}
        id="{uid}-in"
        class="box"
        type="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="done"
        maxlength={MAX_ANSWER_CHARS}
        disabled={locked}
        readonly={submitted}
        aria-invalid={note !== '' ? 'true' : undefined}
        aria-describedby="{uid}-note"
        oninput={() => (note = '')}
        onpaste={() => onpaste?.({ t_ms: clock.now() })}
        {onkeydown}
      />
      <button type="submit" class="hb-btn hb-primary" disabled={locked || submitted}>{ENTRY_COPY.submit}</button>
    </div>
    <p class="hb-note" id="{uid}-note" aria-live="polite">{note}</p>
    <p class="hb-status" aria-live="polite">{submitted ? ENTRY_COPY.recorded : ''}</p>
  </form>
</section>

<style>
  .rat {
    padding: 0.5rem 0;
    max-width: 40rem;
  }

  .title {
    margin: 0 0 0.75rem;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .cues {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    margin: 0 0 1rem;
    padding: 0;
    list-style: none;
  }

  .cue {
    min-width: 0;
    min-height: 2.75rem;
    padding: 0.375rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
    font-size: 1.375rem;
    font-weight: 600;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .entry {
    margin: 0;
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

  /* A text box's own width is about 20 characters, which a phone with large text cannot give it: the percentage makes it
     compressible (CSS Sizing 3), so the row wraps its button under it instead of widening the page. */
  .box {
    flex: 1 1 10rem;
    width: 100%;
    min-width: 0;
    max-width: 20rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    color: var(--r-fg);
    font: inherit;
    font-size: 1.25rem;
  }

  .box:disabled {
    cursor: default;
  }
</style>
