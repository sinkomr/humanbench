<!--
  Reading-speed block (ROADMAP M1.12, M1.13, A10, A14; DESIGN §3 row 10, §14.6 ex. 13). The taker
  reveals the passage, reads it at a normal pace and chooses Done; the reading time runs from the
  animation frame that first draws the passage to that press, on the `performance.now()` clock.
  Then the passage is hidden and the 3 gate questions follow, each option in spec order (A18). The
  response is the family's `ReadingResponse` (reading time and the chosen option position per
  question, null if left blank). The source is credited after the block. The spec has no evidence
  spans or rationales (A14), and nothing here marks a keyed option.

  Questions: Enter on an option moves on to the next question (and from the last to Submit answers)
  and never submits; Submit answers with questions left blank asks once, in an alert, and a second
  press submits anyway (WCAG 3.2.2, 3.3.4). The count line is mounted empty and filled a moment
  later, so a screen reader announces the first count as a change.
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import { browserTiming, type RendererProps } from '../common/props'
  import type { ReadingResponse, ReadingSpec } from '../../tasks/reading/types'

  let { spec, onrespond, timing }: RendererProps<ReadingSpec, ReadingResponse> = $props()

  type Phase = 'intro' | 'reading' | 'questions' | 'done'

  /** Real time (not the frame clock): a screen reader needs the empty line to be in the page first. */
  const COUNT_DELAY_MS = 150

  const uid = $props.id()
  let phase: Phase = $state('intro')
  let shownAt: number | null = $state(null)
  // svelte-ignore state_referenced_locally
  let choices: (number | null)[] = $state(spec.questions.map(() => null))
  let root: HTMLElement | undefined = $state()
  let formEl: HTMLFormElement | undefined = $state()
  let submitEl: HTMLButtonElement | undefined = $state()
  let readingMs = 0
  let handle: number | null = null
  /** The count line is empty until this is true (a live region announces changes, not what it was mounted with). */
  let counting = $state(false)
  let countTimer: ReturnType<typeof setTimeout> | null = null
  /** How many questions were blank when the person was last asked about it; a submit with the same number goes through. */
  let warnedFor: number | null = $state(null)

  const t = $derived(timing ?? browserTiming())
  const unanswered = $derived(choices.filter((c) => c === null).length)
  const warning = $derived(warnedFor !== null && warnedFor === unanswered && unanswered > 0)
  const noun = $derived(unanswered === 1 ? 'question' : 'questions')

  function reveal(): void {
    phase = 'reading'
    shownAt = null
    flushSync()
    // Timing starts in the frame that draws the passage (§11.6: rAF-locked onset).
    handle = t.frames.request((ts) => {
      handle = null
      shownAt = ts
    })
    flushSync()
    root?.querySelector<HTMLElement>('.passage')?.focus()
  }

  function doneReading(): void {
    if (phase !== 'reading' || shownAt === null) return
    readingMs = Math.max(t.clock.now() - shownAt, 1)
    phase = 'questions'
    counting = false
    warnedFor = null
    flushSync()
    root?.querySelector<HTMLElement>('.questions')?.focus()
    countTimer = setTimeout(() => {
      countTimer = null
      counting = true
    }, COUNT_DELAY_MS)
  }

  /** Enter on an option is "this is my answer", as on every other item: on to the next question, never a submit. */
  function onformkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return
    event.preventDefault()
    const groups = [...(formEl?.querySelectorAll<HTMLElement>('fieldset.question') ?? [])]
    const next = groups[groups.findIndex((g) => g.contains(target)) + 1]
    const radio = next?.querySelector<HTMLInputElement>('input[type="radio"]:checked') ?? next?.querySelector<HTMLInputElement>('input[type="radio"]')
    ;(radio ?? submitEl)?.focus()
  }

  function onformchange(): void {
    counting = true
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (phase !== 'questions') return
    if (unanswered > 0 && warnedFor !== unanswered) {
      // Blank questions are recorded as blank for good: ask once, then let a second press go through.
      warnedFor = unanswered
      return
    }
    phase = 'done'
    flushSync()
    root?.querySelector<HTMLElement>('.credit')?.focus()
    onrespond({ reading_time_ms: readingMs, choices: [...choices] })
  }

  onDestroy(() => {
    if (handle !== null) t.frames.cancel(handle)
    if (countTimer !== null) clearTimeout(countTimer)
  })
</script>

<section class="hb-render reading" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">Reading</p>
  {#if phase === 'intro'}
    <p class="hb-instructions">
      Read a passage of about {spec.word_count} words at your normal pace, the way you would read for interest. Choose Done reading when you
      reach the end. The passage is then hidden and you answer {spec.questions.length} short questions about it.
    </p>
    <button type="button" class="hb-btn hb-primary" onclick={() => reveal()}>Show the passage</button>
  {:else if phase === 'reading'}
    <article class="passage" tabindex="-1" aria-label="Passage">
      {#each spec.paragraphs as para, i (i)}
        <p>{para}</p>
      {/each}
    </article>
    <button type="button" class="hb-btn hb-primary" disabled={shownAt === null} onclick={() => doneReading()}>Done reading</button>
  {:else if phase === 'questions'}
    <!-- The handler only turns an Enter pressed in one of the radios into "next question"; the form is not itself a control. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form
      class="questions"
      tabindex="-1"
      aria-label="Questions about the passage"
      bind:this={formEl}
      onsubmit={(e) => submit(e)}
      onkeydown={onformkeydown}
      onchange={onformchange}
    >
      {#each spec.questions as q, qi (q.id)}
        <fieldset class="question">
          <legend>{qi + 1}. {q.stem}</legend>
          {#each q.options as option, oi (oi)}
            <label class="option">
              <input type="radio" name="{uid}-q{qi}" value={oi} bind:group={choices[qi]} />
              <span>{option}</span>
            </label>
          {/each}
        </fieldset>
      {/each}
      {#if warning}
        <p class="hb-status hb-note" role="alert">
          <span translate="no">{unanswered}</span> {unanswered === 1 ? 'question is' : 'questions are'} not answered yet. Choose Submit answers again to submit anyway, or answer {unanswered === 1 ? 'it' : 'them'} first.
        </p>
      {:else}
        <p class="hb-status" aria-live="polite">
          {#if counting && unanswered > 0}<span translate="no">{unanswered}</span> {noun} not answered yet.{/if}
        </p>
      {/if}
      <button type="submit" class="hb-btn hb-primary" bind:this={submitEl}>Submit answers</button>
    </form>
  {:else}
    <p class="hb-status">Block complete. Thank you.</p>
    <p class="credit" tabindex="-1">
      The passage is from <cite>{spec.source.title}</cite> by {spec.source.author} ({spec.source.year}), via
      <a href={spec.source.url} target="_blank" rel="noopener noreferrer">Project Gutenberg</a>.
    </p>
  {/if}
</section>

<style>
  .reading {
    padding: 0.5rem 0;
  }

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  .passage {
    max-width: 38rem;
    margin: 0 0 1rem;
    font-size: 1.0625rem;
    line-height: 1.6;
    overflow-wrap: break-word;
  }

  .passage p {
    margin: 0 0 1em;
  }

  .questions {
    max-width: 38rem;
  }

  .question {
    margin: 0 0 1rem;
    padding: 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
  }

  /* A floated legend sits inside the frame instead of cutting through its top edge. */
  .question legend {
    float: left;
    width: 100%;
    margin: 0 0 0.5rem;
    padding: 0;
    font-weight: 600;
  }

  .question legend + .option {
    clear: both;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0.375rem 0;
    cursor: pointer;
  }

  .option input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0.125rem 0 0;
    flex: none;
  }

  .credit a {
    color: var(--r-accent);
  }
</style>
