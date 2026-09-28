<!--
  Reading-speed block (ROADMAP M1.12, M1.13, A10, A14; DESIGN §3 row 10, §14.6 ex. 13). The taker
  reveals the passage, reads it at a normal pace and chooses Done; the reading time runs from the
  animation frame that first draws the passage to that press, on the `performance.now()` clock.
  Then the passage is hidden and the 3 gate questions follow, each option in spec order (A18). The
  response is the family's `ReadingResponse` (reading time and the chosen option position per
  question, null if left blank). The source is credited after the block. The spec has no evidence
  spans or rationales (A14), and nothing here marks a keyed option.
-->
<script lang="ts">
  import { flushSync, onDestroy } from 'svelte'
  import '../common/render.css'
  import { browserTiming, type RendererProps } from '../common/props'
  import type { ReadingResponse, ReadingSpec } from '../../tasks/reading/types'

  let { spec, onrespond, timing }: RendererProps<ReadingSpec, ReadingResponse> = $props()

  type Phase = 'intro' | 'reading' | 'questions' | 'done'

  const uid = $props.id()
  let phase: Phase = $state('intro')
  let shownAt: number | null = $state(null)
  // svelte-ignore state_referenced_locally
  let choices: (number | null)[] = $state(spec.questions.map(() => null))
  let root: HTMLElement | undefined = $state()
  let readingMs = 0
  let handle: number | null = null

  const t = $derived(timing ?? browserTiming())
  const unanswered = $derived(choices.filter((c) => c === null).length)

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
    flushSync()
    root?.querySelector<HTMLElement>('.questions')?.focus()
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (phase !== 'questions') return
    phase = 'done'
    flushSync()
    root?.querySelector<HTMLElement>('.credit')?.focus()
    onrespond({ reading_time_ms: readingMs, choices: [...choices] })
  }

  onDestroy(() => {
    if (handle !== null) t.frames.cancel(handle)
  })
</script>

<section class="hb-render reading" bind:this={root} aria-labelledby="{uid}-title">
  <p class="title" id="{uid}-title">Reading</p>
  {#if phase === 'intro'}
    <p class="hb-instructions">
      Read a passage of about {spec.word_count} words at your normal pace, the way you would read for interest. Choose Done when you
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
    <form class="questions" tabindex="-1" aria-label="Questions about the passage" onsubmit={(e) => submit(e)}>
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
      <p class="hb-status" aria-live="polite">{unanswered > 0 ? `${unanswered} of ${spec.questions.length} not answered yet.` : ''}</p>
      <button type="submit" class="hb-btn hb-primary">Submit answers</button>
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

  .question legend {
    font-weight: 600;
    padding: 0 0.25rem;
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
