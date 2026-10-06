<!--
  Unusual uses renderer (ROADMAP M6.4; DESIGN §3 row 17, §5.4, §8, §10, §13): an object, and 90 seconds (the spec's `seconds`)
  to list unusual uses for it. The task is labelled "Experimental" and the warning "Don't type personal info" (DESIGN §8: the
  save file holds no free text but these answers) is on screen before any typing and stays in view while the round runs.

  Takes only the item's `spec` (the object and the round's length; there is no key, `tasks/aut/spec.ts`). A Start button begins
  the round: the entry is drawn at once (so the box can take focus inside the press, which iOS needs to open its keyboard) and
  the round's ONSET is the first animation frame after the press (rAF clock = performance.now(), §11.6; `onstart(t)` reports
  it). Time left is read from that clock at each frame, shown as m:ss in a timer, and announced only at coarse steps (60, 30
  and 10 seconds left, and at the end) in a polite live region, never every second. `onshown(t)` reports the first frame the
  item is drawn in, as the other entries do; `onpaste` reports each paste into the box (§13).

  An idea is typed and added with the Add button or Enter. The text is cleaned (`cleanResponse`) and checked for personal
  information (`personalInfo`): if something looks like contact details, the idea is NOT added and a note says so, in a polite
  live region the box names as its description. Ideas can be removed while the round runs. The round ends when time is up or
  Done is pressed: `onrespond({ responses, elapsedMs })` is called once, the entry locks, and focus (if it was inside) moves to
  the list of ideas. Done also adds what is still in the box, unless it looks like contact details (then nothing ends and the
  note says why); at time up, what is in the box and was not added is not kept. `elapsedMs` is measured from the onset frame
  and is at most the round's length. The renderer does not score: `run.ts` does, with an embedder on the device. Nothing but
  the object, the fixed copy and the person's own ideas is written to the DOM. No animation, so `prefers-reduced-motion` has
  nothing to stop.
-->
<script lang="ts">
  import { flushSync, onMount } from 'svelte'
  import '../common/render.css'
  import { browserTiming, type EntryRendererProps } from '../common/props'
  import { ANNOUNCE_AT_SECONDS, clockText, ENTRY_COPY, secondsLeftNote, secondsNote } from '../../tasks/aut/copy'
  import { AUT_MAX_IDEAS, secondsOf, type AutResponse, type AutSpec } from '../../tasks/aut/spec'
  import { cleanResponse, MAX_RESPONSE_CHARS, personalInfo } from '../../tasks/aut/text'

  interface Props extends EntryRendererProps<AutSpec, AutResponse> {
    /** rAF timestamp (ms, performance.now() clock) of the first frame of the round, the onset its time runs from. */
    readonly onstart?: (onsetMs: number) => void
  }

  let { spec, onrespond, onshown, onstart, onpaste, timing, disabled = false }: Props = $props()

  type Phase = 'ready' | 'starting' | 'running' | 'done'

  const uid = $props.id()
  const time = $derived(timing ?? browserTiming())
  const seconds = $derived(secondsOf(spec))
  let phase = $state<Phase>('ready')
  let ideas = $state<string[]>([])
  let text = $state('')
  let note = $state('')
  let status = $state('')
  let secondsLeft = $state<number | null>(null)
  let root: HTMLElement | undefined = $state()
  let input: HTMLInputElement | undefined = $state()
  let ideasTitle: HTMLElement | undefined = $state()
  let onset = 0
  let pending: number | null = null
  const announced = new Set<number>()

  const shownLeft = $derived(secondsLeft ?? seconds)
  const running = $derived(phase === 'running')

  function cancelFrame(): void {
    if (pending !== null) time.frames.cancel(pending)
    pending = null
  }

  function start(): void {
    if (phase !== 'ready' || disabled) return
    phase = 'starting'
    // Drawn now, so the box can take focus inside the press (iOS opens its keyboard only then); the round's clock starts at
    // the first frame that shows it.
    flushSync()
    input?.focus()
    pending = time.frames.request((ts) => {
      pending = null
      onset = ts
      phase = 'running'
      onstart?.(ts)
      tick(ts)
    })
  }

  function tick(ts: number): void {
    if (phase !== 'running') return
    const length = seconds * 1000
    const elapsed = ts - onset
    if (elapsed >= length) {
      finish('time')
      return
    }
    const left = Math.ceil((length - elapsed) / 1000)
    secondsLeft = left
    // The coarse steps below the round's own length, once each; a jump over several (a hidden tab) says the latest.
    const due = ANNOUNCE_AT_SECONDS.filter((s) => s < seconds && left <= s && !announced.has(s))
    if (due.length > 0) {
      for (const s of due) announced.add(s)
      status = secondsLeftNote(Math.min(...due))
    }
    pending = time.frames.request(tick)
  }

  function finish(reason: 'time' | 'done'): void {
    if (phase !== 'running') return
    cancelFrame()
    const length = seconds * 1000
    const elapsedMs = reason === 'time' ? length : Math.min(length, Math.max(0, time.clock.now() - onset))
    const hadFocus = root !== undefined && root.contains(document.activeElement)
    phase = 'done'
    if (reason === 'time') secondsLeft = 0
    status = reason === 'time' ? ENTRY_COPY.timeUp : ENTRY_COPY.finished
    note = ''
    text = ''
    if (hadFocus) {
      flushSync()
      ideasTitle?.focus()
    }
    onrespond({ responses: [...ideas], elapsedMs })
  }

  /** The cleaned idea in the box, or null (with the note set and the box focused) when it cannot be added. */
  function readBox(): string | null {
    const idea = cleanResponse(text)
    if (idea === '') {
      text = ''
      note = ENTRY_COPY.emptyNote
      input?.focus()
      return null
    }
    if (personalInfo(idea).length > 0) {
      note = ENTRY_COPY.personalInfoNote
      input?.focus()
      return null
    }
    return idea
  }

  function add(event: SubmitEvent): void {
    event.preventDefault()
    if (!running || disabled) return
    const idea = readBox()
    if (idea === null) return
    if (ideas.length >= AUT_MAX_IDEAS) {
      note = ENTRY_COPY.fullNote
      input?.focus()
      return
    }
    ideas.push(idea)
    text = ''
    note = ''
    input?.focus()
  }

  function remove(i: number): void {
    if (!running || disabled) return
    ideas.splice(i, 1)
    note = ''
    input?.focus()
  }

  function pressDone(): void {
    if (!running || disabled) return
    if (cleanResponse(text) !== '') {
      const idea = readBox()
      if (idea === null) return
      if (ideas.length < AUT_MAX_IDEAS) ideas.push(idea)
    }
    finish('done')
  }

  // The Enter that ends an IME composition (Safari reports it as keyCode 229) picks a candidate; it is not an add.
  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault()
  }

  onMount(() => {
    // The DOM is drawn when this runs; the next frame is the first to show it (§11.6: rAF-locked onset).
    const frames = time.frames
    const h = frames.request((ts) => onshown?.(ts))
    return () => {
      frames.cancel(h)
      cancelFrame()
    }
  })
</script>

<section bind:this={root} class="hb-render aut" aria-labelledby="{uid}-title" data-phase={phase}>
  <p class="title" id="{uid}-title">
    <span class="name">{ENTRY_COPY.name}</span>
    <span class="badge">{ENTRY_COPY.experimental}</span>
  </p>
  <p class="hb-instructions">{ENTRY_COPY.instructions}</p>
  <div class="warning" role="group" aria-labelledby="{uid}-warning">
    <p class="warning-title" id="{uid}-warning">{ENTRY_COPY.warningTitle}</p>
    <p class="warning-body">{ENTRY_COPY.warningBody}</p>
  </div>
  <p class="object">
    <span class="object-label">{ENTRY_COPY.objectLabel}</span>
    <strong class="object-word">{spec.object}</strong>
  </p>

  {#if phase === 'ready'}
    <p class="length">{secondsNote(seconds)}</p>
    <div class="hb-actions">
      <button type="button" class="hb-btn hb-primary" onclick={start} {disabled}>{ENTRY_COPY.start}</button>
    </div>
  {:else}
    <div class="clock" role="timer">
      <span class="clock-label">{ENTRY_COPY.timeLabel}</span>
      <time class="clock-time" datetime="PT{shownLeft}S">{clockText(shownLeft)}</time>
    </div>
    {#if phase !== 'done'}
      <form class="entry" onsubmit={add} novalidate>
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
            enterkeyhint="enter"
            maxlength={MAX_RESPONSE_CHARS}
            {disabled}
            aria-invalid={note !== '' ? 'true' : undefined}
            aria-describedby="{uid}-note"
            oninput={() => (note = '')}
            onpaste={() => onpaste?.({ t_ms: time.clock.now() })}
            {onkeydown}
          />
          <button type="submit" class="hb-btn hb-primary" disabled={disabled || !running}>{ENTRY_COPY.add}</button>
        </div>
        <p class="hb-note" id="{uid}-note" aria-live="polite">{note}</p>
      </form>
      <div class="hb-actions">
        <button type="button" class="hb-btn" onclick={pressDone} disabled={disabled || !running}>{ENTRY_COPY.done}</button>
      </div>
    {/if}
  {/if}

  <p class="hb-status" aria-live="polite">{status}</p>

  {#if phase !== 'ready'}
    <div class="ideas">
      <p class="ideas-title" id="{uid}-ideas" tabindex="-1" bind:this={ideasTitle}>{ENTRY_COPY.ideasLabel} ({ideas.length})</p>
      {#if ideas.length === 0}
        <p class="none">{ENTRY_COPY.noIdeas}</p>
      {:else}
        <!-- list-style: none drops the list semantics in Safari, so the role is written out. -->
        <ol class="list" role="list" aria-labelledby="{uid}-ideas">
          {#each ideas as idea, i (i)}
            <li class="idea">
              <span class="idea-text">{idea}</span>
              {#if phase !== 'done'}
                <button type="button" class="hb-btn remove" onclick={() => remove(i)} disabled={disabled || !running} aria-label="{ENTRY_COPY.remove} {idea}">{ENTRY_COPY.remove}</button>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</section>

<style>
  .aut {
    padding: 0.5rem 0;
    max-width: 40rem;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    margin: 0 0 0.75rem;
    font-size: 1.125rem;
    font-weight: 600;
  }

  /* The label is a word in a pill, not a colour alone. */
  .badge {
    padding: 0 0.625rem;
    border: 2px solid var(--r-note);
    border-radius: 999px;
    color: var(--r-note);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .warning {
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-note);
    border-left-width: 0.5rem;
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  .warning-title {
    margin: 0 0 0.25rem;
    font-weight: 700;
    color: var(--r-note);
    overflow-wrap: anywhere;
  }

  .warning-body {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .object {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    margin: 0 0 1rem;
  }

  .object-label {
    color: var(--r-muted);
  }

  .object-word {
    font-size: 1.5rem;
    overflow-wrap: anywhere;
  }

  .length {
    margin: 0 0 0.5rem;
  }

  .clock {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    margin: 0 0 1rem;
  }

  .clock-label {
    color: var(--r-muted);
  }

  .clock-time {
    font-size: 1.5rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
    max-width: 24rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-bg);
    color: var(--r-fg);
    font: inherit;
    font-size: 1.125rem;
  }

  .box:disabled {
    cursor: default;
  }

  .ideas {
    margin: 1rem 0 0;
  }

  .ideas-title {
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  .none {
    margin: 0;
    color: var(--r-muted);
  }

  .list {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .idea {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
    min-width: 0;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  .idea-text {
    flex: 1 1 8rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
